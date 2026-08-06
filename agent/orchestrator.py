"""Agent orchestrator. Owns a case, holds the LLM client, runs the function-call loop.

Tools (5) per plan Section 6 Phase 5:
  - run_username_scan
  - run_email_scan
  - run_domain_scan
  - get_case_findings
  - get_reviewed_correlations

The agent narrates only from get_reviewed_correlations (system_prompt.md rule #2).
Correlation is code's job; the agent never invents new connections.
"""
import json
from pathlib import Path

from core import db
from core.collectors import spiderfoot_wrapper, user_scanner_wrapper, xposedornot_wrapper
from agent.llm import LLMClient, default_client

SYSTEM_PROMPT = (Path(__file__).parent / "system_prompt.md").read_text()

MAX_LOOP_ITERATIONS = 10

TOOL_SCHEMAS = [
    {
        "name": "run_username_scan",
        "description": "Scan a username across 280+ social platforms. Adds findings to the current case.",
        "parameters": {
            "type": "object",
            "properties": {
                "username": {"type": "string", "description": "The username to scan (no @)."}
            },
            "required": ["username"],
        },
    },
    {
        "name": "run_email_scan",
        "description": "Scan an email for account resolution + breach exposure (user-scanner + XposedOrNot).",
        "parameters": {
            "type": "object",
            "properties": {
                "email": {"type": "string", "description": "The email to scan."}
            },
            "required": ["email"],
        },
    },
    {
        "name": "run_domain_scan",
        "description": "Run SpiderFoot against a domain (DNS, WHOIS, subdomains). Requires SpiderFoot running at SPIDERFOOT_URL.",
        "parameters": {
            "type": "object",
            "properties": {
                "domain": {"type": "string", "description": "The domain to scan."}
            },
            "required": ["domain"],
        },
    },
    {
        "name": "get_case_findings",
        "description": "Return all raw findings (any status) for the current case. Use to inspect what collectors produced.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_reviewed_correlations",
        "description": "Return ONLY approved correlations (reviewed=true) for the current case. You may only narrate from this output.",
        "parameters": {"type": "object", "properties": {}},
    },
]


class Agent:
    def __init__(self, case_id: str, llm: LLMClient | None = None):
        self.case_id = case_id
        self.llm = llm or default_client()
        self.history: list[dict] = []  # plain-dict conversation; llm client converts

    # -- tool implementations -------------------------------------------------

    def _tool_run_username_scan(self, username: str) -> dict:
        try:
            findings = user_scanner_wrapper.scan(username, is_email=False, case_id=self.case_id)
            db.upsert_findings(findings, self.case_id)
            db.log(self.case_id, "agent_tool", "run_username_scan", {"username": username, "count": len(findings)})
            found = [f for f in findings if f["status"] == "found"]
            return {
                "scanned": username,
                "total_platforms": len(findings),
                "found_on": [f["platform"] for f in found],
            }
        except Exception as e:
            return {"scanned": username, "error": str(e)}

    def _tool_run_email_scan(self, email: str) -> dict:
        try:
            findings = user_scanner_wrapper.scan(email, is_email=True, case_id=self.case_id)
            breach = []
            try:
                breach = xposedornot_wrapper.check(email, self.case_id)
            except Exception as e:
                db.log(self.case_id, "agent_tool", "xposedornot", {"error": str(e)})
            all_findings = findings + breach
            db.upsert_findings(all_findings, self.case_id)
            db.log(self.case_id, "agent_tool", "run_email_scan", {"email": email, "count": len(all_findings)})
            return {
                "scanned": email,
                "platforms_found": [f["platform"] for f in findings if f["status"] == "found"],
                "breach_exposure": [b.get("extra_metadata", {}).get("breach_name") for b in breach if b["status"] == "found"],
            }
        except Exception as e:
            return {"scanned": email, "error": str(e)}

    def _tool_run_domain_scan(self, domain: str) -> dict:
        try:
            findings = spiderfoot_wrapper.scan(domain, self.case_id)
            db.upsert_findings(findings, self.case_id)
            db.log(self.case_id, "agent_tool", "run_domain_scan", {"domain": domain, "count": len(findings)})
            return {
                "scanned": domain,
                "findings_count": len(findings),
                "platforms": sorted({f["platform"] for f in findings}),
            }
        except Exception as e:
            return {"scanned": domain, "error": str(e)}

    def _tool_get_case_findings(self) -> dict:
        rows = db.list_findings(self.case_id)
        return {
            "count": len(rows),
            "by_status": {
                s: sum(1 for r in rows if r["status"] == s)
                for s in {r["status"] for r in rows}
            },
            "findings": [
                {k: r[k] for k in ("source_tool", "platform", "status", "identifier_value")}
                for r in rows
            ],
        }

    def _tool_get_reviewed_correlations(self) -> dict:
        rows = db.list_correlations(self.case_id, reviewed=True)
        return {
            "count": len(rows),
            "correlations": [
                {k: r[k] for k in ("type", "entities_involved", "confidence", "evidence", "priority", "review_note")}
                for r in rows
            ],
        }

    def _dispatch_tool(self, name: str, args: dict) -> dict:
        """Route a tool call to the right implementation. Unknown tool = error dict."""
        if name == "run_username_scan":
            return self._tool_run_username_scan(args["username"])
        if name == "run_email_scan":
            return self._tool_run_email_scan(args["email"])
        if name == "run_domain_scan":
            return self._tool_run_domain_scan(args["domain"])
        if name == "get_case_findings":
            return self._tool_get_case_findings()
        if name == "get_reviewed_correlations":
            return self._tool_get_reviewed_correlations()
        return {"error": f"unknown tool: {name}"}

    # -- main loop ------------------------------------------------------------

    def chat(self, user_message: str) -> dict:
        """Run the agent loop. Returns {text, iterations, tool_calls_made}."""
        self.history.append({"role": "user", "parts": [{"text": user_message}]})
        tool_calls_made: list[dict] = []
        iterations = 0
        final_text = ""

        for _ in range(MAX_LOOP_ITERATIONS):
            iterations += 1
            response = self.llm.send(self.history, SYSTEM_PROMPT, TOOL_SCHEMAS)

            if response.get("function_calls"):
                # append the model's response (with the function_call parts)
                model_parts = []
                if response.get("text"):
                    model_parts.append({"text": response["text"]})
                for fc in response["function_calls"]:
                    model_parts.append({"function_call": fc})
                self.history.append({"role": "model", "parts": model_parts})

                # execute each tool, build function_response parts
                response_parts = []
                for fc in response["function_calls"]:
                    result = self._dispatch_tool(fc["name"], fc.get("args", {}))
                    tool_calls_made.append({"name": fc["name"], "args": fc.get("args", {}), "result": result})
                    response_parts.append({
                        "function_response": {
                            "name": fc["name"],
                            "response": result,
                        }
                    })
                self.history.append({"role": "user", "parts": response_parts})
                # loop again — LLM sees the tool results
                continue

            # No function calls -> final answer
            final_text = response.get("text", "")
            self.history.append({"role": "model", "parts": [{"text": final_text}]})
            break
        else:
            final_text = "(agent loop hit max iterations)"

        return {
            "text": final_text,
            "iterations": iterations,
            "tool_calls_made": tool_calls_made,
        }


