"""Rules shared by the routes and the agent: ownership, rate limits, starting a scan."""
from __future__ import annotations

import logging
import math
import os
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from sherlock_core import config, uploads
from sherlock_core.jobs import normalize_target, plan_scan
from sherlock_core.store import LEGACY_OUTCOME, Store, get_store, window_reset_s

from gateway.auth import Principal
from gateway.visitors import Origin

log = logging.getLogger("sherlock.gateway.service")

Row = dict[str, Any]
DAY_S = 86400
TEN_MIN_S = 600
# LLM-backed routes (chat, variations) are not in the scan budget; cap them separately.
LLM_CALLS_PER_SESSION_PER_DAY = int(os.getenv("LLM_CALLS_PER_SESSION_PER_DAY", "60") or 60)

StoreDep = Annotated[Store, Depends(get_store)]

SEARCH_LOG_RETENTION_DAYS = 90
PURGE_EVERY_S = DAY_S
BLOCKED_MESSAGE = "This session has been blocked from running searches."
PAUSED_MESSAGE = "Searches are paused by the operator. Try again later."
SIGN_IN_MESSAGE = "Sign in to run a search. It's free and takes a few seconds."
ACTIVE_SEARCH_MESSAGE = ("Your previous search is still running. "
                         "You can start another when it finishes, or stop it.")
BUSY_MESSAGE = "Sherlock is busy right now. Try again in a few minutes."
BUSY_RETRY_S = 180
UPLOAD_NOT_YOURS_MESSAGE = "This uploaded photo belongs to another account."
_STATUS_OUTCOME = {429: "rate_limited", 403: "forbidden", 503: "paused", 401: "sign_in_required"}
_last_purge = 0.0


class SearchRefused(HTTPException):
    """An HTTPException that names its search_log outcome (when the status code alone is ambiguous).
    `retry_after` (seconds) becomes a Retry-After header; `extra` is merged into the JSON body
    next to `detail`."""

    def __init__(self, status_code: int, detail: str, outcome: str, *, retry_after: int | None = None,
                 extra: Row | None = None):
        super().__init__(status_code, detail, headers={"Retry-After": str(int(retry_after))} if retry_after else None)
        self.outcome = outcome
        self.extra = extra or {}


def is_operator(principal: Principal) -> bool:
    """A signed-in session whose VERIFIED email is in ADMIN_EMAILS."""
    return (not principal.is_anonymous and principal.email_verified
            and (principal.email or "").strip().lower() in config.ADMIN_EMAILS)


def wait_text(seconds: int) -> str:
    """'about a minute', 'about 7 minutes', 'about 3 hours'."""
    if seconds <= 90:
        return "about a minute"
    if seconds < 3600:
        return f"about {math.ceil(seconds / 60)} minutes"
    hours = round(seconds / 3600)
    return "about an hour" if hours <= 1 else f"about {hours} hours"


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
    if config.REQUIRE_SIGN_IN and principal.is_anonymous:
        raise SearchRefused(401, SIGN_IN_MESSAGE, "sign_in_required")


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
        row = {
            "user_id": principal.user_id, "case_id": attempt.case_id, "target_type": t["type"],
            # an uploaded photo is logged as "uploaded photo", never by its storage path
            "target_value": uploads.display_target(t["type"], t["value"]),
            "modules": t.get("modules"), "outcome": outcome, "detail": detail,
            "ip_hash": origin.ip_hash, "country": origin.country, "is_anonymous": principal.is_anonymous,
        }
        try:
            store.log_search(row)
        except Exception as e:
            if outcome not in LEGACY_OUTCOME:
                log.warning("search_log write failed: %s", type(e).__name__)
                continue
            # 0003_limits.sql not applied yet: its CHECK rejects the new outcome. Keep the row anyway.
            try:
                store.log_search({**row, "outcome": LEGACY_OUTCOME[outcome]})
            except Exception as e2:
                log.warning("search_log write failed: %s / %s", type(e).__name__, type(e2).__name__)
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


def check_upload_owner(principal: Principal, target_type: str, value: str) -> None:
    """An uploaded photo (`storage://media/uploads/<uid>/...`, already normalised) may only be
    searched by the account that uploaded it."""
    if target_type != "image" or not uploads.is_upload(value):
        return
    if uploads.parse_upload(value).owner_id != principal.user_id.lower():
        raise SearchRefused(403, UPLOAD_NOT_YOURS_MESSAGE, "forbidden")


def remove_case(store: Store, case: Row) -> None:
    """Delete a case and the photos uploaded for it (owner and operator deletion)."""
    removed = uploads.delete_case_uploads(store, case)
    store.delete_case(case["id"])
    if removed:
        log.info("deleted %s uploaded photo(s) with case %s", removed, case["id"])


def case_title(identifiers: list[Row]) -> str:
    """Default title: the first target's value ("Uploaded photo" for an upload, never its path)."""
    first = identifiers[0]
    return "Uploaded photo" if first["type"] == "image" and uploads.is_upload(first["value"]) else first["value"]


