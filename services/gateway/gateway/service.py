"""Rules shared by the routes and the agent: ownership, rate limits, starting a scan."""
from __future__ import annotations

import os
import uuid
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from sherlock_core import config
from sherlock_core.jobs import normalize_target, plan_scan
from sherlock_core.store import Store, get_store

from gateway.auth import Principal

Row = dict[str, Any]
DAY_S = 86400
# LLM-backed routes (chat, variations) are not in the scan budget; cap them separately.
LLM_CALLS_PER_SESSION_PER_DAY = int(os.getenv("LLM_CALLS_PER_SESSION_PER_DAY", "60") or 60)

StoreDep = Annotated[Store, Depends(get_store)]


def is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def load_case(store: Store, case_id: str, principal: Principal, *, write: bool) -> Row:
    """Load a case the caller may use. Demo cases are readable by everyone and writable by no one."""
    case = store.get_case(case_id) if is_uuid(case_id) else None
    if case is None:
        raise HTTPException(404, "case not found")
    if case.get("is_demo"):
        if write:
            raise HTTPException(403, "demo cases are read-only")
        return case
    if case.get("owner_id") != principal.user_id:
        raise HTTPException(403, "this case belongs to another session")
    return case


def check_target_allowed(principal: Principal, target_type: str) -> None:
    if target_type == "name" and principal.is_anonymous:
        raise HTTPException(403, "Searching by name requires a signed-in account. Sign in and try again.")


def consume_scan_quota(store: Store, principal: Principal, target_type: str) -> None:
    """Count one scan against the caller. 429 with a readable message when a limit is hit."""
    if target_type == "name" and not store.hit_rate_limit(
        f"name:user:{principal.user_id}", DAY_S, config.NAME_SEARCHES_PER_USER_PER_DAY
    ):
        raise HTTPException(
            429, f"Daily limit reached: {config.NAME_SEARCHES_PER_USER_PER_DAY} name searches per account. "
                 "Try again tomorrow.")
    if not store.hit_rate_limit(f"scan:session:{principal.user_id}", DAY_S, config.SCANS_PER_SESSION_PER_DAY):
        raise HTTPException(
            429, f"Daily limit reached: {config.SCANS_PER_SESSION_PER_DAY} scans per session. Try again tomorrow.")
    if not store.hit_rate_limit("scan:global", DAY_S, config.SCANS_GLOBAL_PER_DAY):
        raise HTTPException(
            429, "Sherlock has reached its shared daily scan capacity on the free tier. Try again tomorrow.")


def consume_llm_quota(store: Store, principal: Principal) -> None:
    if not store.hit_rate_limit(f"llm:session:{principal.user_id}", DAY_S, LLM_CALLS_PER_SESSION_PER_DAY):
        raise HTTPException(429, "Daily assistant limit reached for this session. Try again tomorrow.")


def plan_or_400(case_id: str, target_type: str, value: str, modules: list[str] | None = None,
                params: Row | None = None) -> list[Row]:
    try:
        return plan_scan(case_id, target_type, value, modules, params=params)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


def normalize_or_400(target_type: str, value: str) -> str:
    try:
        return normalize_target(target_type, value)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


def enqueue_planned(store: Store, principal: Principal, case_id: str, planned: list[Row], *, actor: str) -> list[Row]:
    """Insert one planned batch, make its target an entity, audit it."""
    first = planned[0]
    jobs = store.enqueue_jobs(planned)
    store.upsert_entities(case_id, [{"kind": first["target_type"], "value": first["target_value"], "is_seed": True}])
    store.log(case_id, "scan_queued", actor, {
        "batch_id": first["batch_id"], "type": first["target_type"], "value": first["target_value"],
        "modules": [j["module"] for j in planned], "user": principal.user_id,
    })
    if first["target_type"] == "name":   # searches for a person are audited on their own, with who asked
        store.log(case_id, "name_search", actor, {
            "batch_id": first["batch_id"], "value": first["target_value"], "hints": first.get("params") or {},
            "user": principal.user_id,
        })
    return jobs


def name_params(target_type: str, hints: Any) -> Row | None:
    """Job params for a scan's hints (`schemas.NameHints`). Hints only make sense for a name search."""
    if hints is None:
        return None
    if target_type != "name":
        raise HTTPException(400, "hints are only accepted for name searches (type \"name\")")
    return hints.params()


def start_scan(store: Store, principal: Principal, case_id: str, target_type: str, value: str,
               modules: list[str] | None = None, *, actor: str = "user", params: Row | None = None) -> list[Row]:
    """Validate, authorise, rate-limit and enqueue one scan batch. Raises HTTPException."""
    check_target_allowed(principal, target_type)
    planned = plan_or_400(case_id, target_type, value, modules, params=params)
    consume_scan_quota(store, principal, target_type)
    return enqueue_planned(store, principal, case_id, planned, actor=actor)
