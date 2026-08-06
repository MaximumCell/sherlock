"""Cases router: CRUD + run + findings + report + chat."""
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from core import db, pipeline
from core.report import generate_markdown
from agent.orchestrator import Agent
from api.schemas import CaseCreate, CaseOut, ChatIn, ChatOut, FindingOut

router = APIRouter(prefix="/cases", tags=["cases"])


def _to_case_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "identifiers": row["identifiers"],
        "status": row["status"],
        "created_at": row["created_at"],
    }


def _get_case(case_id: str) -> dict:
    rows = db._client().table("cases").select("*").eq("id", case_id).execute().data
    if not rows:
        raise HTTPException(404, "case not found")
    return rows[0]


@router.post("", status_code=201)
def create_case(body: CaseCreate):
    payload = [i.model_dump() for i in body.identifiers]
    case_id = db.create_case(payload)
    return _to_case_out(_get_case(case_id))


@router.get("")
def list_cases():
    rows = db._client().table("cases").select("*").order("created_at", desc=True).execute().data
    return [_to_case_out(r) for r in rows]


@router.get("/{case_id}")
def get_case(case_id: str):
    return _to_case_out(_get_case(case_id))


@router.delete("/{case_id}", status_code=204)
def delete_case(case_id: str):
    _get_case(case_id)  # 404 if missing
    db.log(case_id, "case_deleted", "api", {})  # log BEFORE delete (FK to cases)
    db._client().table("cases").delete().eq("id", case_id).execute()
    return None


@router.post("/{case_id}/run")
def run_case(case_id: str):
    """Run all collectors + correlation for the case. Synchronous for v1."""
    case = _get_case(case_id)
    pipeline.run_case(case["identifiers"], case_id=case_id)
    return _to_case_out(_get_case(case_id))


@router.get("/{case_id}/findings")
def list_findings(case_id: str):
    _get_case(case_id)
    return db.list_findings(case_id)


@router.post("/{case_id}/report", response_class=PlainTextResponse)
def generate_report(case_id: str):
    _get_case(case_id)
    md = generate_markdown(case_id)
    db.log(case_id, "report", "api", {"length": len(md)})
    return md


@router.get("/{case_id}/report", response_class=PlainTextResponse)
def get_report(case_id: str):
    """Regenerate the report on demand (deterministic from current data)."""
    _get_case(case_id)
    return generate_markdown(case_id)


@router.post("/{case_id}/chat", response_model=ChatOut)
def chat_with_agent(case_id: str, body: ChatIn):
    """Send a message to the LLM agent for this case. Synchronous v1."""
    _get_case(case_id)
    agent = Agent(case_id)
    out = agent.chat(body.message)
    db.log(case_id, "agent_chat", "api", {
        "iterations": out["iterations"],
        "tool_calls": [tc["name"] for tc in out["tool_calls_made"]],
    })
    return out
