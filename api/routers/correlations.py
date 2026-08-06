"""Correlations router: list (with reviewed filter) + review (approve/reject)."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core import db
from api.schemas import ReviewIn

router = APIRouter(tags=["correlations"])


@router.get("/cases/{case_id}/correlations")
def list_correlations(case_id: str, reviewed: Optional[bool] = None):
    """List correlations for a case. ?reviewed=true|false to filter."""
    if not db._client().table("cases").select("id").eq("id", case_id).execute().data:
        raise HTTPException(404, "case not found")
    return db.list_correlations(case_id, reviewed=reviewed)


@router.post("/correlations/{correlation_id}/review")
def review_correlation(correlation_id: str, body: ReviewIn):
    """Approve (set reviewed=true, keep row) or Reject (delete row)."""
    rows = db._client().table("correlations").select("case_id").eq("id", correlation_id).execute().data
    if not rows:
        raise HTTPException(404, "correlation not found")
    case_id = rows[0]["case_id"]

    if body.decision == "approve":
        db.set_reviewed(correlation_id, True, body.note)
        db.log(case_id, "correlation_review", "user", {"correlation_id": correlation_id, "decision": "approve", "note": body.note})
        return {"id": correlation_id, "decision": "approve", "note": body.note}
    else:
        db._client().table("correlations").delete().eq("id", correlation_id).execute()
        db.log(case_id, "correlation_review", "user", {"correlation_id": correlation_id, "decision": "reject", "note": body.note})
        return {"id": correlation_id, "decision": "reject", "note": body.note}
