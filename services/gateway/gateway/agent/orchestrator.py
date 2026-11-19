"""Agent orchestrator. Owns a case, holds the LLM client, runs the function-call loop.

Tools:
  - run_username_scan / run_email_scan / run_domain_scan   enqueue a scan batch (non-blocking)
  - get_scan_status                                        jobs of this case
  - get_case_findings                                      what the modules produced
  - get_reviewed_correlations                              approved correlations only

Scans go through the same path as `POST /cases/{id}/scan` (validation, name/anonymous
rule, rate limits, durable job queue). The agent narrates only from
get_reviewed_correlations (system_prompt.md rule 2); correlation is code's job.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sherlock_core.store import Store, get_store

from gateway.agent.llm import LLMClient, default_client
from gateway.auth import Principal
from gateway.service import start_scan

SYSTEM_PROMPT = (Path(__file__).parent / "system_prompt.md").read_text()

MAX_LOOP_ITERATIONS = 10
MAX_FINDINGS_IN_TOOL_RESULT = 300


def _scan_tool(name: str, what: str, arg: str, arg_desc: str) -> dict:
    return {
        "name": name,
        "description": (
            f"Queue a scan of {what} with every available module for that target type. "
            "Returns immediately with status 'queued' and a batch_id; results arrive in the case "
            "over the next minutes. Use get_scan_status to see progress."
        ),
        "parameters": {
            "type": "object",
            "properties": {arg: {"type": "string", "description": arg_desc}},
            "required": [arg],
        },
    }


TOOL_SCHEMAS = [
    _scan_tool("run_username_scan", "a username across public platforms", "username", "The username to scan (no @)."),
    _scan_tool("run_email_scan", "an email address (account presence and breach exposure metadata)", "email",
               "The email to scan."),
    _scan_tool("run_domain_scan", "a domain (DNS, certificates and other public records)", "domain",
               "The domain to scan."),
    {
        "name": "get_scan_status",
        "description": "Return the scan jobs of the current case with their status and progress.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_case_findings",
        "description": "Return the raw findings (any status) for the current case. Use to inspect what the modules produced.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "get_reviewed_correlations",
        "description": "Return ONLY correlations a human approved for the current case. You may only narrate from this output.",
        "parameters": {"type": "object", "properties": {}},
    },
]

_SCAN_TOOLS = {"run_username_scan": "username", "run_email_scan": "email", "run_domain_scan": "domain"}


class Agent:
    def __init__(self, case_id: str, llm: LLMClient | None = None, *,
                 principal: Principal | None = None, store: Store | None = None):
        self.case_id = case_id
        self.llm = llm or default_client()
        self.store = store or get_store()
        self.principal = principal
        self.history: list[dict] = []  # plain-dict conversation; the llm client converts
        self.queues_to_wake: set[str] = set()

    # -- tool implementations -------------------------------------------------

    def _tool_scan(self, target_type: str, value: str) -> dict:
        if self.principal is None:
            return {"scanned": value, "error": "scans need an authenticated session"}
        try:
            jobs = start_scan(self.store, self.principal, self.case_id, target_type, value, actor="agent")
        except HTTPException as e:
            return {"scanned": value, "error": str(e.detail)}
        self.queues_to_wake.update(j["queue"] for j in jobs)
        return {
            "scanned": jobs[0]["target_value"],
            "status": "queued",
            "batch_id": jobs[0]["batch_id"],
            "modules": [j["module"] for j in jobs],
            "note": "The scan runs in the background. Findings appear in the case as modules finish.",
        }

    def _tool_get_scan_status(self) -> dict:
        jobs = self.store.list_jobs(self.case_id)
        return {
            "count": len(jobs),
            "active": sum(1 for j in jobs if j["status"] in ("queued", "running")),
            "jobs": [
                {k: j.get(k) for k in ("batch_id", "module", "target_type", "target_value", "status",
                                       "progress", "progress_note", "result", "error")}
                for j in jobs[:100]
            ],
        }

    def _tool_get_case_findings(self) -> dict:
        rows = self.store.list_findings(self.case_id)
        found_first = sorted(rows, key=lambda r: r["status"] != "found")
        return {
            "count": len(rows),
            "by_status": {s: sum(1 for r in rows if r["status"] == s) for s in sorted({r["status"] for r in rows})},
            "truncated": len(rows) > MAX_FINDINGS_IN_TOOL_RESULT,
            "findings": [
                {k: r[k] for k in ("source_tool", "platform", "status", "identifier_value")}
                for r in found_first[:MAX_FINDINGS_IN_TOOL_RESULT]
            ],
        }

    def _tool_get_reviewed_correlations(self) -> dict:
        rows = self.store.list_correlations(self.case_id, status="approved")
        return {
            "count": len(rows),
            "correlations": [
                {k: r.get(k) for k in ("type", "matched_value", "entities_involved", "confidence",
                                       "evidence", "priority", "review_note")}
                for r in rows
            ],
        }

    def _dispatch_tool(self, name: str, args: dict[str, Any]) -> dict:
        """Route a tool call to the right implementation. Unknown tool or bad args = error dict."""
        if name in _SCAN_TOOLS:
            target_type = _SCAN_TOOLS[name]
            value = args.get(target_type)
            if not isinstance(value, str) or not value.strip():
                return {"error": f"{name} needs a '{target_type}' argument"}
            return self._tool_scan(target_type, value)
        if name == "get_scan_status":
            return self._tool_get_scan_status()
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
                model_parts: list[dict] = []
                if response.get("text"):
                    model_parts.append({"text": response["text"]})
                model_parts.extend({"function_call": fc} for fc in response["function_calls"])
                self.history.append({"role": "model", "parts": model_parts})

                response_parts = []
                for fc in response["function_calls"]:
                    args = fc.get("args") or {}
                    result = self._dispatch_tool(fc["name"], args)
                    tool_calls_made.append({"name": fc["name"], "args": args, "result": result})
                    response_parts.append({"function_response": {"name": fc["name"], "response": result}})
                self.history.append({"role": "user", "parts": response_parts})
                continue  # the LLM sees the tool results

            final_text = response.get("text", "")
            self.history.append({"role": "model", "parts": [{"text": final_text}]})
            break
        else:
            final_text = "(agent loop hit max iterations)"

        return {"text": final_text, "iterations": iterations, "tool_calls_made": tool_calls_made}
