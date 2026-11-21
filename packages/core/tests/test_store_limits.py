"""Store methods behind the search limits and the worker pool: claim exclusions, fair claim order,
batch cancel, active batches, backlog counts, queue summaries, and the pre-0003 claim fallback."""
from datetime import UTC, datetime, timedelta

from sherlock_core.store import MemoryStore, SupabaseStore, window_reset_s


def _job(case_id, module="m", queue="identity", batch="b1", **kw):
    return {"case_id": case_id, "queue": queue, "module": module, "batch_id": batch,
            "target_type": "username", "target_value": "x", **kw}


def _enqueue(s, rows):
    """Enqueue with strictly increasing created_at so 'oldest' is unambiguous."""
    out = []
    base = datetime.now(UTC) - timedelta(minutes=10)
    for i, r in enumerate(rows):
        [row] = s.enqueue_jobs([r])
        s.jobs[row["id"]]["created_at"] = (base + timedelta(seconds=i)).isoformat()
        out.append(s.jobs[row["id"]])
    return out


def _case(s, owner="u1"):
    return s.create_case([{"type": "username", "value": "x"}], owner_id=owner)["id"]


def test_claim_skips_excluded_modules():
    s = MemoryStore()
    c = _case(s)
    _enqueue(s, [_job(c, "whatsmyname"), _job(c, "github")])
    job = s.claim_job("identity", "w", exclude_modules=["whatsmyname"])
    assert job["module"] == "github"
    assert s.claim_job("identity", "w", exclude_modules=["whatsmyname"]) is None
    assert s.claim_job("identity", "w")["module"] == "whatsmyname"


def test_claim_is_round_robin_across_cases():
    s = MemoryStore()
    a, b = _case(s, "u1"), _case(s, "u2")
    # search A queued 4 jobs first, then search B queued 2
    _enqueue(s, [_job(a, f"a{i}") for i in range(4)] + [_job(b, f"b{i}", batch="b2") for i in range(2)])
    order = [s.claim_job("identity", "w")["module"] for _ in range(4)]
    # A (0 running) -> B (0 running, A has 1) -> A (1 vs 1, older) -> B
    assert order == ["a0", "b0", "a1", "b1"]


def test_claim_fairness_counts_only_running_jobs_of_the_same_queue():
    s = MemoryStore()
    a, b = _case(s, "u1"), _case(s, "u2")
    _enqueue(s, [_job(a, "a0"), _job(a, "a1"), _job(b, "b0", batch="b2"), _job(a, "infra", queue="infra")])
    assert s.claim_job("infra", "w")["module"] == "infra"       # A runs a job on another queue
    assert s.claim_job("identity", "w")["module"] == "a0"        # ... which does not count here


def test_finished_jobs_do_not_count_against_a_case():
    s = MemoryStore()
    a, b = _case(s, "u1"), _case(s, "u2")
    _enqueue(s, [_job(a, "a0"), _job(a, "a1"), _job(b, "b0", batch="b2")])
    first = s.claim_job("identity", "w")
    s.complete_job(first["id"], {"findings": 0, "found": 0})
    assert s.claim_job("identity", "w")["module"] == "a1"        # A has nothing running again: oldest wins


def test_cancel_batch_cancels_only_that_batch():
    s = MemoryStore()
    c = _case(s)
    rows = _enqueue(s, [_job(c, "a"), _job(c, "b"), _job(c, "c", batch="other")])
    s.claim_job("identity", "w")
    cancelled = s.cancel_batch(c, "b1")
    assert sorted(r["module"] for r in cancelled) == ["a", "b"]
    assert {r["status"] for r in cancelled} == {"cancelled"}
    assert s.get_job(rows[2]["id"])["status"] == "queued"
    assert s.cancel_batch(c, "b1") == []


def test_active_batches_are_per_owner_and_distinct():
    s = MemoryStore()
    mine, theirs = _case(s, "u1"), _case(s, "u2")
    rows = _enqueue(s, [_job(mine, "a"), _job(mine, "b"), _job(mine, "c", batch="b2"), _job(theirs, "d", batch="b3")])
    assert s.active_batches("u1") == [{"case_id": mine, "batch_id": "b1"}, {"case_id": mine, "batch_id": "b2"}]
    s.complete_job(rows[2]["id"], {})
    assert s.active_batches("u1") == [{"case_id": mine, "batch_id": "b1"}]
    assert s.active_batches("nobody") == []


def test_count_queued_and_active_summary_hold_counts_only():
    s = MemoryStore()
    c = _case(s)
    _enqueue(s, [_job(c, "a"), _job(c, "b"), _job(c, "c", queue="infra")])
    s.claim_job("identity", "w")
    assert s.count_queued("identity") == 1 and s.count_queued("infra") == 1 and s.count_queued("media") == 0
    rows = s.active_job_summary(["identity"])
    assert [r["status"] for r in rows] == ["running", "queued"]
    assert all(set(r) == {"case_id", "queue", "status", "created_at"} for r in rows)


def test_window_reset_is_within_the_window():
    assert 1 <= window_reset_s(600) <= 601
    assert 1 <= window_reset_s(86400) <= 86401


# ----------------------------------------------------------------------------- SupabaseStore claim
class _Exec:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return self.fn()


class _Res:
    def __init__(self, data):
        self.data = data


class _FakeClient:
    """rpc('claim_job') as an older database without p_exclude_modules; records job updates."""

    def __init__(self, new_schema: bool, job: dict | None):
        self.new_schema, self.job, self.calls, self.updates = new_schema, job, [], []

    def rpc(self, name, params):
        self.calls.append(params)

        def run():
            if "p_exclude_modules" in params and not self.new_schema:
                raise RuntimeError("{'code': 'PGRST202', 'message': 'Could not find the function public.claim_job'}")
            return _Res([dict(self.job)] if self.job else [])
        return _Exec(run)

    def table(self, name):
        client = self

        class Q:
            def update(self, payload):
                client.updates.append(payload)
                return self

            def eq(self, *a):
                return self

            def execute(self):
                return _Res([])
        return Q()


def _sb(client):
    s = SupabaseStore.__new__(SupabaseStore)
    s.c = client
    return s


def test_supabase_claim_sends_exclusions():
    client = _FakeClient(True, {"id": "j1", "module": "github", "attempts": 1})
    assert _sb(client).claim_job("identity", "w", ["whatsmyname"])["id"] == "j1"
    assert client.calls[0]["p_exclude_modules"] == ["whatsmyname"]


def test_supabase_claim_falls_back_before_the_migration_and_hands_back_excluded_jobs():
    client = _FakeClient(False, {"id": "j1", "module": "whatsmyname", "attempts": 2})
    s = _sb(client)
    assert s.claim_job("identity", "w", ["whatsmyname"]) is None
    assert "p_exclude_modules" not in client.calls[-1]
    assert client.updates == [{"status": "queued", "locked_by": None, "attempts": 1}]
    client.job = {"id": "j2", "module": "github", "attempts": 1}
    assert s.claim_job("identity", "w", ["whatsmyname"])["id"] == "j2"
    assert len(client.calls) == 3          # remembers the old schema: no second failed attempt