@dataclass(frozen=True)
class _Limit:
    key: str
    window_s: int
    limit: int
    hits: int                 # searches this request counts against the limit
    outcome: str
    message: str              # may contain {wait}


def _limits(principal: Principal, origin: Origin | None, target_types: list[str]) -> list[_Limit]:
    """Counters for one search request, in refusal order: burst/session, origin, daily."""
    uid, n = principal.user_id, len(target_types)
    names = sum(1 for t in target_types if t == "name")
    out: list[_Limit] = []
    if not is_operator(principal):
        if config.SEARCHES_PER_SESSION_PER_10M > 0:
            lim = config.SEARCHES_PER_SESSION_PER_10M
            out.append(_Limit(f"burst:session:{uid}:10m", TEN_MIN_S, lim, n, "burst_limited",
                              f"Too many searches in a short time: up to {lim} every 10 minutes. "
                              "You can search again in {wait}."))
        ip_hash = origin.ip_hash if origin else None
        if ip_hash and config.SEARCHES_PER_ORIGIN_PER_10M > 0:
            lim = config.SEARCHES_PER_ORIGIN_PER_10M
            out.append(_Limit(f"origin:{ip_hash}:10m", TEN_MIN_S, lim, n, "burst_limited",
                              f"Too many searches from your network in a short time: up to {lim} every 10 minutes. "
                              "You can search again in {wait}."))
        if ip_hash and config.SEARCHES_PER_ORIGIN_PER_DAY > 0:
            lim = config.SEARCHES_PER_ORIGIN_PER_DAY
            out.append(_Limit(f"origin:{ip_hash}:day", DAY_S, lim, n, "rate_limited",
                              f"Daily limit reached for your network: {lim} searches a day. "
                              "Try again in {wait}."))
        if names:
            lim = config.NAME_SEARCHES_PER_USER_PER_DAY
            out.append(_Limit(f"name:user:{uid}", DAY_S, lim, names, "rate_limited",
                              f"Daily limit reached: {lim} name searches per account. Try again in {{wait}}."))
        lim = config.SCANS_PER_SESSION_PER_DAY
        out.append(_Limit(f"scan:session:{uid}", DAY_S, lim, n, "rate_limited",
                          f"Daily limit reached: {lim} scans per session. Try again in {{wait}}."))
    out.append(_Limit("scan:global", DAY_S, config.SCANS_GLOBAL_PER_DAY, n, "rate_limited",
                      "Sherlock has reached its shared daily scan capacity on the free tier. Try again in {wait}."))
    return out


def _refuse(limit: _Limit) -> SearchRefused:
    wait = window_reset_s(limit.window_s)
    return SearchRefused(429, limit.message.replace("{wait}", wait_text(wait)), limit.outcome, retry_after=wait)


def check_active_search(store: Store, principal: Principal) -> None:
    """At most ACTIVE_SEARCHES_PER_SESSION unfinished searches per session (the operator is exempt)."""
    cap = config.ACTIVE_SEARCHES_PER_SESSION
    if cap <= 0 or is_operator(principal):
        return
    batches = store.active_batches(principal.user_id)
    if len(batches) < cap:
        return
    case_id = batches[0]["case_id"]
    raise SearchRefused(429, ACTIVE_SEARCH_MESSAGE, "active_search", extra={"active_search": {
        "case_id": case_id, "batch_ids": [b["batch_id"] for b in batches if b["case_id"] == case_id and b["batch_id"]],
    }})


def check_backlog(store: Store, queues: set[str]) -> None:
    """503 while a queue this search needs already holds more than QUEUE_BACKLOG_MAX queued jobs.
    Applies to everyone, the operator included."""
    if config.QUEUE_BACKLOG_MAX <= 0:
        return
    for q in sorted(queues):
        if store.count_queued(q) > config.QUEUE_BACKLOG_MAX:
            raise SearchRefused(503, BUSY_MESSAGE, "busy", retry_after=BUSY_RETRY_S)


def enforce_search_limits(store: Store, principal: Principal, origin: Origin | None,
                          target_types: list[str], queues: set[str]) -> None:
    """Every limit after validation, in order: active search, burst/session, origin, daily, backlog.
    Counters are only read until everything passed, so a refused search costs nothing; then each
    is counted atomically (a race lost at that point still refuses with that limit's message)."""
    check_active_search(store, principal)
    limits = _limits(principal, origin, target_types)
    for lim in limits:
        if store.rate_limit_count(lim.key, lim.window_s) + lim.hits > lim.limit:
            raise _refuse(lim)
    check_backlog(store, queues)
    for lim in limits:
        for _ in range(lim.hits):
            if not store.hit_rate_limit(lim.key, lim.window_s, lim.limit):
                raise _refuse(lim)


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


