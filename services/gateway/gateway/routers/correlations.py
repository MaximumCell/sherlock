"""Human review of correlations. A decision changes `status`; rows are never deleted here.

`same_account` rows are automatic merges: "reject" splits the account and "reset"
merges it again (status back to approved, the engine's default for them). Either way
the case is re-correlated, because links between accounts depend on the grouping.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sherlock_core.jobs import recorrelate
from sherlock_core.models import Correlation

from gateway.auth import CurrentPrincipal
from gateway.schemas import ReviewRequest
from gateway.service import StoreDep, is_uuid, load_case

router = APIRouter(prefix="/correlations", tags=["correlations"])

_STATUS = {"approve": "approved", "reject": "rejected", "reset": "pending"}


@router.post("/{correlation_id}/review", response_model=Correlation)
def review(correlation_id: str, body: ReviewRequest, principal: CurrentPrincipal, store: StoreDep):
    corr = store.get_correlation(correlation_id) if is_uuid(correlation_id) else None
    if corr is None:
        raise HTTPException(404, "correlation not found")
    load_case(store, corr["case_id"], principal, write=True)
    same_account = corr.get("type") == "same_account"
    status = "approved" if same_account and body.decision == "reset" else _STATUS[body.decision]
    row = store.set_correlation_status(correlation_id, status, body.note)
    if row is None:
        raise HTTPException(404, "correlation not found")
    if same_account and status != corr.get("status"):
        recorrelate(corr["case_id"], store)
        row = store.get_correlation(correlation_id) or row
    store.log(corr["case_id"], f"correlation_{body.decision}", "user", {
        "correlation_id": correlation_id, "note": body.note,
    })
    return row
