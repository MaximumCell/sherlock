"""Storage layer. Everything that touches the database goes through a `Store`.

`SupabaseStore` talks to Supabase (PostgREST + RPC) with the service key.
`MemoryStore` implements the same behaviour in memory for offline tests.

Use `get_store()` in application code; tests call `set_store(MemoryStore())`.
"""
from __future__ import annotations

import copy
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sherlock_core import config
from sherlock_core.models import finding_key, now_iso

log = logging.getLogger("sherlock.store")

Row = dict[str, Any]
PAGE = 1000  # PostgREST caps responses at 1000 rows


def _discriminator(f: Row) -> str:
    """Separates multiple rows from one source about one identifier (legacy collectors)."""
    meta = f.get("extra_metadata") or {}
    return str(meta.get("breach_name") or meta.get("date_compromised") or "")


def prepare_finding(f: Row, case_id: str, job_id: str | None = None) -> Row:
    row = {k: v for k, v in f.items() if k not in ("id", "curated")}
    row["case_id"] = case_id
    row.setdefault("module", row.get("source_tool"))
    if not row.get("finding_key"):
        row["finding_key"] = finding_key(
            row["source_tool"], row["platform"], row["identifier_value"], _discriminator(row)
        )
    if job_id:
        row["job_id"] = job_id
    return row


