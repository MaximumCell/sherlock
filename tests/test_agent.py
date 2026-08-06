"""Agent + chat endpoint smoke test. Uses MockLLM, real Supabase, no real LLM call.

Two layers:
  1. Re-runs the orchestrator self-test (exercises loop + tool dispatch + history)
  2. Hits POST /cases/{id}/chat via TestClient with Agent monkeypatched to MockLLM
     (exercises the API wiring without spending LLM tokens)
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient

from agent.llm import LLMClient
from agent import orchestrator
from api.main import app
from core import db, correlate

client = TestClient(app)


class MockLLM(LLMClient):
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[dict] = []

    def send(self, history, system_instruction, tools):
        self.calls.append({
            "system_len": len(system_instruction),
            "history_len": len(history),
            "tool_names": [t["name"] for t in tools],
        })
        if not self.responses:
            return {"text": "(mock exhausted)"}
        return self.responses.pop(0)


def _ok(label, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {label}{(' — ' + detail) if detail else ''}")
    if not cond:
        sys.exit(1)


def setup_case() -> str:
    """Create a case, seed findings, approve one correlation. Returns case_id."""
    test_value = f"agent_test_{uuid.uuid4().hex[:8]}"
    r = client.post("/cases", json={"identifiers": [{"type": "username", "value": test_value}]})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    db.upsert_findings([
        {"identifier_type": "username", "identifier_value": test_value,
         "source_tool": "user-scanner", "platform": "github", "status": "found",
         "extra_metadata": {"bio": "OSINT researcher"},
         "collected_at": "2026-08-06T00:00:00Z"},
        {"identifier_type": "username", "identifier_value": test_value,
         "source_tool": "user-scanner", "platform": "twitter", "status": "found",
         "extra_metadata": {"bio": "OSINT researcher"},
         "collected_at": "2026-08-06T00:00:00Z"},
    ], cid)
    corrs = correlate.correlate(cid, db.list_findings(cid))
    db.insert_correlations(corrs, cid)
    if corrs:
        db.set_reviewed(corrs[0]["id"], True, "smoke test approval")
    return cid


def test_orchestrator_self():
    """Re-run the in-module self-test. Exits non-zero on any assertion failure."""
    print("\n=== 1. Orchestrator self-test (mock LLM, real Supabase) ===")
    # invoke the __main__ block programmatically
    import runpy
    try:
        runpy.run_module("agent.orchestrator", run_name="__main__")
    except SystemExit as e:
        if e.code != 0 and e.code is not None:
            _ok("self-test exit code", False, f"exit={e.code}")
        else:
            _ok("self-test exit code", True, "clean exit")


def test_chat_endpoint():
    print("\n=== 2. POST /cases/{id}/chat (endpoint with monkeypatched MockLLM) ===")
    cid = setup_case()
    print(f"  case: {cid}")

    canned = [
        {"function_calls": [{"id": "fc1", "name": "get_case_findings", "args": {}}]},
        {"function_calls": [{"id": "fc2", "name": "get_reviewed_correlations", "args": {}}]},
        {"text": "Same bio on github and twitter; reviewed correlation supports this with confidence 0.80."},
    ]
    mock = MockLLM(canned)
    original_init = orchestrator.Agent.__init__

    def mock_init(self, case_id, llm=None):
        original_init(self, case_id, llm=mock)
    orchestrator.Agent.__init__ = mock_init

    try:
        r = client.post(f"/cases/{cid}/chat", json={"message": "investigate this user"})
        _ok("200", r.status_code == 200, str(r.status_code))
        body = r.json()
        _ok("text present", "bio" in body["text"].lower())
        _ok("iterations=3", body["iterations"] == 3, f"got {body['iterations']}")
        _ok("2 tool calls", len(body["tool_calls_made"]) == 2, f"got {len(body['tool_calls_made'])}")
        names = [tc["name"] for tc in body["tool_calls_made"]]
        _ok("first call = get_case_findings", names[0] == "get_case_findings", names[0])
        _ok("second call = get_reviewed_correlations", names[1] == "get_reviewed_correlations", names[1])
        # verify the LLM actually got the system prompt + tool list
        _ok("mock saw 3 calls", len(mock.calls) == 3, f"got {len(mock.calls)}")
        _ok("system prompt loaded", all(c["system_len"] > 200 for c in mock.calls))
        _ok("5 tools declared", all(len(c["tool_names"]) == 5 for c in mock.calls))
        _ok("expected tools", set(mock.calls[0]["tool_names"]) == {
            "run_username_scan", "run_email_scan", "run_domain_scan",
            "get_case_findings", "get_reviewed_correlations",
        })
        # history grew each turn
        _ok("history grew 1->3", mock.calls[0]["history_len"] < mock.calls[1]["history_len"] < mock.calls[2]["history_len"])

        # audit log written
        r = client.get(f"/audit?case_id={cid}")
        actions = {e["action"] for e in r.json()}
        _ok("agent_chat in audit", "agent_chat" in actions)

        # cleanup
        r = client.delete(f"/cases/{cid}")
        _ok("cleanup 204", r.status_code == 204)

        print("\nAGENT + CHAT ENDPOINT GREEN.")
    finally:
        orchestrator.Agent.__init__ = original_init
        # best-effort cleanup
        try:
            db._client().table("cases").delete().eq("id", cid).execute()
        except Exception:
            pass


if __name__ == "__main__":
    test_orchestrator_self()
    test_chat_endpoint()
