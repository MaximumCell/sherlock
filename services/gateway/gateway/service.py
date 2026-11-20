"""Rules shared by the routes and the agent: ownership, rate limits, starting a scan."""
from __future__ import annotations

import logging
import os
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from sherlock_core import config
from sherlock_core.jobs import normalize_target, plan_scan
from sherlock_core.store import Store, get_store

from gateway.auth import Principal
from gateway.visitors import Origin

log = logging.getLogger("sherlock.gateway.service")

Row = dict[str, Any]
DAY_S = 86400
# LLM-backed routes (chat, variations) are not in the scan budget; cap them separately.
LLM_CALLS_PER_SESSION_PER_DAY = int(os.getenv("LLM_CALLS_PER_SESSION_PER_DAY", "60") or 60)

StoreDep = Annotated[Store, Depends(get_store)]

SEARCH_LOG_RETENTION_DAYS = 90
PURGE_EVERY_S = DAY_S
BLOCKED_MESSAGE = "This session has been blocked from running searches."
PAUSED_MESSAGE = "Searches are paused by the operator. Try again later."
_STATUS_OUTCOME = {429: "rate_limited", 403: "forbidden", 503: "paused"}
_last_purge = 0.0


class SearchRefused(HTTPException):
    """An HTTPException that names its search_log outcome (when the status code alone is ambiguous)."""

    def __init__(self, status_code: int, detail: str, outcome: str):
        super().__init__(status_code, detail)
        self.outcome = outcome


def outcome_of(exc: HTTPException) -> str:
    return getattr(exc, "outcome", None) or _STATUS_OUTCOME.get(exc.status_code, "invalid")


def scans_paused(store: Store) -> bool:
    try:
        return store.get_setting("scans_paused", False) is True
    except Exception as e:  # app_settings missing: searches stay open (fail open, logged)
        log.warning("could not read scans_paused: %s", type(e).__name__)
        return False


def check_scans_allowed(store: Store, principal: Principal) -> None:
    """Operator enforcement, before anything is planned or queued: blocked session, then pause."""
    try:
        session = store.get_session(principal.user_id)
    except Exception as e:
        log.warning("could not read visitor session: %s", type(e).__name__)
        session = None
    if session and session.get("blocked"):
        raise SearchRefused(403, BLOCKED_MESSAGE, "blocked")
    if scans_paused(store):
        raise SearchRefused(503, PAUSED_MESSAGE, "paused")


@dataclass
class SearchAttempt:
    """The targets of one search request, as logged. Callers replace `targets` once values are normalised
    and modules are planned, and set `case_id` once the case exists."""
    targets: list[Row]
    case_id: str | None = None
    extra: Row = field(default_factory=dict)


def _maybe_purge(store: Store) -> None:
    global _last_purge
    now = time.monotonic()
    if _last_purge and now - _last_purge < PURGE_EVERY_S:
        return
    _last_purge = now
    try:
        removed = store.purge_search_log(SEARCH_LOG_RETENTION_DAYS)
        if removed:
            log.info("purged %s search_log rows older than %s days", removed, SEARCH_LOG_RETENTION_DAYS)
    except Exception as e:
        log.warning("search_log purge failed: %s", type(e).__name__)


def record_searches(store: Store, principal: Principal, origin: Origin | None, attempt: SearchAttempt,
                    outcome: str, detail: str | None = None) -> None:
    """One search_log row per target. Never raises: logging must not change the answer."""
    origin = origin or Origin()
    for t in attempt.targets:
        try:
            store.log_search({
                "user_id": principal.user_id, "case_id": attempt.case_id, "target_type": t["type"],
                "target_value": t["value"], "modules": t.get("modules"), "outcome": outcome, "detail": detail,
                "ip_hash": origin.ip_hash, "country": origin.country, "is_anonymous": principal.is_anonymous,
            })
        except Exception as e:
            log.warning("search_log write failed: %s", type(e).__name__)
    _maybe_purge(store)


@contextmanager
def search_attempt(store: Store, principal: Principal, origin: Origin | None, targets: list[Row],
                   case_id: str | None = None) -> Iterator[SearchAttempt]:
    """Log every target of a search request with its outcome: `accepted` when the block finishes,
    otherwise the outcome of the HTTPException that refused it (re-raised unchanged)."""
    attempt = SearchAttempt(targets=targets, case_id=case_id)
    try:
        yield attempt
    except HTTPException as e:
        record_searches(store, principal, origin, attempt, outcome_of(e), str(e.detail))
        raise
    record_searches(store, principal, origin, attempt, "accepted")


def reset_purge_clock() -> None:
    """Tests: allow the next search to purge again."""
    global _last_purge
    _last_purge = 0.0


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
        raise SearchRefused(403, "Searching by name requires a signed-in account. Sign in and try again.",
                            "forbidden")


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
               modules: list[str] | None = None, *, actor: str = "user", params: Row | None = None,
               hints: Any = None, origin: Origin | None = None) -> list[Row]:
    """Enforce, validate, authorise, rate-limit and enqueue one scan batch, and log the attempt
    (one search_log row, whatever the outcome). Raises HTTPException."""
    with search_attempt(store, principal, origin, [{"type": target_type, "value": value}], case_id) as attempt:
        check_scans_allowed(store, principal)
        if hints is not None:
            params = name_params(target_type, hints)
        check_target_allowed(principal, target_type)
        planned = plan_or_400(case_id, target_type, value, modules, params=params)
        attempt.targets = [{"type": target_type, "value": planned[0]["target_value"],
                            "modules": [j["module"] for j in planned]}]
        consume_scan_quota(store, principal, target_type)
        return enqueue_planned(store, principal, case_id, planned, actor=actor)