class Store:
    """Interface. Method docs here are the contract for both implementations."""

    # ---- cases
    def create_case(self, identifiers: list[Row], *, owner_id: str | None = None,
                    title: str | None = None, tags: list[str] | None = None) -> Row: raise NotImplementedError
    def get_case(self, case_id: str) -> Row | None: raise NotImplementedError
    def list_cases(self, owner_id: str | None) -> list[Row]: raise NotImplementedError
    def update_case(self, case_id: str, fields: Row) -> Row | None: raise NotImplementedError
    def delete_case(self, case_id: str) -> None: raise NotImplementedError

    # ---- findings
    def upsert_findings(self, findings: list[Row], case_id: str, job_id: str | None = None) -> list[Row]:
        """Insert or update by (case_id, finding_key). Never touches `curated`."""
        raise NotImplementedError
    def list_findings(self, case_id: str, *, status: str | None = None,
                      curated: bool | None = None) -> list[Row]: raise NotImplementedError
    def set_curated(self, finding_id: str, curated: bool) -> Row | None: raise NotImplementedError
    def get_finding(self, finding_id: str) -> Row | None: raise NotImplementedError

    # ---- correlations
    def sync_correlations(self, case_id: str, corrs: list[Row]) -> list[Row]:
        """Make the stored engine correlations match `corrs`, keyed by corr_key.

        New keys are inserted as pending, or with the row's own `status` when the
        engine supplies one (`same_account` rows arrive "approved": merged
        automatically; `reviewed_at` is then set). Existing keys get fresh evidence,
        confidence and members but KEEP status / review_note / reviewed_at, so a
        supplied status never overrides a human decision. Pending rows the engine no
        longer produces are deleted, and so are approved `same_account` rows (automatic
        merges that no longer apply); other approved rows and every rejected row are
        kept (a human decided on them; a rejected `same_account` row is a split).
        Manual links (corr_key starting with 'manual:') are never touched. Returns all rows.
        """
        raise NotImplementedError
    def insert_correlation(self, corr: Row, case_id: str) -> Row: raise NotImplementedError
    def list_correlations(self, case_id: str, *, status: str | None = None) -> list[Row]: raise NotImplementedError
    def set_correlation_status(self, correlation_id: str, status: str,
                               note: str | None = None) -> Row | None: raise NotImplementedError
    def get_correlation(self, correlation_id: str) -> Row | None: raise NotImplementedError

    # ---- entities
    def upsert_entities(self, case_id: str, entities: list[Row]) -> None:
        """Insert by (case_id, kind, value); existing rows are left alone."""
        raise NotImplementedError
    def list_entities(self, case_id: str) -> list[Row]: raise NotImplementedError
    def mark_entity_scanned(self, case_id: str, kind: str, value: str) -> None: raise NotImplementedError

    # ---- jobs
    def enqueue_jobs(self, jobs: list[Row]) -> list[Row]: raise NotImplementedError
    def claim_job(self, queue: str, worker: str) -> Row | None:
        """Atomically take the oldest queued job; requeue/fail jobs with a stale heartbeat."""
        raise NotImplementedError
    def heartbeat(self, job_id: str, progress: int | None = None, note: str | None = None) -> None: raise NotImplementedError
    def complete_job(self, job_id: str, result: Row) -> None: raise NotImplementedError
    def fail_job(self, job_id: str, error: str, *, retry: bool = True, delay_s: int = 15) -> Row | None:
        """retry=True requeues while attempts < max_attempts, otherwise marks failed."""
        raise NotImplementedError
    def get_job(self, job_id: str) -> Row | None: raise NotImplementedError
    def cancel_job(self, job_id: str) -> Row | None:
        """Mark a queued or running job cancelled (finished jobs are left alone). Returns the row."""
        raise NotImplementedError
    def list_jobs(self, case_id: str, *, active_only: bool = False) -> list[Row]: raise NotImplementedError
    def queued_queues(self) -> set[str]:
        """Queues that currently have queued jobs (used to decide which workers to wake)."""
        raise NotImplementedError

    # ---- misc
    def log(self, case_id: str | None, action: str, actor: str, detail: Row | None = None) -> None: raise NotImplementedError
    def list_audit(self, case_id: str | None = None, limit: int = 200) -> list[Row]: raise NotImplementedError
    def hit_rate_limit(self, key: str, window_s: int, limit: int) -> bool:
        """Count one hit; True while the caller is within `limit` for the window."""
        raise NotImplementedError
    def rate_limit_count(self, key: str, window_s: int) -> int:
        """Hits counted so far for `key` in the current window (0 when none). Counts nothing."""
        raise NotImplementedError

    # ---- operator panel: visitor_sessions, search_log, app_settings (service key only, never browsers)
    def touch_session(self, user_id: str, *, is_anonymous: bool, email: str | None = None,
                      ip_hash: str | None = None, country: str | None = None,
                      user_agent: str | None = None) -> None:
        """Create or refresh one visitor row. Sets `last_seen` (and `first_seen` on insert only),
        `is_anonymous` and `email`; `ip_hash`, `country` and `user_agent` are updated only when given
        (None keeps the stored value). Never changes counters or the blocked state. `user_agent` is
        truncated to 300 characters. Raw IP addresses are never passed here."""
        raise NotImplementedError
    def get_session(self, user_id: str) -> Row | None:
        """One visitor row, or None."""
        raise NotImplementedError
    def list_sessions(self, *, q: str | None = None, blocked: bool | None = None,
                      user_ids: list[str] | None = None, active_since: str | None = None,
                      limit: int = 50, offset: int = 0) -> list[Row]:
        """Visitor rows, most recently seen first. `q` matches part of the email, or the exact
        `ip_hash` or `user_id`; `blocked` filters on the flag; `user_ids` restricts to those rows;
        `active_since` (ISO time) keeps rows with `last_seen >= active_since`."""
        raise NotImplementedError
    def set_session_blocked(self, user_id: str, blocked: bool, reason: str | None = None) -> Row | None:
        """Block (sets `blocked_at`, `blocked_reason`) or unblock (clears both) a visitor.
        Returns the row, or None when there is no such visitor."""
        raise NotImplementedError
    def log_search(self, row: Row) -> Row:
        """Append one search_log row (`user_id, target_type, target_value, outcome` required; optional
        `case_id, modules, detail, ip_hash, country, is_anonymous`). `outcome` is one of
        SEARCH_OUTCOMES. Bumps the visitor's `search_count` (accepted) or `refused_count` (any other
        outcome). Returns the stored row with `id` and `created_at`; ids increase with time."""
        raise NotImplementedError
    def list_searches(self, *, since: str | None = None, outcome: str | None = None,
                      target_type: str | None = None, q: str | None = None, user_id: str | None = None,
                      before_id: int | None = None, limit: int = 50) -> list[Row]:
        """search_log rows, newest first (by id). `q` matches part of `target_value`
        (case-insensitive); `before_id` returns rows with a smaller id (keyset pagination)."""
        raise NotImplementedError
    def detach_case_searches(self, case_id: str) -> None:
        """Set `case_id` to null on the case's search_log rows (the log outlives the case)."""
        raise NotImplementedError
    def purge_search_log(self, days: int = 90) -> int:
        """Delete search_log rows older than `days` days. Returns how many were deleted."""
        raise NotImplementedError
    def get_setting(self, key: str, default: Any = None) -> Any:
        """The JSON value of an app_settings key, or `default` when unset."""
        raise NotImplementedError
    def set_setting(self, key: str, value: Any, updated_by: str | None = None) -> None:
        """Insert or replace an app_settings value (records `updated_at`, `updated_by`)."""
        raise NotImplementedError
    def case_overview(self, owner_id: str) -> list[Row]:
        """The owner's cases as METADATA only (`id, title, identifiers, status, created_at,
        archived_at, job_count, found_count`), newest first. Never findings."""
        raise NotImplementedError
    def count_cases(self) -> int:
        """Number of non-demo cases."""
        raise NotImplementedError
    def count_active_jobs(self) -> int:
        """Number of queued or running jobs."""
        raise NotImplementedError

    def search_stats(self, since: str, *, max_rows: int = 20000) -> Row:
        """Aggregates of search_log rows created since `since` (UTC days):
        `{rows, sessions (distinct user ids), truncated, by_day: {YYYY-MM-DD: {outcome: n}}, by_type: {type: n},
        by_outcome: {outcome: n}, targets: [{target_type, target_value, count, sessions}]}`.
        `targets` lists every target with its search count and distinct-session count,
        most searched first. At most `max_rows` rows are read (`truncated` says so)."""
        rows = self.list_searches(since=since, limit=max_rows)
        return aggregate_searches(rows, truncated=len(rows) >= max_rows)


SEARCH_OUTCOMES = ("accepted", "rate_limited", "blocked", "paused", "forbidden", "invalid")
USER_AGENT_MAX = 300
TARGET_MAX = 300


