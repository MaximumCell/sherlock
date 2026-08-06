"""Audit router: list entries, optional case_id filter."""
from typing import Optional

from fastapi import APIRouter, Query

from core import db

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
def list_audit(case_id: Optional[str] = Query(None), limit: int = Query(100, ge=1, le=500)):
    q = db._client().table("audit_log").select("*").order("created_at", desc=True).limit(limit)
    if case_id:
        q = q.eq("case_id", case_id)
    return q.execute().data
