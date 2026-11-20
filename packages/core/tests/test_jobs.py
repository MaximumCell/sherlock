"""Job planning and execution against MemoryStore with fake modules. No network."""
import asyncio
import time

import pytest
from sherlock_core import jobs, modules
from sherlock_core.modules.base import Module
from sherlock_core.store import MemoryStore


# ----------------------------------------------------------------------------- fakes
class OkUser(Module):
    name = "ok_user"
    title = "OK"
    description = "returns two findings"
    inputs = ("username",)
    queue = "identity"

    async def run(self, target, ctx):
        await ctx.progress(50, "halfway")
        return [
            ctx.finding(self, target, platform="github", url=f"https://github.com/{target.value}"),
            ctx.finding(self, target, platform="gitlab", status="not_found"),
        ]


class Boom(Module):
    name = "boom"
    title = "Boom"
    description = "always fails"
    inputs = ("username",)
    queue = "identity"

    async def run(self, target, ctx):
        raise RuntimeError("upstream exploded")


class Slow(Module):
    name = "slow"
    title = "Slow"
    description = "never finishes in time"
    inputs = ("image",)
    queue = "media"
    timeout_s = 0.05

    async def run(self, target, ctx):
        await asyncio.sleep(5)
        return []


class Napper(Module):
    name = "napper"
    title = "Napper"
    description = "takes a moment"
    inputs = ("ip",)
    queue = "infra"

    async def run(self, target, ctx):
        await asyncio.sleep(0.15)
        return []


class Dom(Module):
    name = "dom"
    title = "Dom"
    description = "domain module"
    inputs = ("domain",)
    queue = "infra"

    async def run(self, target, ctx):
        return [ctx.finding(self, target, platform="dns", extra={"a": "1.1.1.1"})]


class NeedsKey(Module):
    name = "needs_key"
    title = "Keyed"
    description = "unavailable without its key"
    inputs = ("username",)
    queue = "identity"
    requires_env = ("SHERLOCK_TEST_KEY_THAT_IS_NEVER_SET",)

    async def run(self, target, ctx):
        return []


class RecordingStore(MemoryStore):
    def __init__(self):
        super().__init__()
        self.beats: list[tuple] = []

    def heartbeat(self, job_id, progress=None, note=None):
        self.beats.append((job_id, progress, note))
        super().heartbeat(job_id, progress, note)


@pytest.fixture(autouse=True)
def registry(monkeypatch):
    reg = {}
    monkeypatch.setattr(modules, "_REGISTRY", reg)
    monkeypatch.setattr(modules, "_loaded", True)
    monkeypatch.setattr(jobs, "RETRY_DELAY_S", 0)
    for cls in (OkUser, Boom, Slow, Napper, Dom, NeedsKey):
        reg[cls.name] = cls()
    return reg


@pytest.fixture(autouse=True)
def offline_enrichment(monkeypatch):
    """run_job's profile previews would fetch the fake modules' profile URLs: keep them offline."""
    async def no_previews(findings, http, **kw):
        return []
    monkeypatch.setattr("sherlock_core.modules.preview.enrich_previews", no_previews)


@pytest.fixture
def store():
    return RecordingStore()


def _case(store):
    return store.create_case([{"type": "username", "value": "octocat"}], owner_id="u1")["id"]


def _enqueue(store, case_id, target_type, value, mods=None):
    return store.enqueue_jobs(jobs.plan_scan(case_id, target_type, value, mods))


# ----------------------------------------------------------------------------- planning
def test_plan_one_job_per_available_module_sharing_a_batch():
    rows = jobs.plan_scan("c1", "username", " @octocat ")
    assert sorted(r["module"] for r in rows) == ["boom", "ok_user"]  # needs_key is unavailable
    assert len({r["batch_id"] for r in rows}) == 1
    assert all(r["queue"] == "identity" and r["case_id"] == "c1" for r in rows)
    assert all(r["target_type"] == "username" and r["target_value"] == "octocat" for r in rows)


def test_plan_queue_comes_from_the_module_and_batches_differ():
    a = jobs.plan_scan("c1", "domain", "Example.COM")
    b = jobs.plan_scan("c1", "domain", "example.com")
    assert a[0]["queue"] == "infra" and a[0]["target_value"] == "example.com"
    assert a[0]["batch_id"] != b[0]["batch_id"]


