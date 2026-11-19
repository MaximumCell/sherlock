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
