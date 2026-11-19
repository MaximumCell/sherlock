"""Agent chat with a mock LLM, the worker wake call, and the Supabase token verifier."""
import json
import time
from types import SimpleNamespace

import httpx
import respx
from gateway import auth, wake
from gateway.agent.orchestrator import SYSTEM_PROMPT, TOOL_SCHEMAS, Agent
from gateway.auth import Principal
from sherlock_core import config, jobs
from sherlock_core.models import make_finding
from sherlock_core.store import set_store


# ----------------------------------------------------------------------------- agent
def test_chat_runs_the_tool_loop_with_a_mock_llm(client, make_case, store, llm, woken, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    f = make_finding(case_id=cid, identifier_type="username", identifier_value="octocat",
                     source_tool="handles", platform="github")
    store.upsert_findings([f], cid)
    approved, pending = store.sync_correlations(cid, [
        {"type": "shared_bio", "corr_key": "a", "entities_involved": ["f1", "f2"], "confidence": 0.8,
         "evidence": ["same bio"], "priority": 0.9},
        {"type": "shared_bio", "corr_key": "b", "entities_involved": ["f3", "f4"], "confidence": 0.4,
         "evidence": ["weak"], "priority": 0.1},
    ])
    store.set_correlation_status(approved["id"], "approved", "checked")
    llm.responses = [
        {"function_calls": [{"id": "1", "name": "get_case_findings", "args": {}}]},
        {"function_calls": [{"id": "2", "name": "get_reviewed_correlations", "args": {}}]},
        {"text": "octocat is on github; one approved link (shared bio, confidence 0.80)."},
    ]

    r = client.post(f"/cases/{cid}/chat", headers=as_anon, json={"message": "summarise"})
    out = r.json()
    assert r.status_code == 200 and out["iterations"] == 3 and "0.80" in out["text"]
    calls = out["tool_calls_made"]
    assert [c["name"] for c in calls] == ["get_case_findings", "get_reviewed_correlations"]
    assert calls[0]["result"]["findings"][0]["platform"] == "github"
    # only human-approved correlations reach the model
    assert calls[1]["result"]["count"] == 1 and calls[1]["result"]["correlations"][0]["review_note"] == "checked"
    assert pending["id"] != approved["id"]
    assert set(llm.calls[0]["tool_names"]) == {
        "run_username_scan", "run_email_scan", "run_domain_scan",
        "get_scan_status", "get_case_findings", "get_reviewed_correlations",
    }
    assert woken == [] and store.list_audit(cid)[0]["action"] == "agent_chat"


def test_agent_scan_tools_enqueue_instead_of_blocking(client, make_case, store, llm, woken, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    llm.responses = [
        {"function_calls": [{"id": "1", "name": "run_domain_scan", "args": {"domain": "Example.com"}},
                            {"id": "2", "name": "run_username_scan", "args": {"username": "bad value"}},
                            {"id": "3", "name": "launch_missiles", "args": {}}]},
        {"function_calls": [{"id": "4", "name": "get_scan_status", "args": {}}]},
        {"text": "Queued."},
    ]
    out = client.post(f"/cases/{cid}/chat", headers=as_anon, json={"message": "scan example.com"}).json()
    scan, invalid, unknown, status = (c["result"] for c in out["tool_calls_made"])
    jobs_ = store.list_jobs(cid)
    assert scan["status"] == "queued" and scan["batch_id"] == jobs_[0]["batch_id"] and scan["modules"] == ["dns"]
    assert "error" in invalid and "error" in unknown
    assert status["active"] == 1 and status["jobs"][0]["status"] == "queued"
    assert [j["status"] for j in jobs_] == ["queued"]
    assert woken == [["infra"]]
    assert next(a for a in store.list_audit(cid) if a["action"] == "scan_queued")["actor"] == "agent"


def test_agent_scans_obey_the_same_limits(client, make_case, store, llm, as_anon, monkeypatch):
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 1)
    cid = make_case(scan=False)["case"]["id"]
    llm.responses = [
        {"function_calls": [{"id": "1", "name": "run_username_scan", "args": {"username": "one"}},
                            {"id": "2", "name": "run_username_scan", "args": {"username": "two"}}]},
        {"text": "done"},
    ]
    out = client.post(f"/cases/{cid}/chat", headers=as_anon, json={"message": "go"}).json()
    first, second = (c["result"] for c in out["tool_calls_made"])
    assert first["status"] == "queued" and "Daily limit" in second["error"]
    assert {j["target_value"] for j in store.list_jobs(cid)} == {"one"}


def test_chat_llm_failure_is_a_clean_502(client, make_case, llm, as_anon):
    cid = make_case(scan=False)["case"]["id"]

    def explode(*a):
        raise RuntimeError("quota")

    llm.send = explode
    r = client.post(f"/cases/{cid}/chat", headers=as_anon, json={"message": "hi"})
    assert r.status_code == 502 and "assistant" in r.json()["detail"]


def test_agent_prompt_keeps_the_boundaries_and_drops_spiderfoot():
    text = (SYSTEM_PROMPT + json.dumps(TOOL_SCHEMAS)).lower()
    assert "spiderfoot" not in text
    assert "phone numbers or national id" in text and "approved by a human reviewer" in text
    assert Agent.__init__.__defaults__ == (None,)  # the LLM client stays the swap point


# ----------------------------------------------------------------------------- wake
@respx.mock
async def test_poke_signs_the_body_and_targets_each_queue(monkeypatch):
    monkeypatch.setattr(config, "INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(config, "WORKER_URLS", {"identity": "http://id.test/", "infra": "http://infra.test", "media": ""})
    identity = respx.post("http://id.test/wake").mock(return_value=httpx.Response(202))
    infra = respx.post("http://infra.test/wake").mock(return_value=httpx.Response(202))

    await wake.poke_workers(["identity", "infra", "media", "identity"])

    assert identity.call_count == 1 and infra.call_count == 1
    req = identity.calls.last.request
    assert jobs.verify_wake(req.content, req.headers["X-Sherlock-Signature"], "s3cret")
    assert abs(json.loads(req.content)["ts"] - time.time()) < 5


@respx.mock
async def test_poke_never_raises(monkeypatch):
    monkeypatch.setattr(config, "INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(config, "WORKER_URLS", {"identity": "http://id.test", "infra": "http://infra.test", "media": ""})
    respx.post("http://id.test/wake").mock(side_effect=httpx.ReadTimeout("cold start"))
    ok = respx.post("http://infra.test/wake").mock(return_value=httpx.Response(500))
    await wake.poke_workers(["identity", "infra"])  # a cold or broken worker is not an error
    assert ok.call_count == 1

    monkeypatch.setattr(config, "INTERNAL_SECRET", "")
    await wake.poke_workers(["identity"])  # unsigned calls are never sent
    assert respx.calls.call_count == 2


def test_a_failed_poke_does_not_fail_the_request(client, store, as_anon, monkeypatch):
    from gateway.wake import get_waker

    async def broken(queues):
        await wake.poke_workers(queues)

    monkeypatch.setattr(config, "INTERNAL_SECRET", "s3cret")
    monkeypatch.setattr(config, "WORKER_URLS", {"identity": "http://127.0.0.1:9", "infra": "", "media": ""})
    monkeypatch.setattr(wake, "WAKE_TIMEOUT_S", 0.2)
    client.app.dependency_overrides[get_waker] = lambda: broken
    r = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "username", "value": "octocat"}]})
    assert r.status_code == 201 and len(r.json()["jobs"]) == 2