def claim_params(target_type: str, claim: Any) -> Row | None:
    """Job params for a photo claim (`schemas.PhotoClaim`): `{"claim": {...}}`. Image searches only."""
    if claim is None:
        return None
    if target_type != "image":
        raise HTTPException(400, "a claim is only accepted for photo searches (type \"image\")")
    normalized = claim.params()
    return {"claim": normalized} if normalized else None


def start_scan(store: Store, principal: Principal, case_id: str, target_type: str, value: str,
               modules: list[str] | None = None, *, actor: str = "user", params: Row | None = None,
               hints: Any = None, claim: Any = None, origin: Origin | None = None) -> list[Row]:
    """Enforce, validate, authorise, rate-limit and enqueue one scan batch, and log the attempt
    (one search_log row, whatever the outcome). Raises HTTPException."""
    with search_attempt(store, principal, origin, [{"type": target_type, "value": value}], case_id) as attempt:
        check_scans_allowed(store, principal)
        if hints is not None:
            params = name_params(target_type, hints)
        if claim is not None:
            params = {**(params or {}), **(claim_params(target_type, claim) or {})}
        check_target_allowed(principal, target_type)
        planned = plan_or_400(case_id, target_type, value, modules, params=params)
        check_upload_owner(principal, target_type, planned[0]["target_value"])
        attempt.targets = [{"type": target_type, "value": planned[0]["target_value"],
                            "modules": [j["module"] for j in planned]}]
        enforce_search_limits(store, principal, origin, [target_type], {j["queue"] for j in planned})
        return enqueue_planned(store, principal, case_id, planned, actor=actor)


GEO_MODULE = "geo_context"
NO_PHOTO_MESSAGE = "This investigation has no photo to check."


def case_photos(store: Store, case: Row) -> list[str]:
    """Image targets of a case: its identifiers first, then photos searched later in it."""
    values = [i["value"] for i in case.get("identifiers") or [] if i.get("type") == "image"]
    for j in reversed(store.list_jobs(case["id"])):                 # oldest first
        if j.get("target_type") == "image" and j["target_value"] not in values:
            values.append(j["target_value"])
    return values


def start_geo_check(store: Store, principal: Principal, case: Row, value: str | None, claim: Any,
                    *, origin: Origin | None = None) -> list[Row]:
    """Set (or clear) the claim of a photo in an existing case and re-run `geo_context` only.

    Checked like a search for who may run it (blocked, paused, sign-in, the photo's owner, backlog)
    and logged in search_log, but limited on its own (GEO_CHECKS_PER_CASE_PER_10M,
    GEO_CHECKS_PER_SESSION_PER_DAY) instead of by the search limits: it is one light job and the
    photo's search may still be running. A previous unfinished check of the same photo is cancelled.
    """
    case_id = case["id"]
    photos = case_photos(store, case)
    if not photos:
        raise HTTPException(400, NO_PHOTO_MESSAGE)
    target = normalize_or_400("image", value) if value else photos[0]
    if target not in photos:
        raise HTTPException(400, "That photo is not part of this investigation.")
    with search_attempt(store, principal, origin, [{"type": "image", "value": target, "modules": [GEO_MODULE]}],
                        case_id):
        check_scans_allowed(store, principal)
        check_upload_owner(principal, "image", target)
        planned = plan_or_400(case_id, "image", target, [GEO_MODULE], params=claim_params("image", claim))
        limits = [
            (f"geo:case:{case_id}:10m", TEN_MIN_S, config.GEO_CHECKS_PER_CASE_PER_10M, "burst_limited",
             f"Too many re-checks of this photo: up to {config.GEO_CHECKS_PER_CASE_PER_10M} every 10 minutes. "
             "Try again in {wait}."),
            (f"geo:session:{principal.user_id}:day", DAY_S, config.GEO_CHECKS_PER_SESSION_PER_DAY, "rate_limited",
             f"Daily limit reached: {config.GEO_CHECKS_PER_SESSION_PER_DAY} photo re-checks per session. "
             "Try again in {wait}."),
        ]
        limits = [lim for lim in limits if lim[2] > 0]
        for key, window, limit, outcome, message in limits:
            if store.rate_limit_count(key, window) >= limit:
                raise _refuse(_Limit(key, window, limit, 1, outcome, message))
        check_backlog(store, {planned[0]["queue"]})
        for key, window, limit, outcome, message in limits:
            if not store.hit_rate_limit(key, window, limit):
                raise _refuse(_Limit(key, window, limit, 1, outcome, message))
        for job in store.list_jobs(case_id, active_only=True):
            if job.get("module") == GEO_MODULE and job.get("target_value") == target:
                store.cancel_job(job["id"])
        jobs = enqueue_planned(store, principal, case_id, planned, actor="user")
        store.log(case_id, "photo_claim_set", "user", {
            "user": principal.user_id, "claim": (planned[0].get("params") or {}).get("claim"),
            "target": uploads.display_target("image", target), "batch_id": planned[0]["batch_id"],
        })
        return jobs