def aggregate_searches(rows: list[Row], *, truncated: bool = False) -> Row:
    """Pure aggregation behind `Store.search_stats` (shared by both stores)."""
    by_day: dict[str, dict[str, int]] = {}
    by_type: dict[str, int] = {}
    by_outcome: dict[str, int] = {}
    targets: dict[tuple[str, str], dict[str, Any]] = {}
    for r in rows:
        day = str(r["created_at"])[:10]
        by_day.setdefault(day, {})
        by_day[day][r["outcome"]] = by_day[day].get(r["outcome"], 0) + 1
        by_type[r["target_type"]] = by_type.get(r["target_type"], 0) + 1
        by_outcome[r["outcome"]] = by_outcome.get(r["outcome"], 0) + 1
        t = targets.setdefault((r["target_type"], r["target_value"]), {"count": 0, "sessions": set()})
        t["count"] += 1
        t["sessions"].add(str(r["user_id"]))
    ranked = sorted(targets.items(), key=lambda kv: (-kv[1]["count"], kv[0]))
    return {
        "rows": len(rows), "sessions": len({str(r["user_id"]) for r in rows}), "truncated": truncated, "by_day": by_day, "by_type": by_type, "by_outcome": by_outcome,
        "targets": [{"target_type": k[0], "target_value": k[1], "count": v["count"], "sessions": len(v["sessions"])}
                    for k, v in ranked],
    }


