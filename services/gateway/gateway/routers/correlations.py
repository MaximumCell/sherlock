"""Correlations router: list (with reviewed filter) + review (approve/reject)."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from sherlock_core import db
from gateway.schemas import ReviewIn

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


@router.post("/cases/{case_id}/correlations")
def create_correlation(
    case_id: str,
    body: dict,
):
    """Manually link two findings in a case.

    The investigator decides two findings are the same person, even if
    the auto-correlate engine didn't pick it up. We create a row in
    `correlations` with type="manual" and high confidence (1.0).
    """
    if not db._client().table("cases").select("id").eq("id", case_id).execute().data:
        raise HTTPException(404, "case not found")
    finding_a = body.get("finding_a")
    finding_b = body.get("finding_b")
    note = body.get("note")
    if not finding_a or not finding_b:
        raise HTTPException(400, "finding_a and finding_b are required")
    if finding_a == finding_b:
        raise HTTPException(400, "cannot link a finding to itself")
    # Verify both findings exist in this case
    rows = (
        db._client()
        .table("raw_findings")
        .select("id,identifier_value,platform")
        .eq("case_id", case_id)
        .in_("id", [finding_a, finding_b])
        .execute()
        .data
    )
    if len(rows) != 2:
        raise HTTPException(404, "one or both findings not in this case")
    entities = [f"{case_id}:{finding_a}", f"{case_id}:{finding_b}"]
    a_label = next((r["identifier_value"] for r in rows if r["id"] == finding_a), "")
    b_label = next((r["identifier_value"] for r in rows if r["id"] == finding_b), "")
    evidence = [f"manual link: {a_label} ↔ {b_label}"]
    if note:
        evidence.append(f"note: {note}")
    row = {
        "case_id": case_id,
        "type": "manual",
        "entities_involved": entities,
        "confidence": 1.0,
        "evidence": evidence,
        "priority": 1.0,
        "reviewed": True,
    }
    inserted = db._client().table("correlations").insert(row).execute().data
    db.log(case_id, "manual_link", "user", {
        "finding_a": finding_a,
        "finding_b": finding_b,
        "note": note,
    })
    return inserted[0] if inserted else row