# ----------------------------------------------------------------------------- token verifier
class _FakeAuth:
    def __init__(self):
        self.calls = 0

    def get_user(self, token):
        self.calls += 1
        if token == "good":
            return SimpleNamespace(user=SimpleNamespace(id="uid-1", is_anonymous=True))
        if token == "member":
            return SimpleNamespace(user=SimpleNamespace(id="uid-2", is_anonymous=False))
        raise RuntimeError("invalid JWT")


async def test_supabase_verifier_resolves_and_caches(monkeypatch):
    fake = _FakeAuth()
    set_store(SimpleNamespace(c=SimpleNamespace(auth=fake)))
    monkeypatch.setattr(auth, "_cache", {})
    try:
        assert await auth.verify_supabase_token("good") == Principal("uid-1", True)
        assert await auth.verify_supabase_token("good") == Principal("uid-1", True)
        assert fake.calls == 1  # second answer came from the cache
        assert await auth.verify_supabase_token("member") == Principal("uid-2", False)
        assert await auth.verify_supabase_token("bad") is None
        assert await auth.verify_supabase_token("bad") is None
        assert fake.calls == 4  # failures are not cached

        monkeypatch.setattr(auth, "CACHE_TTL_S", -1.0)
        monkeypatch.setattr(auth, "_cache", {})
        await auth.verify_supabase_token("good")
        await auth.verify_supabase_token("good")
        assert fake.calls == 6  # expired entries are re-verified
    finally:
        set_store(None)