def test_plan_module_filter():
    assert [r["module"] for r in jobs.plan_scan("c1", "username", "octocat", ["ok_user"])] == ["ok_user"]
    with pytest.raises(ValueError, match="not available"):
        jobs.plan_scan("c1", "username", "octocat", ["dom"])
    with pytest.raises(ValueError, match="not available"):
        jobs.plan_scan("c1", "username", "octocat", ["needs_key"])


def test_plan_rejects_types_without_modules():
    with pytest.raises(ValueError, match="no module"):
        jobs.plan_scan("c1", "wallet", "0x" + "a" * 40)
    with pytest.raises(ValueError, match="unknown target type"):
        jobs.plan_scan("c1", "ssn", "123")


@pytest.mark.parametrize(("target_type", "value", "expected"), [
    ("username", "@Max_Cell.99", "Max_Cell.99"),
    ("email", " Someone@Example.COM ", "Someone@example.com"),
    ("domain", "https://Sub.Example.co.uk/path", "sub.example.co.uk"),
    ("ip", "8.8.8.8", "8.8.8.8"),
    ("ip", "2001:4860:4860::8888", "2001:4860:4860::8888"),
    ("phone", "+1 (415) 555-0123", "+14155550123"),
    ("phone", "0044 20 7946 0958", "+442079460958"),
    ("wallet", "0x52908400098527886E0F7030069857D2E4169EE7", "0x52908400098527886E0F7030069857D2E4169EE7"),
    ("wallet", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT"),
    ("image", "https://example.com/a.png", "https://example.com/a.png"),
    ("name", "  Ada   Lovelace ", "Ada Lovelace"),
])
def test_normalize_accepts(target_type, value, expected):
    assert jobs.normalize_target(target_type, value) == expected


@pytest.mark.parametrize(("target_type", "value"), [
    ("username", "a"),
    ("username", "has space"),
    ("username", "x" * 65),
    ("username", "semi;colon"),
    ("email", "not-an-email"),
    ("email", "a@b"),
    ("domain", "localhost"),
    ("domain", "exa mple.com"),
    ("ip", "999.1.1.1"),
    ("ip", "192.168.1.1"),
    ("ip", "127.0.0.1"),
    ("phone", "12345"),
    ("phone", "+1415555abcd"),
    ("wallet", "0x123"),
    ("image", "ftp://example.com/a.png"),
    ("image", "http://127.0.0.1/a.png"),
    ("image", "http://localhost/a.png"),
    ("image", "javascript:alert(1)"),
    ("name", "x"),
    ("name", "12345"),
    ("name", "n" * 101),
    ("username", "   "),
])
def test_normalize_rejects(target_type, value):
    with pytest.raises(ValueError):
        jobs.normalize_target(target_type, value)


# ----------------------------------------------------------------------------- run_job
async def test_run_job_success(store):
    cid = _case(store)
    store.upsert_entities(cid, [{"kind": "username", "value": "octocat", "is_seed": True}])
    _enqueue(store, cid, "username", "octocat", ["ok_user"])
    job = store.claim_job("identity", "w1")

    await jobs.run_job(job, store)

    done = store.get_job(job["id"])
    assert done["status"] == "succeeded" and done["progress"] == 100
    assert done["result"] == {"findings": 2, "found": 1}
    findings = store.list_findings(cid)
    assert len(findings) == 2 and all(f["job_id"] == job["id"] for f in findings)
    assert store.list_entities(cid)[0]["scanned"] is True
    assert (job["id"], 50, "halfway") in store.beats
    assert store.list_audit(cid)[0]["action"] == "job_succeeded"


async def test_run_job_recorrelates_and_stores_extracted_entities(store, monkeypatch):
    cid = _case(store)
    seen = {}

    def fake_correlate(case_id, findings, split_keys=None):
        seen["statuses"] = {f["status"] for f in findings}
        return [{"type": "shared_handle", "corr_key": "k1", "matched_value": "octocat",
                 "entities_involved": [f["id"] for f in findings], "confidence": 0.7,
                 "evidence": ["same handle"], "priority": 0.5}]

    monkeypatch.setattr(jobs._correlation, "correlate", fake_correlate)
    monkeypatch.setattr(jobs._correlation, "extract_entities",
                        lambda findings: [{"kind": "url", "value": "https://github.com/octocat"}], raising=False)
    _enqueue(store, cid, "username", "octocat", ["ok_user"])
    await jobs.run_job(store.claim_job("identity", "w1"), store)

    corrs = store.list_correlations(cid)
    assert [c["corr_key"] for c in corrs] == ["k1"] and corrs[0]["status"] == "pending"
    assert seen["statuses"] == {"found"}  # not_found rows are never correlation input
    assert any(e["kind"] == "url" for e in store.list_entities(cid))


async def test_correlation_failure_does_not_lose_the_scan(store, monkeypatch):
    cid = _case(store)

    def broken(case_id, findings, split_keys=None):
        raise RuntimeError("engine bug")

    monkeypatch.setattr(jobs._correlation, "correlate", broken)
    _enqueue(store, cid, "username", "octocat", ["ok_user"])
    job = store.claim_job("identity", "w1")
    await jobs.run_job(job, store)
    assert store.get_job(job["id"])["status"] == "succeeded"
    assert len(store.list_findings(cid)) == 2
    assert any(a["action"] == "correlation_error" for a in store.list_audit(cid))


def _row(platform, extra=None):
    from sherlock_core.models import make_finding
    return make_finding(case_id="c1", identifier_type="username", identifier_value="octocat",
                        source_tool="ok_user", platform=platform, url=f"https://{platform}.example/octocat",
                        extra=extra or {})


async def test_enrich_runs_previews_then_hashes_the_fetched_pictures(monkeypatch):
    calls = []

    async def previews(findings, http, **kw):
        calls.append("previews")
        f = dict(findings[0], extra_metadata={"url": "u", "extra": {"avatar_url": "https://img.example/a.png"}})
        return [f]

    async def hashes(findings, http):
        calls.append("hashes")
        assert findings[0]["extra_metadata"]["extra"]["avatar_url"]   # sees the fetched picture
        f = dict(findings[0])
        f["extra_metadata"] = {"url": "u", "extra": {**f["extra_metadata"]["extra"], "avatar_phash": "ab" * 8}}
        return [f]

    monkeypatch.setattr("sherlock_core.modules.preview.enrich_previews", previews)
    monkeypatch.setattr("sherlock_core.modules.avatar_hash.hash_avatars", hashes)
    rows = [_row("github"), _row("gitlab")]
    out = await jobs._enrich(rows, None, "identity")
    assert calls == ["previews", "hashes"]
    assert out[0]["extra_metadata"]["extra"]["avatar_phash"] == "ab" * 8
    assert out[1] is rows[1]


async def test_enrich_skips_previews_outside_the_identity_queue(monkeypatch):
    async def previews(findings, http, **kw):
        raise AssertionError("previews must only run for identity jobs")

    monkeypatch.setattr("sherlock_core.modules.preview.enrich_previews", previews)
    rows = [_row("dns")]
    assert await jobs._enrich(rows, None, "infra") == rows


async def test_enrich_failures_never_cost_the_findings(monkeypatch):
    async def broken(findings, http, **kw):
        raise RuntimeError("preview bug")

    async def hangs(findings, http):
        raise TimeoutError

    monkeypatch.setattr("sherlock_core.modules.preview.enrich_previews", broken)
    monkeypatch.setattr("sherlock_core.modules.avatar_hash.hash_avatars", hangs)
    rows = [_row("github"), _row("gitlab")]
    assert await jobs._enrich(rows, None, "identity") == rows


async def test_module_exception_retries_then_fails(store):
    cid = _case(store)
    _enqueue(store, cid, "username", "octocat", ["boom"])
    statuses = []
    for _ in range(3):
        job = store.claim_job("identity", "w1")
        assert job is not None
        await jobs.run_job(job, store)
        statuses.append(store.get_job(job["id"])["status"])
    assert statuses == ["queued", "queued", "failed"]
    final = store.get_job(job["id"])
    assert final["attempts"] == 3 and "upstream exploded" in final["error"]
    assert store.claim_job("identity", "w1") is None
    failures = [a for a in store.list_audit(cid) if a["action"] == "job_failed"]
    assert [a["detail"]["will_retry"] for a in reversed(failures)] == [True, True, False]


async def test_timeout_is_a_failure(store):
    cid = _case(store)
    _enqueue(store, cid, "image", "https://example.com/a.png")
    job = store.claim_job("media", "w1")
    started = time.monotonic()
    await jobs.run_job(job, store)
    assert time.monotonic() - started < 2
    row = store.get_job(job["id"])
    assert row["status"] == "queued" and "timed out" in row["error"]


async def test_unknown_module_fails_without_retry(store):
    cid = _case(store)
    store.enqueue_jobs([{"case_id": cid, "queue": "identity", "module": "gone",
                         "target_type": "username", "target_value": "x"}])
    job = store.claim_job("identity", "w1")
    await jobs.run_job(job, store)
    assert store.get_job(job["id"])["status"] == "failed"


async def test_heartbeat_ticks_while_the_module_runs(store, monkeypatch):
    monkeypatch.setattr(jobs, "HEARTBEAT_INTERVAL_S", 0.02)
    cid = _case(store)
    _enqueue(store, cid, "ip", "8.8.8.8")
    job = store.claim_job("infra", "w1")
    await jobs.run_job(job, store)
    ticks = [b for b in store.beats if b == (job["id"], None, None)]
    assert len(ticks) >= 3
    assert store.get_job(job["id"])["status"] == "succeeded"


def test_default_heartbeat_interval_is_within_budget():
    assert jobs.HEARTBEAT_INTERVAL_S <= 20


async def test_cancelled_job_is_stopped_and_stays_cancelled(store, monkeypatch):
    monkeypatch.setattr(jobs, "HEARTBEAT_INTERVAL_S", 0.02)
    monkeypatch.setattr(Napper, "run", Slow.run)  # sleeps for seconds
    cid = _case(store)
    _enqueue(store, cid, "ip", "8.8.8.8")
    job = store.claim_job("infra", "w1")
    task = asyncio.create_task(jobs.run_job(job, store))
    await asyncio.sleep(0.05)
    store.cancel_job(job["id"])
    await asyncio.wait_for(task, timeout=2)
    assert store.get_job(job["id"])["status"] == "cancelled"


async def test_worker_shutdown_hands_the_job_back(store, monkeypatch):
    monkeypatch.setattr(Napper, "run", Slow.run)
    cid = _case(store)
    _enqueue(store, cid, "ip", "8.8.8.8")
    job = store.claim_job("infra", "w1")
    task = asyncio.create_task(jobs.run_job(job, store))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    row = store.get_job(job["id"])
    assert row["status"] == "queued" and row["error"] == "worker shut down"


# ----------------------------------------------------------------------------- drain
async def test_drain_processes_its_queue_only(store):
    cid = _case(store)
    _enqueue(store, cid, "username", "octocat", ["ok_user"])
    _enqueue(store, cid, "username", "hubot", ["ok_user"])
    _enqueue(store, cid, "domain", "example.com")

    assert await jobs.drain("identity", store, "w1") == 2
    by_queue = {}
    for j in store.list_jobs(cid):
        by_queue.setdefault(j["queue"], set()).add(j["status"])
    assert by_queue == {"identity": {"succeeded"}, "infra": {"queued"}}
    assert await jobs.drain("identity", store, "w1") == 0


async def test_one_failing_module_does_not_affect_the_batch(store):
    cid = _case(store)
    batch = _enqueue(store, cid, "username", "octocat")  # ok_user + boom
    assert await jobs.drain("identity", store, "w1") == 4  # 1 success + 3 attempts of boom
    status = {j["module"]: j["status"] for j in store.list_jobs(cid)}
    assert status == {"ok_user": "succeeded", "boom": "failed"}
    assert len(batch) == 2 and len(store.list_findings(cid)) == 2


async def test_drain_lingers_for_retries_in_backoff(store, monkeypatch):
    monkeypatch.setattr(jobs, "RETRY_DELAY_S", 1)  # first retry becomes runnable after 1 s
    cid = _case(store)
    _enqueue(store, cid, "username", "octocat", ["boom"])
    assert await jobs.drain("identity", store, "w1") == 1  # strict mode stops at the backoff
    assert store.list_jobs(cid)[0]["status"] == "queued"
    monkeypatch.setattr(jobs, "RETRY_DELAY_S", 0)
    assert await jobs.drain("identity", store, "w1", linger_s=3, poll_s=0.1) == 2
    assert store.list_jobs(cid)[0]["status"] == "failed"


async def test_drain_honours_should_stop(store):
    cid = _case(store)
    _enqueue(store, cid, "username", "octocat", ["ok_user"])
    assert await jobs.drain("identity", store, "w1", should_stop=lambda: True) == 0
    assert store.list_jobs(cid)[0]["status"] == "queued"


# ----------------------------------------------------------------------------- wake signature
def test_wake_signature_roundtrip():
    body = b'{"ts": 1}'
    sig = jobs.sign_wake(body, "secret")
    assert jobs.verify_wake(body, sig, "secret")
    assert not jobs.verify_wake(body + b" ", sig, "secret")
    assert not jobs.verify_wake(body, sig, "other")
    assert not jobs.verify_wake(body, None, "secret")
    assert not jobs.verify_wake(body, sig, "")
    assert not jobs.verify_wake(body, "sígnature", "secret")
