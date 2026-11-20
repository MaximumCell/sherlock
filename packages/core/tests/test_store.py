"""MemoryStore behaviour = the storage contract. SupabaseStore must match it."""
from sherlock_core.models import make_finding
from sherlock_core.store import MemoryStore


def _case(s):
    return s.create_case([{"type": "email", "value": "a@b.c"}], owner_id="u1")["id"]


def test_breaches_for_one_email_stay_separate_rows():
    s = MemoryStore()
    cid = _case(s)
    rows = [
        make_finding(case_id=cid, identifier_type="email", identifier_value="a@b.c", source_tool="xposedornot",
                     platform="breach", meta={"breach_name": n}, discriminator=n)
        for n in ("Adobe", "LinkedIn")
    ]
    s.upsert_findings(rows, cid)
    s.upsert_findings(rows, cid)  # idempotent
    assert len(s.list_findings(cid)) == 2


def test_rescan_keeps_curated_flag():
    s = MemoryStore()
    cid = _case(s)
    f = make_finding(case_id=cid, identifier_type="username", identifier_value="x", source_tool="t", platform="github")
    fid = s.upsert_findings([f], cid)[0]["id"]
    s.set_curated(fid, True)
    s.upsert_findings([f], cid)
    assert s.list_findings(cid, curated=True)[0]["id"] == fid


def test_sync_correlations_preserves_review_decisions():
    s = MemoryStore()
    cid = _case(s)
    base = {"type": "shared_email", "entities_involved": ["f1", "f2"], "confidence": 0.9, "evidence": [], "priority": 1.0}
    a, b, c = ({**base, "corr_key": k} for k in ("a", "b", "c"))
    rows = {r["corr_key"]: r for r in s.sync_correlations(cid, [a, b, c])}
    s.set_correlation_status(rows["a"]["id"], "approved", "confirmed")
    s.set_correlation_status(rows["b"]["id"], "rejected")
    # engine now only produces "a" (with a new member); "b" and "c" disappear from its output
    after = {r["corr_key"]: r for r in s.sync_correlations(cid, [{**a, "entities_involved": ["f1", "f2", "f3"]}])}
    assert after["a"]["status"] == "approved" and after["a"]["review_note"] == "confirmed"
    assert after["a"]["entities_involved"] == ["f1", "f2", "f3"]
    assert after["b"]["status"] == "rejected"   # human decision kept so it is not re-proposed
    assert "c" not in after                      # stale pending row removed


def test_job_claim_retry_and_stale_recovery():
    s = MemoryStore()
    cid = _case(s)
    job = s.enqueue_jobs([{"case_id": cid, "queue": "identity", "module": "m", "target_type": "username",
                           "target_value": "x", "max_attempts": 2}])[0]
    assert s.claim_job("infra", "w1") is None
    assert s.claim_job("identity", "w1")["id"] == job["id"]
    assert s.claim_job("identity", "w2") is None          # already taken
    s.fail_job(job["id"], "boom", delay_s=0)
    assert s.get_job(job["id"])["status"] == "queued"     # retried
    assert s.claim_job("identity", "w1")["attempts"] == 2
    s.stale_seconds = -1                                   # heartbeat now counts as stale
    assert s.claim_job("identity", "w2") is None
    assert s.get_job(job["id"])["status"] == "failed"     # out of attempts


def test_rate_limit():
    s = MemoryStore()
    assert [s.hit_rate_limit("k", 3600, 2) for _ in range(3)] == [True, True, False]


# ----------------------------------------------------------------------------- initial status (same_account)
class _FakeTable:
    """Just enough of the supabase query builder for `SupabaseStore.sync_correlations`."""

    def __init__(self, rows):
        self.rows, self._op, self._payload, self._filters = rows, "select", None, []

    def select(self, *_):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload
        return self

    def update(self, payload):
        self._op, self._payload = "update", payload
        return self

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, k, v):
        self._filters.append(lambda r: r.get(k) == v)
        return self

    def in_(self, k, vs):
        self._filters.append(lambda r: r.get(k) in vs)
        return self

    def order(self, *_, **__):
        return self

    def range(self, *_):
        return self

    def execute(self):
        match = [r for r in self.rows if all(f(r) for f in self._filters)]
        if self._op == "insert":
            new = [{"id": f"id{len(self.rows) + i}", "review_note": None, **p} for i, p in enumerate(self._payload)]
            self.rows.extend(new)
            return type("R", (), {"data": new})()
        if self._op == "update":
            for r in match:
                r.update(self._payload)
        if self._op == "delete":
            self.rows[:] = [r for r in self.rows if r not in match]
        return type("R", (), {"data": match})()


def _supabase_store():
    from sherlock_core.store import SupabaseStore
    rows: list[dict] = []
    s = SupabaseStore.__new__(SupabaseStore)
    s.c = type("C", (), {"table": lambda self, name: _FakeTable(rows)})()
    return s


def _check_initial_status(s, cid):
    merge = {"type": "same_account", "corr_key": "m", "matched_value": "github:kit", "entities_involved": ["f1", "f2"],
             "confidence": 1.0, "evidence": ["one account"], "priority": 0.0, "status": "approved"}
    link = {"type": "shared_email", "corr_key": "l", "matched_value": "a@b.c", "entities_involved": ["f1", "f3"],
            "confidence": 0.9, "evidence": [], "priority": 1.0}
    rows = {r["corr_key"]: r for r in s.sync_correlations(cid, [merge, link])}
    assert rows["m"]["status"] == "approved" and rows["m"]["reviewed_at"]      # merged automatically
    assert rows["l"]["status"] == "pending" and rows["l"]["reviewed_at"] is None
    # the user splits the account: a later run supplying "approved" never overrides that
    s.set_correlation_status(rows["m"]["id"], "rejected")
    rows = {r["corr_key"]: r for r in s.sync_correlations(cid, [{**merge, "entities_involved": ["f1", "f2", "f4"]}, link])}
    assert rows["m"]["status"] == "rejected" and rows["m"]["entities_involved"] == ["f1", "f2", "f4"]
    # stale: a rejected merge (a split) is kept, an automatic merge that no longer applies is removed
    rows = {r["corr_key"]: r for r in s.sync_correlations(cid, [{**merge, "corr_key": "m2"}])}
    assert set(rows) == {"m", "m2"} and rows["m"]["status"] == "rejected"
    rows = {r["corr_key"]: r for r in s.sync_correlations(cid, [])}
    assert set(rows) == {"m"}


def test_sync_correlations_initial_status_memory():
    s = MemoryStore()
    _check_initial_status(s, _case(s))


def test_sync_correlations_initial_status_supabase():
    _check_initial_status(_supabase_store(), "case-1")
