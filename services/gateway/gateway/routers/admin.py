"""Operator panel API (`/admin/*`). See docs/CONTRACTS.md, "Operator panel".

Only a signed-in (non-anonymous) session whose VERIFIED email is in ADMIN_EMAILS may use it.
Everyone else, including callers without a token, gets the same 404 as an unknown path, so the
surface is not revealed (the routes are also left out of the OpenAPI schema).

Reads come from the service-side store only; the tables are never exposed to browsers. Case
data is metadata only (title, targets, counts): never findings. Every action is audit-logged
with the operator's email.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from sherlock_core import config
from sherlock_core.store import Store

from gateway.auth import Principal, TokenVerifier, get_principal, get_token_verifier
from gateway.insights import (
    FLAG_WINDOW_DAYS,
    SEVERITY_ORDER,
    day_series,
    origin_session_counts,
    session_flags,
    target_session_counts,
)
from gateway.schemas import (
    AdminCaseView,
    AdminMe,
    BlockRequest,
    Overview,
    PauseRequest,
    PauseState,
    SearchOutcome,
    SearchPage,
    SessionDetail,
    SessionPage,
    VisitorSession,
)
from gateway.service import DAY_S, SEARCH_LOG_RETENTION_DAYS, StoreDep, is_operator, is_uuid, scans_paused

log = logging.getLogger("sherlock.gateway.admin")
Row = dict[str, Any]

NOT_FOUND = "Not Found"            # identical to an unknown route
CONTEXT_MAX_SESSIONS = 5000
CONTEXT_MAX_SEARCHES = 20000
TOP_TARGETS = 10


def is_admin(principal: Principal) -> bool:
    return is_operator(principal)


async def require_admin(
    request: Request,
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    try:
        principal = await get_principal(request, verifier, authorization)
    except HTTPException:
        raise HTTPException(404, NOT_FOUND) from None
    if not is_admin(principal):
        raise HTTPException(404, NOT_FOUND)
    return principal


Admin = Annotated[Principal, Depends(require_admin)]
router = APIRouter(prefix="/admin", tags=["admin"], include_in_schema=False)


def _audit(store: Store, admin: Principal, action: str, detail: Row) -> None:
    store.log(None, f"operator_{action}", "operator", {"admin": admin.email, **detail})


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def _day_start(days: int) -> datetime:
    today = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return today - timedelta(days=days - 1)


# ----------------------------------------------------------------------------- shared context
class Context:
    """Recent activity needed to explain sessions: their searches and who shares targets and origins."""

    def __init__(self, store: Store):
        since = _iso(datetime.now(UTC) - timedelta(days=FLAG_WINDOW_DAYS))
        self.searches = store.list_searches(since=since, limit=CONTEXT_MAX_SEARCHES)
        self.sessions = store.list_sessions(active_since=since, limit=CONTEXT_MAX_SESSIONS)
        self.by_user: dict[str, list[Row]] = {}
        for r in self.searches:
            self.by_user.setdefault(str(r["user_id"]), []).append(r)
        self.targets = target_session_counts(self.searches)
        self.origins = origin_session_counts(self.sessions, self.searches)

    def flags(self, session: Row) -> list[Row]:
        return session_flags(self.by_user.get(str(session["user_id"]), []), ip_hash=session.get("ip_hash"),
                             target_sessions=self.targets, origin_sessions=self.origins)

    def brief(self, session: Row | None) -> Row | None:
        if session is None:
            return None
        return {
            "user_id": str(session["user_id"]), "is_anonymous": bool(session.get("is_anonymous")),
            "email": session.get("email"), "user_agent": session.get("user_agent"),
            "country": session.get("country"), "origin": session.get("ip_hash"),
            "origin_sessions": self.origins.get(session.get("ip_hash") or "", 1 if session.get("ip_hash") else 0),
            "blocked": bool(session.get("blocked")),
        }

    def visitor(self, session: Row) -> Row:
        return {
            **(self.brief(session) or {}),
            **{k: session.get(k) for k in ("first_seen", "last_seen", "blocked_at", "blocked_reason")},
            "search_count": int(session.get("search_count") or 0),
            "refused_count": int(session.get("refused_count") or 0),
            "flags": self.flags(session),
        }


def _search_rows(rows: list[Row], sessions: dict[str, Row], ctx: Context) -> list[Row]:
    keys = ("id", "created_at", "user_id", "case_id", "target_type", "target_value", "modules", "outcome",
            "detail", "country", "is_anonymous")
    return [{**{k: r.get(k) for k in keys}, "user_id": str(r["user_id"]),
             "session": ctx.brief(sessions.get(str(r["user_id"])))} for r in rows]


def _int_cursor(cursor: str | None) -> int | None:
    if cursor is None or cursor == "":
        return None
    if not cursor.isdigit():
        raise HTTPException(422, "cursor: not a valid cursor")
    return int(cursor)


# ----------------------------------------------------------------------------- routes
@router.get("/me", response_model=AdminMe)
def me(admin: Admin):
    return {"is_admin": True, "email": admin.email}


@router.get("/overview", response_model=Overview)
def overview(admin: Admin, store: StoreDep, days: Annotated[int, Query(ge=1, le=90)] = 14):
    start = _day_start(days)
    stats = store.search_stats(_iso(start), max_rows=CONTEXT_MAX_SEARCHES)
    ctx = Context(store)
    flagged = sum(1 for s in ctx.sessions if ctx.flags(s))
    accepted = stats["by_outcome"].get("accepted", 0)
    repeated = [t for t in stats["targets"] if t["count"] >= 2][:TOP_TARGETS]
    return {
        "days": days, "since": _iso(start), "retention_days": SEARCH_LOG_RETENTION_DAYS,
        "truncated": stats["truncated"], "scans_paused": scans_paused(store),
        "totals": {"searches": stats["rows"], "accepted": accepted, "refused": stats["rows"] - accepted,
                   "sessions": stats["sessions"], "flagged_sessions": flagged,
                   "cases": store.count_cases(), "active_jobs": store.count_active_jobs()},
        "series": day_series(stats["by_day"], start.date(), days),
        "by_type": [{"target_type": k, "count": v}
                    for k, v in sorted(stats["by_type"].items(), key=lambda kv: (-kv[1], kv[0]))],
        "top_targets": repeated,
        "quota": {"global_used_today": store.rate_limit_count("scan:global", DAY_S),
                  "global_limit": config.SCANS_GLOBAL_PER_DAY,
                  "per_session_limit": config.SCANS_PER_SESSION_PER_DAY,
                  "name_per_user_limit": config.NAME_SEARCHES_PER_USER_PER_DAY},
    }


@router.get("/searches", response_model=SearchPage)
def searches(admin: Admin, store: StoreDep,
             outcome: Annotated[SearchOutcome | None, Query()] = None,
             type: Annotated[str | None, Query(max_length=20)] = None,
             q: Annotated[str | None, Query(max_length=120)] = None,
             session: Annotated[str | None, Query(max_length=64)] = None,
             since: Annotated[datetime | None, Query()] = None,
             limit: Annotated[int, Query(ge=1, le=200)] = 50,
             cursor: Annotated[str | None, Query(max_length=20)] = None):
    """The search feed, newest first. `cursor` is the `next_cursor` of the previous page."""
    if session and not is_uuid(session):
        return {"items": [], "next_cursor": None}
    rows = store.list_searches(since=_iso(since) if since else None, outcome=outcome, target_type=type or None,
                               q=q, user_id=session or None, before_id=_int_cursor(cursor), limit=limit + 1)
    page, more = rows[:limit], len(rows) > limit
    ctx = Context(store)
    ids = sorted({str(r["user_id"]) for r in page})
    sessions = {str(s["user_id"]): s for s in store.list_sessions(user_ids=ids, limit=max(len(ids), 1))}
    return {"items": _search_rows(page, sessions, ctx), "next_cursor": str(page[-1]["id"]) if more else None}


@router.get("/sessions", response_model=SessionPage)
def sessions(admin: Admin, store: StoreDep,
             flagged: Annotated[bool | None, Query()] = None,
             blocked: Annotated[bool | None, Query()] = None,
             q: Annotated[str | None, Query(max_length=120)] = None,
             limit: Annotated[int, Query(ge=1, le=200)] = 50,
             cursor: Annotated[str | None, Query(max_length=20)] = None):
    """Visitors, most recently seen first (flagged=true: most severe first). Offset cursor."""
    offset = _int_cursor(cursor) or 0
    ctx = Context(store)
    if flagged is None:
        rows = store.list_sessions(q=q, blocked=blocked, limit=limit + 1, offset=offset)
        items = [ctx.visitor(s) for s in rows]
    else:
        everyone = [ctx.visitor(s) for s in store.list_sessions(q=q, blocked=blocked, limit=CONTEXT_MAX_SESSIONS)]
        items = [v for v in everyone if bool(v["flags"]) == flagged]
        if flagged:
            items.sort(key=lambda v: (min(SEVERITY_ORDER[f["severity"]] for f in v["flags"]), -len(v["flags"])))
        items = items[offset:offset + limit + 1]
    more = len(items) > limit
    return {"items": items[:limit], "next_cursor": str(offset + limit) if more else None}


def _session_or_404(store: Store, user_id: str) -> Row:
    row = store.get_session(user_id) if is_uuid(user_id) else None
    if row is None:
        raise HTTPException(404, "visitor not found")
    return row


@router.get("/sessions/{user_id}", response_model=SessionDetail)
def session_detail(user_id: str, admin: Admin, store: StoreDep):
    """One visitor: their searches (newest 200) and their cases as metadata (never findings)."""
    row = _session_or_404(store, user_id)
    ctx = Context(store)
    rows = store.list_searches(user_id=user_id, limit=200)
    return {"session": ctx.visitor(row), "searches": _search_rows(rows, {user_id: row}, ctx),
            "cases": store.case_overview(user_id)}


@router.post("/sessions/{user_id}/block", response_model=VisitorSession)
def block(user_id: str, body: BlockRequest, admin: Admin, store: StoreDep):
    _session_or_404(store, user_id)
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(422, "reason: give a short reason")
    row = store.set_session_blocked(user_id, True, reason)
    _audit(store, admin, "session_blocked", {"user_id": user_id, "reason": reason})
    return Context(store).visitor(row or {})


@router.post("/sessions/{user_id}/unblock", response_model=VisitorSession)
def unblock(user_id: str, admin: Admin, store: StoreDep):
    _session_or_404(store, user_id)
    row = store.set_session_blocked(user_id, False)
    _audit(store, admin, "session_unblocked", {"user_id": user_id})
    return Context(store).visitor(row or {})


@router.post("/pause", response_model=PauseState)
def pause(body: PauseRequest, admin: Admin, store: StoreDep):
    store.set_setting("scans_paused", body.paused, admin.email)
    _audit(store, admin, "scans_paused" if body.paused else "scans_resumed", {})
    return {"scans_paused": scans_paused(store)}


ADMIN_CASE_FINDINGS_MAX = 2000


@router.get("/cases/{case_id}", response_model=AdminCaseView)
def view_case(case_id: str, admin: Admin, store: StoreDep,
              findings_limit: Annotated[int, Query(ge=1, le=ADMIN_CASE_FINDINGS_MAX)] = 1000,
              findings_offset: Annotated[int, Query(ge=0)] = 0):
    """Any visitor's case in full (findings, links, entities, jobs, history), READ-ONLY, for abuse review.
    Every opening (the first page) is written to the case's own audit log (`admin_case_viewed`),
    which its owner can see."""
    case = store.get_case(case_id) if is_uuid(case_id) else None
    if case is None:
        raise HTTPException(404, "case not found")
    if findings_offset == 0:          # one entry per opening, not per page of findings
        store.log(case_id, "admin_case_viewed", "operator", {"admin": admin.email})
    findings = store.list_findings(case_id)
    page = findings[findings_offset:findings_offset + findings_limit]
    end = findings_offset + len(page)
    return {
        "case": case, "findings": page, "findings_total": len(findings),
        "findings_next_offset": end if end < len(findings) else None,
        "correlations": store.list_correlations(case_id), "entities": store.list_entities(case_id),
        "jobs": store.list_jobs(case_id), "audit": store.list_audit(case_id, limit=500),
    }


@router.delete("/cases/{case_id}", status_code=204, response_class=Response, response_model=None)
def delete_case(case_id: str, admin: Admin, store: StoreDep):
    """Operator removal of a case (and its findings). The search log keeps its rows, without the case id."""
    case = store.get_case(case_id) if is_uuid(case_id) else None
    if case is None:
        raise HTTPException(404, "case not found")
    if case.get("is_demo"):
        raise HTTPException(400, "demo cases are part of the app and cannot be removed here")
    store.delete_case(case_id)
    _audit(store, admin, "case_deleted", {"case_id": case_id, "owner_id": case.get("owner_id"),
                                          "title": case.get("title")})
    return Response(status_code=204)


@router.api_route("/{rest:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
def not_found(rest: str):
    """Any other method or path under /admin looks exactly like an unknown route (no 405 hints)."""
    raise HTTPException(404, NOT_FOUND)