def _window_start(window_s: int) -> datetime:
    return datetime.fromtimestamp(int(datetime.now(UTC).timestamp() // window_s) * window_s, UTC)


def _search_row(row: Row) -> Row:
    if row.get("outcome") not in SEARCH_OUTCOMES:
        raise ValueError(f"unknown search outcome: {row.get('outcome')!r}")
    out = {k: row.get(k) for k in ("user_id", "case_id", "target_type", "target_value", "modules", "detail",
                                   "ip_hash", "country")}
    out.update(outcome=row["outcome"], is_anonymous=bool(row.get("is_anonymous", True)),
               target_value=str(row["target_value"])[:TARGET_MAX],
               detail=str(row["detail"])[:500] if row.get("detail") else None)
    return out


_SAFE_Q = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@._+-")


def safe_query(q: str | None) -> str:
    """A search box value reduced to characters that are safe inside a PostgREST filter."""
    return "".join(ch for ch in (q or "") if ch in _SAFE_Q)[:120]


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


_CORR_ENGINE_FIELDS = ("type", "matched_value", "entities_involved", "confidence", "evidence", "priority")
_STATUSES = ("pending", "approved", "rejected")


def _initial_status(c: Row) -> Row:
    """Review fields for a NEW engine row: its own status when valid, else pending."""
    status = c.get("status") if c.get("status") in _STATUSES else "pending"
    return {"status": status, "reviewed_at": None if status == "pending" else now_iso()}


def _stale(key: str, row: Row, wanted: dict[str, Row]) -> bool:
    if key in wanted or key.startswith("manual:"):
        return False
    return row.get("status") == "pending" or (row.get("type") == "same_account" and row.get("status") == "approved")


class SupabaseStore(Store):
    def __init__(self, url: str | None = None, key: str | None = None):
        url, key = url or config.SUPABASE_URL, key or config.SUPABASE_SERVICE_KEY
        if not url or not key:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set")
        from supabase import create_client
        self.c = create_client(url, key)

    def _t(self, name: str):
        return self.c.table(name)

    @staticmethod
    def _all(query) -> list[Row]:
        rows: list[Row] = []
        start = 0
        while True:
            page = query.range(start, start + PAGE - 1).execute().data or []
            rows.extend(page)
            if len(page) < PAGE:
                return rows
            start += PAGE

    @staticmethod
    def _one(res) -> Row | None:
        return res.data[0] if res.data else None

    # ---- cases
    def create_case(self, identifiers, *, owner_id=None, title=None, tags=None):
        row = {"identifiers": identifiers, "owner_id": owner_id, "title": title, "tags": tags or []}
        return self._t("cases").insert(row).execute().data[0]

    def get_case(self, case_id):
        return self._one(self._t("cases").select("*").eq("id", case_id).execute())

    def list_cases(self, owner_id):
        q = self._t("cases").select("*").order("created_at", desc=True)
        q = q.eq("owner_id", owner_id) if owner_id else q.is_("owner_id", "null")
        return self._all(q)

    def update_case(self, case_id, fields):
        return self._one(self._t("cases").update(fields).eq("id", case_id).execute())

    def delete_case(self, case_id):
        self._t("cases").delete().eq("id", case_id).execute()
        try:
            self.detach_case_searches(case_id)
        except Exception as e:  # search_log missing (0002_admin.sql not applied yet): deletion still counts
            log.warning("could not detach search_log rows of case %s: %s", case_id, type(e).__name__)

    # ---- findings
    def upsert_findings(self, findings, case_id, job_id=None):
        if not findings:
            return []
        dedup: dict[str, Row] = {}
        for f in findings:
            row = prepare_finding(f, case_id, job_id)
            dedup[row["finding_key"]] = row
        rows = list(dedup.values())
        out: list[Row] = []
        for i in range(0, len(rows), 500):
            res = self._t("raw_findings").upsert(rows[i:i + 500], on_conflict="case_id,finding_key").execute()
            out.extend(res.data or [])
        return out

    def list_findings(self, case_id, *, status=None, curated=None):
        q = self._t("raw_findings").select("*").eq("case_id", case_id)
        if status:
            q = q.eq("status", status)
        if curated is not None:
            q = q.eq("curated", curated)
        return self._all(q.order("collected_at"))

    def set_curated(self, finding_id, curated):
        return self._one(self._t("raw_findings").update({"curated": curated}).eq("id", finding_id).execute())

    def get_finding(self, finding_id):
        return self._one(self._t("raw_findings").select("*").eq("id", finding_id).execute())

    # ---- correlations
    def sync_correlations(self, case_id, corrs):
        existing = {r["corr_key"]: r for r in self.list_correlations(case_id)}
        wanted = {c["corr_key"]: c for c in corrs}
        new_rows = [
            {**{k: c.get(k) for k in _CORR_ENGINE_FIELDS}, **_initial_status(c), "corr_key": k, "case_id": case_id}
            for k, c in wanted.items() if k not in existing
        ]
        if new_rows:
            self._t("correlations").insert(new_rows).execute()
        for k, c in wanted.items():
            old = existing.get(k)
            if old and any(old.get(f) != c.get(f) for f in _CORR_ENGINE_FIELDS):
                self._t("correlations").update({f: c.get(f) for f in _CORR_ENGINE_FIELDS}).eq("id", old["id"]).execute()
        stale = [r["id"] for k, r in existing.items() if _stale(k, r, wanted)]
        for i in range(0, len(stale), 100):
            self._t("correlations").delete().in_("id", stale[i:i + 100]).execute()
        return self.list_correlations(case_id)

    def insert_correlation(self, corr, case_id):
        return self._t("correlations").insert({**corr, "case_id": case_id}).execute().data[0]

    def list_correlations(self, case_id, *, status=None):
        q = self._t("correlations").select("*").eq("case_id", case_id)
        if status:
            q = q.eq("status", status)
        return self._all(q.order("priority", desc=True))

    def set_correlation_status(self, correlation_id, status, note=None):
        upd: Row = {"status": status, "reviewed_at": None if status == "pending" else now_iso()}
        if note is not None:
            upd["review_note"] = note
        return self._one(self._t("correlations").update(upd).eq("id", correlation_id).execute())

    def get_correlation(self, correlation_id):
        return self._one(self._t("correlations").select("*").eq("id", correlation_id).execute())

    # ---- entities
    def upsert_entities(self, case_id, entities):
        if not entities:
            return
        rows = [{**e, "case_id": case_id} for e in entities]
        self._t("entities").upsert(rows, on_conflict="case_id,kind,value", ignore_duplicates=True).execute()

    def list_entities(self, case_id):
        return self._all(self._t("entities").select("*").eq("case_id", case_id).order("first_seen"))

    def mark_entity_scanned(self, case_id, kind, value):
        self._t("entities").update({"scanned": True}).eq("case_id", case_id).eq("kind", kind).eq("value", value).execute()

    # ---- jobs
    def enqueue_jobs(self, jobs):
        return self._t("jobs").insert(jobs).execute().data if jobs else []

    def claim_job(self, queue, worker):
        res = self.c.rpc("claim_job", {
            "p_queue": queue, "p_worker": worker, "p_stale_seconds": config.JOB_STALE_SECONDS,
        }).execute()
        return res.data[0] if res.data else None

    def heartbeat(self, job_id, progress=None, note=None):
        upd: Row = {"heartbeat_at": now_iso()}
        if progress is not None:
            upd["progress"] = max(0, min(100, int(progress)))
        if note is not None:
            upd["progress_note"] = note
        self._t("jobs").update(upd).eq("id", job_id).eq("status", "running").execute()

    def complete_job(self, job_id, result):
        self._t("jobs").update({
            "status": "succeeded", "progress": 100, "result": result,
            "finished_at": now_iso(), "locked_by": None,
        }).eq("id", job_id).execute()

    def fail_job(self, job_id, error, *, retry=True, delay_s=15):
        job = self.get_job(job_id)
        if not job:
            return None
        if retry and job["attempts"] < job["max_attempts"]:
            upd: Row = {
                "status": "queued", "error": error[:2000], "locked_by": None,
                "run_after": (datetime.now(UTC) + timedelta(seconds=delay_s * job["attempts"])).isoformat(),
            }
        else:
            upd = {"status": "failed", "error": error[:2000], "finished_at": now_iso(), "locked_by": None}
        return self._one(self._t("jobs").update(upd).eq("id", job_id).execute())

    def get_job(self, job_id):
        return self._one(self._t("jobs").select("*").eq("id", job_id).execute())

    def cancel_job(self, job_id):
        self._t("jobs").update({
            "status": "cancelled", "finished_at": now_iso(), "locked_by": None,
        }).eq("id", job_id).in_("status", ["queued", "running"]).execute()
        return self.get_job(job_id)

    def list_jobs(self, case_id, *, active_only=False):
        q = self._t("jobs").select("*").eq("case_id", case_id)
        if active_only:
            q = q.in_("status", ["queued", "running"])
        return self._all(q.order("created_at", desc=True))

    def queued_queues(self):
        rows = self._t("jobs").select("queue").eq("status", "queued").limit(200).execute().data or []
        return {r["queue"] for r in rows}

    # ---- misc
    def log(self, case_id, action, actor, detail=None):
        self._t("audit_log").insert({
            "case_id": case_id, "action": action, "actor": actor, "detail": detail or {},
        }).execute()

    def list_audit(self, case_id=None, limit=200):
        q = self._t("audit_log").select("*").order("created_at", desc=True).limit(limit)
        if case_id:
            q = q.eq("case_id", case_id)
        return q.execute().data or []

    def hit_rate_limit(self, key, window_s, limit):
        res = self.c.rpc("hit_rate_limit", {"p_key": key, "p_window_seconds": window_s, "p_limit": limit}).execute()
        return bool(res.data)

    def rate_limit_count(self, key, window_s):
        row = self._one(self._t("rate_limits").select("count").eq("key", key)
                        .eq("window_start", _window_start(window_s).isoformat()).execute())
        return int(row["count"]) if row else 0

    # ---- operator panel
    def touch_session(self, user_id, *, is_anonymous, email=None, ip_hash=None, country=None, user_agent=None):
        row: Row = {"user_id": user_id, "is_anonymous": is_anonymous, "email": email, "last_seen": now_iso()}
        for k, v in (("ip_hash", ip_hash), ("country", country),
                     ("user_agent", user_agent[:USER_AGENT_MAX] if user_agent else None)):
            if v is not None:
                row[k] = v
        self._t("visitor_sessions").upsert(row, on_conflict="user_id", default_to_null=False).execute()

    def get_session(self, user_id):
        if not _is_uuid(user_id):
            return None
        return self._one(self._t("visitor_sessions").select("*").eq("user_id", user_id).execute())

    def list_sessions(self, *, q=None, blocked=None, user_ids=None, active_since=None, limit=50, offset=0):
        query = self._t("visitor_sessions").select("*")
        q = safe_query(q)
        if q:
            ors = [f"email.ilike.*{q}*", f"ip_hash.eq.{q}"]
            if _is_uuid(q):
                ors.append(f"user_id.eq.{q}")
            query = query.or_(",".join(ors))
        if blocked is not None:
            query = query.eq("blocked", blocked)
        if user_ids is not None:
            if not user_ids:
                return []
            query = query.in_("user_id", user_ids)
        if active_since:
            query = query.gte("last_seen", active_since)
        query = query.order("last_seen", desc=True)
        if limit > PAGE:
            return self._all(query)[offset:offset + limit]
        return query.range(offset, offset + limit - 1).execute().data or []

    def set_session_blocked(self, user_id, blocked, reason=None):
        if not _is_uuid(user_id):
            return None
        upd: Row = ({"blocked": True, "blocked_at": now_iso(), "blocked_reason": reason} if blocked
                    else {"blocked": False, "blocked_at": None, "blocked_reason": None})
        return self._one(self._t("visitor_sessions").update(upd).eq("user_id", user_id).execute())

    def log_search(self, row):
        # visitor counters are kept by the trg_search_log_counts trigger (0002_admin.sql)
        return self._t("search_log").insert(_search_row(row)).execute().data[0]

    def list_searches(self, *, since=None, outcome=None, target_type=None, q=None, user_id=None,
                      before_id=None, limit=50):
        query = self._t("search_log").select("*")
        if since:
            query = query.gte("created_at", since)
        if outcome:
            query = query.eq("outcome", outcome)
        if target_type:
            query = query.eq("target_type", target_type)
        q = safe_query(q)
        if q:
            query = query.ilike("target_value", f"%{q}%")
        if user_id:
            if not _is_uuid(user_id):
                return []
            query = query.eq("user_id", user_id)
        if before_id is not None:
            query = query.lt("id", before_id)
        query = query.order("id", desc=True)
        if limit > PAGE:
            return self._all(query)[:limit]
        return query.limit(limit).execute().data or []

    def detach_case_searches(self, case_id):
        self._t("search_log").update({"case_id": None}).eq("case_id", case_id).execute()

    def purge_search_log(self, days=90):
        res = self.c.rpc("purge_old_search_log", {"p_days": days}).execute()
        return int(res.data or 0)

    def get_setting(self, key, default=None):
        row = self._one(self._t("app_settings").select("value").eq("key", key).execute())
        return default if row is None or row.get("value") is None else row["value"]

    def set_setting(self, key, value, updated_by=None):
        self._t("app_settings").upsert({"key": key, "value": value, "updated_at": now_iso(),
                                        "updated_by": updated_by}, on_conflict="key").execute()

    def case_overview(self, owner_id):
        cases = self._all(self._t("cases").select("id,title,identifiers,status,created_at,archived_at")
                          .eq("owner_id", owner_id).order("created_at", desc=True))
        ids = [c["id"] for c in cases]
        jobs: dict[str, int] = {}
        found: dict[str, int] = {}
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            for r in self._all(self._t("jobs").select("case_id").in_("case_id", chunk)):
                jobs[r["case_id"]] = jobs.get(r["case_id"], 0) + 1
            for r in self._all(self._t("raw_findings").select("case_id").in_("case_id", chunk).eq("status", "found")):
                found[r["case_id"]] = found.get(r["case_id"], 0) + 1
        return [{**c, "job_count": jobs.get(c["id"], 0), "found_count": found.get(c["id"], 0)} for c in cases]

    def count_cases(self):
        res = self._t("cases").select("id", count="exact").eq("is_demo", False).limit(1).execute()
        return int(res.count or 0)

    def count_active_jobs(self):
        res = self._t("jobs").select("id", count="exact").in_("status", ["queued", "running"]).limit(1).execute()
        return int(res.count or 0)


class MemoryStore(Store):
    """In-memory Store with the same semantics, for offline tests."""

    def __init__(self) -> None:
        self.cases: dict[str, Row] = {}
        self.findings: dict[str, Row] = {}
        self.correlations: dict[str, Row] = {}
        self.entities: dict[tuple[str, str, str], Row] = {}
        self.jobs: dict[str, Row] = {}
        self.audit: list[Row] = []
        self.rate: dict[tuple[str, int], int] = {}
        self.sessions: dict[str, Row] = {}
        self.search_log: list[Row] = []
        self.settings: dict[str, Row] = {}
        self._purged = 0
        self.stale_seconds = config.JOB_STALE_SECONDS

    @staticmethod
    def _id() -> str:
        return str(uuid.uuid4())

    @staticmethod
    def _cp(row: Row | None) -> Row | None:
        return copy.deepcopy(row) if row else None

    # ---- cases
    def create_case(self, identifiers, *, owner_id=None, title=None, tags=None):
        row = {
            "id": self._id(), "identifiers": identifiers, "owner_id": owner_id, "title": title,
            "tags": tags or [], "notes": "", "status": "new", "is_demo": False,
            "created_at": now_iso(), "updated_at": now_iso(), "archived_at": None,
        }
        self.cases[row["id"]] = row
        return copy.deepcopy(row)

    def get_case(self, case_id):
        return self._cp(self.cases.get(case_id))

    def list_cases(self, owner_id):
        rows = [c for c in self.cases.values() if c["owner_id"] == owner_id]
        return copy.deepcopy(sorted(rows, key=lambda c: c["created_at"], reverse=True))

    def update_case(self, case_id, fields):
        if case_id not in self.cases:
            return None
        self.cases[case_id].update(fields, updated_at=now_iso())
        return self.get_case(case_id)

    def delete_case(self, case_id):
        self.cases.pop(case_id, None)
        for table in (self.findings, self.correlations, self.jobs):
            for k in [k for k, r in table.items() if r["case_id"] == case_id]:
                del table[k]
        for k in [k for k in self.entities if k[0] == case_id]:
            del self.entities[k]
        self.detach_case_searches(case_id)

    # ---- findings
    def upsert_findings(self, findings, case_id, job_id=None):
        out = []
        for f in findings:
            row = prepare_finding(f, case_id, job_id)
            old = next((r for r in self.findings.values()
                        if r["case_id"] == case_id and r["finding_key"] == row["finding_key"]), None)
            if old:
                old.update(row)
                out.append(copy.deepcopy(old))
            else:
                row = {"id": self._id(), "curated": False, "job_id": None, **row}
                self.findings[row["id"]] = row
                out.append(copy.deepcopy(row))
        return out

    def list_findings(self, case_id, *, status=None, curated=None):
        rows = [r for r in self.findings.values() if r["case_id"] == case_id
                and (status is None or r["status"] == status)
                and (curated is None or r["curated"] == curated)]
        return copy.deepcopy(rows)

    def set_curated(self, finding_id, curated):
        if finding_id not in self.findings:
            return None
        self.findings[finding_id]["curated"] = curated
        return self._cp(self.findings[finding_id])

    def get_finding(self, finding_id):
        return self._cp(self.findings.get(finding_id))

    # ---- correlations
    def _new_corr(self, corr: Row, case_id: str) -> Row:
        row = {
            "id": self._id(), "case_id": case_id, "status": "pending", "review_note": None,
            "reviewed_at": None, "matched_value": None, "created_at": now_iso(), **corr,
        }
        row["reviewed"] = row["status"] == "approved"
        self.correlations[row["id"]] = row
        return row

    def sync_correlations(self, case_id, corrs):
        existing = {r["corr_key"]: r for r in self.correlations.values() if r["case_id"] == case_id}
        wanted = {c["corr_key"]: c for c in corrs}
        for k, c in wanted.items():
            fields = {f: c.get(f) for f in _CORR_ENGINE_FIELDS}
            if k in existing:
                existing[k].update(fields)
            else:
                self._new_corr({**fields, **_initial_status(c), "corr_key": k}, case_id)
        for k, r in existing.items():
            if _stale(k, r, wanted):
                del self.correlations[r["id"]]
        return self.list_correlations(case_id)

    def insert_correlation(self, corr, case_id):
        return copy.deepcopy(self._new_corr(dict(corr), case_id))

    def list_correlations(self, case_id, *, status=None):
        rows = [r for r in self.correlations.values() if r["case_id"] == case_id
                and (status is None or r["status"] == status)]
        return copy.deepcopy(sorted(rows, key=lambda r: r.get("priority") or 0, reverse=True))

    def set_correlation_status(self, correlation_id, status, note=None):
        r = self.correlations.get(correlation_id)
        if not r:
            return None
        r.update(status=status, reviewed=status == "approved",
                 reviewed_at=None if status == "pending" else now_iso())
        if note is not None:
            r["review_note"] = note
        return copy.deepcopy(r)

    def get_correlation(self, correlation_id):
        return self._cp(self.correlations.get(correlation_id))

    # ---- entities
    def upsert_entities(self, case_id, entities):
        for e in entities:
            key = (case_id, e["kind"], e["value"])
            if key not in self.entities:
                self.entities[key] = {
                    "id": self._id(), "case_id": case_id, "platform": None, "source_finding_id": None,
                    "is_seed": False, "scanned": False, "first_seen": now_iso(), **e,
                }

    def list_entities(self, case_id):
        return copy.deepcopy([e for k, e in self.entities.items() if k[0] == case_id])

    def mark_entity_scanned(self, case_id, kind, value):
        if (case_id, kind, value) in self.entities:
            self.entities[(case_id, kind, value)]["scanned"] = True

    # ---- jobs
    def enqueue_jobs(self, jobs):
        out = []
        for j in jobs:
            row = {
                "id": self._id(), "batch_id": None, "params": {}, "status": "queued", "progress": 0,
                "progress_note": None, "attempts": 0, "max_attempts": 3, "locked_by": None,
                "heartbeat_at": None, "run_after": now_iso(), "result": None, "error": None,
                "created_at": now_iso(), "started_at": None, "finished_at": None, **j,
            }
            self.jobs[row["id"]] = row
            out.append(copy.deepcopy(row))
        return out

    def claim_job(self, queue, worker):
        now = datetime.now(UTC)
        for j in self.jobs.values():
            if (j["queue"] == queue and j["status"] == "running" and j["heartbeat_at"]
                    and datetime.fromisoformat(j["heartbeat_at"]) < now - timedelta(seconds=self.stale_seconds)):
                if j["attempts"] >= j["max_attempts"]:
                    j.update(status="failed", error="worker lost: no heartbeat", finished_at=now_iso(), locked_by=None)
                else:
                    j.update(status="queued", locked_by=None)
        ready = [j for j in self.jobs.values() if j["queue"] == queue and j["status"] == "queued"
                 and datetime.fromisoformat(j["run_after"]) <= now]
        if not ready:
            return None
        j = min(ready, key=lambda r: r["created_at"])
        j.update(status="running", locked_by=worker, attempts=j["attempts"] + 1,
                 started_at=j["started_at"] or now_iso(), heartbeat_at=now_iso(), error=None)
        return copy.deepcopy(j)

    def heartbeat(self, job_id, progress=None, note=None):
        j = self.jobs.get(job_id)
        if not j or j["status"] != "running":
            return
        j["heartbeat_at"] = now_iso()
        if progress is not None:
            j["progress"] = max(0, min(100, int(progress)))
        if note is not None:
            j["progress_note"] = note

    def complete_job(self, job_id, result):
        if job_id in self.jobs:
            self.jobs[job_id].update(status="succeeded", progress=100, result=result,
                                     finished_at=now_iso(), locked_by=None)

    def fail_job(self, job_id, error, *, retry=True, delay_s=15):
        j = self.jobs.get(job_id)
        if not j:
            return None
        if retry and j["attempts"] < j["max_attempts"]:
            run_after = datetime.now(UTC) + timedelta(seconds=delay_s * j["attempts"])
            j.update(status="queued", error=error[:2000], locked_by=None, run_after=run_after.isoformat())
        else:
            j.update(status="failed", error=error[:2000], finished_at=now_iso(), locked_by=None)
        return copy.deepcopy(j)

    def get_job(self, job_id):
        return self._cp(self.jobs.get(job_id))

    def cancel_job(self, job_id):
        j = self.jobs.get(job_id)
        if j and j["status"] in ("queued", "running"):
            j.update(status="cancelled", finished_at=now_iso(), locked_by=None)
        return self._cp(j)

    def list_jobs(self, case_id, *, active_only=False):
        rows = [j for j in self.jobs.values() if j["case_id"] == case_id
                and (not active_only or j["status"] in ("queued", "running"))]
        return copy.deepcopy(sorted(rows, key=lambda j: j["created_at"], reverse=True))

    def queued_queues(self):
        return {j["queue"] for j in self.jobs.values() if j["status"] == "queued"}

    # ---- misc
    def log(self, case_id, action, actor, detail=None):
        self.audit.append({"id": len(self.audit) + 1, "case_id": case_id, "action": action,
                           "actor": actor, "detail": detail or {}, "created_at": now_iso()})

    def list_audit(self, case_id=None, limit=200):
        rows = [a for a in self.audit if case_id is None or a["case_id"] == case_id]
        return copy.deepcopy(rows[::-1][:limit])

    def hit_rate_limit(self, key, window_s, limit):
        bucket = (key, int(datetime.now(UTC).timestamp() // window_s))
        self.rate[bucket] = self.rate.get(bucket, 0) + 1
        return self.rate[bucket] <= limit

    def rate_limit_count(self, key, window_s):
        return self.rate.get((key, int(datetime.now(UTC).timestamp() // window_s)), 0)

    # ---- operator panel
    def touch_session(self, user_id, *, is_anonymous, email=None, ip_hash=None, country=None, user_agent=None):
        now = now_iso()
        row = self.sessions.setdefault(user_id, {
            "user_id": user_id, "first_seen": now, "ip_hash": None, "country": None, "user_agent": None,
            "search_count": 0, "refused_count": 0, "blocked": False, "blocked_at": None, "blocked_reason": None,
        })
        row.update(is_anonymous=is_anonymous, email=email, last_seen=now)
        for k, v in (("ip_hash", ip_hash), ("country", country),
                     ("user_agent", user_agent[:USER_AGENT_MAX] if user_agent else None)):
            if v is not None:
                row[k] = v

    def get_session(self, user_id):
        return self._cp(self.sessions.get(user_id))

    def list_sessions(self, *, q=None, blocked=None, user_ids=None, active_since=None, limit=50, offset=0):
        q = safe_query(q)
        wanted = set(user_ids) if user_ids is not None else None

        def keep(r: Row) -> bool:
            if q and not (q.lower() in (r.get("email") or "").lower() or q in (r.get("ip_hash"), r["user_id"])):
                return False
            if blocked is not None and r["blocked"] != blocked:
                return False
            if wanted is not None and r["user_id"] not in wanted:
                return False
            return not (active_since and r["last_seen"] < active_since)

        rows = sorted((r for r in self.sessions.values() if keep(r)), key=lambda r: r["last_seen"], reverse=True)
        return copy.deepcopy(rows[offset:offset + limit])

    def set_session_blocked(self, user_id, blocked, reason=None):
        r = self.sessions.get(user_id)
        if r is None:
            return None
        r.update({"blocked": True, "blocked_at": now_iso(), "blocked_reason": reason} if blocked
                 else {"blocked": False, "blocked_at": None, "blocked_reason": None})
        return copy.deepcopy(r)

    def log_search(self, row):
        out = {"id": len(self.search_log) + 1 + self._purged, "created_at": now_iso(), **_search_row(row)}
        self.search_log.append(out)
        s = self.sessions.get(out["user_id"])
        if s is not None:
            s["search_count" if out["outcome"] == "accepted" else "refused_count"] += 1
        return copy.deepcopy(out)

    def list_searches(self, *, since=None, outcome=None, target_type=None, q=None, user_id=None,
                      before_id=None, limit=50):
        q = safe_query(q).lower()
        rows = [r for r in reversed(self.search_log)
                if (not since or r["created_at"] >= since) and (not outcome or r["outcome"] == outcome)
                and (not target_type or r["target_type"] == target_type)
                and (not q or q in r["target_value"].lower()) and (not user_id or r["user_id"] == user_id)
                and (before_id is None or r["id"] < before_id)]
        return copy.deepcopy(rows[:limit])

    def detach_case_searches(self, case_id):
        for r in self.search_log:
            if r["case_id"] == case_id:
                r["case_id"] = None

    def purge_search_log(self, days=90):
        cutoff = (datetime.now(UTC) - timedelta(days=max(days, 1))).isoformat()
        keep = [r for r in self.search_log if r["created_at"] >= cutoff]
        removed = len(self.search_log) - len(keep)
        self._purged += removed
        self.search_log = keep
        return removed

    def get_setting(self, key, default=None):
        row = self.settings.get(key)
        return default if row is None or row["value"] is None else copy.deepcopy(row["value"])

    def set_setting(self, key, value, updated_by=None):
        self.settings[key] = {"key": key, "value": copy.deepcopy(value), "updated_at": now_iso(),
                              "updated_by": updated_by}

    def case_overview(self, owner_id):
        out = []
        for c in self.list_cases(owner_id):
            out.append({**{k: c.get(k) for k in ("id", "title", "identifiers", "status", "created_at", "archived_at")},
                        "job_count": sum(1 for j in self.jobs.values() if j["case_id"] == c["id"]),
                        "found_count": sum(1 for f in self.findings.values()
                                           if f["case_id"] == c["id"] and f["status"] == "found")})
        return out

    def count_cases(self):
        return sum(1 for c in self.cases.values() if not c.get("is_demo"))

    def count_active_jobs(self):
        return sum(1 for j in self.jobs.values() if j["status"] in ("queued", "running"))


_store: Store | None = None


def get_store() -> Store:
    global _store
    if _store is None:
        _store = SupabaseStore()
    return _store


def set_store(store: Store | None) -> None:
    global _store
    _store = store