if __name__ == "__main__":
    # Self-test: drive the agent loop with a MockLLM that returns canned responses.
    # No real LLM, no real collectors — just the loop + tool dispatch.
    from agent.llm import LLMClient

    class MockLLM(LLMClient):
        def __init__(self, responses):
            self.responses = list(responses)
            self.calls = []

        def send(self, history, system_instruction, tools):
            self.calls.append({
                "history_len": len(history),
                "system_len": len(system_instruction),
                "tool_names": [t["name"] for t in tools],
            })
            if not self.responses:
                return {"text": "(mock exhausted)"}
            return self.responses.pop(0)

    # --- setup a case with findings + reviewed correlations ---
    cid = db.create_case([{"type": "username", "value": "agent_selftest"}])
    db.upsert_findings([
        {"identifier_type": "username", "identifier_value": "agent_selftest",
         "source_tool": "user-scanner", "platform": "github", "status": "found",
         "extra_metadata": {"bio": "OSINT enthusiast"},
         "collected_at": "2026-08-06T00:00:00Z"},
        {"identifier_type": "username", "identifier_value": "agent_selftest",
         "source_tool": "user-scanner", "platform": "twitter", "status": "found",
         "extra_metadata": {"bio": "OSINT enthusiast"},
         "collected_at": "2026-08-06T00:00:00Z"},
    ], cid)
    from core import correlate
    corrs = correlate.correlate(cid, db.list_findings(cid))
    db.insert_correlations(corrs, cid)
    # approve the first correlation
    db.set_reviewed(corrs[0]["id"], True, "smoke test approval")

    # --- drive the agent ---
    mock = MockLLM([
        # turn 1: LLM decides to inspect findings
        {"function_calls": [{"id": "fc1", "name": "get_case_findings", "args": {}}]},
        # turn 2: LLM pulls reviewed correlations
        {"function_calls": [{"id": "fc2", "name": "get_reviewed_correlations", "args": {}}]},
        # turn 3: LLM gives final narrative
        {"text": "agent_selftest appears on github and twitter with the same bio, suggesting the same operator (confidence 0.80)."},
    ])

    agent = Agent(cid, llm=mock)
    out = agent.chat("investigate agent_selftest")
    db.log(cid, "agent_chat", "test", {"iterations": out["iterations"]})

    # --- assertions ---
    assert out["iterations"] == 3, f"expected 3 iterations, got {out['iterations']}"
    assert len(out["tool_calls_made"]) == 2, f"expected 2 tool calls, got {len(out['tool_calls_made'])}"
    assert out["tool_calls_made"][0]["name"] == "get_case_findings"
    assert out["tool_calls_made"][1]["name"] == "get_reviewed_correlations"
    assert "github" in out["tool_calls_made"][0]["result"]["findings"][0]["platform"].lower() or \
           any("github" in str(f).lower() for f in out["tool_calls_made"][0]["result"]["findings"])
    # verify mock saw 5 tools, system prompt was loaded, history grew
    assert len(mock.calls) == 3
    assert set(mock.calls[0]["tool_names"]) == {
        "run_username_scan", "run_email_scan", "run_domain_scan",
        "get_case_findings", "get_reviewed_correlations",
    }
    assert mock.calls[0]["system_len"] > 200, "system prompt not loaded"
    # verify history grew correctly:
    #   1 user msg + 2*(model function_call + function_response) + 1 final model text = 6
    assert len(agent.history) == 6, f"expected 6 history entries, got {len(agent.history)}"

    # --- cleanup ---
    db._client().table("cases").delete().eq("id", cid).execute()
    print(f"orchestrator OK (iterations={out['iterations']}, tools_called={len(out['tool_calls_made'])})")
