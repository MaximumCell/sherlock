"""Supabase wrapper. Everything DB-facing goes through this module (swap = one file).
Client is created lazily so collectors/correlation stay usable without creds.
"""
import logging
from core import config

log = logging.getLogger(__name__)


def _client():
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set in .env")
    from supabase import create_client  # deferred import: dep not needed offline
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)


# No DDL migrations. Schema lives in core/schema.sql (run once in Supabase
# SQL editor when the project is bootstrapped). All per-row state we add
# (e.g. `curated`) is stored in extra_metadata JSONB so we don't need DDL
# permissions to evolve the app.
#
# If you ever need true schema migrations, the pattern is:
#   1) add a new .sql file in core/migrations/
#   2) document it in core/schema.sql
#   3) have the user paste it in Supabase once
# Avoid the RPC-based "auto migration" pattern: it requires an exec_sql
# function the project owner has to create by hand, so it tends to silently
# no-op and leave the user confused.


def run_migrations() -> list[str]:
    """No-op kept for backwards compatibility. Returns [] so callers that
    await a list don't break. Add real DDL migrations to core/schema.sql."""
    return []


def _is_curated(row: dict) -> bool:
    """Read the curated flag from extra_metadata. Used for filtering."""
    meta = row.get("extra_metadata") or {}
    if not isinstance(meta, dict):
        return False
    return bool(meta.get("curated"))


def create_case(identifiers: list[dict]) -> str:
    run_migrations()
    row = _client().table("cases").insert({"identifiers": identifiers}).execute().data[0]
    return row["id"]


def update_case_status(case_id: str, status: str):
    run_migrations()
    _client().table("cases").update({"status": status}).eq("id", case_id).execute()


def upsert_findings(findings: list[dict], case_id: str) -> list[dict]:
    """Upsert findings for a case. Returns the persisted rows (including
    server-assigned ids and timestamps) so callers don't have to re-query."""
    run_migrations()
    if not findings:
        return []
    rows = [{**f, "case_id": case_id} for f in findings]
    # Dedupe by the unique constraint. user_scanner can return multiple findings
    # for the same (case_id, source_tool, platform, identifier_value) tuple
    # (e.g. when a site is checked twice or returns both a "found" and a
    # "not_found" row). PostgreSQL's ON CONFLICT can't update the same row
    # twice in a single statement — collapse to the last entry per key.
    seen: dict[tuple, dict] = {}
    for r in rows:
        key = (r.get("case_id"), r.get("source_tool"), r.get("platform"), r.get("identifier_value"))
        seen[key] = r
    deduped = list(seen.values())
    # idempotent: unique (case_id, source_tool, platform, identifier_value)
    # Prefer return=representation so the server's row (with id, collected_at)
    # comes back. Avoids a read-after-write race when callers want the new id.
    res = _client().table("raw_findings").upsert(
        deduped,
        on_conflict="case_id,source_tool,platform,identifier_value",
    ).execute()
    return res.data or []


def insert_correlations(corrs: list[dict], case_id: str):
    if not corrs:
        return
    rows = [{**c, "case_id": case_id} for c in corrs]
    _client().table("correlations").insert(rows).execute()


POSTGREST_PAGE_SIZE = 1000


def _paginated_select(query_builder) -> list[dict]:
    """PostgREST caps responses at 1000 rows by default. Walk the full result
    set in pages so callers actually see every row. Uses Range headers, which
    the supabase-py client exposes via `.range(start, end)` on a builder."""
    all_rows: list[dict] = []
    start = 0
    while True:
        end = start + POSTGREST_PAGE_SIZE - 1
        page = query_builder.range(start, end).execute()
        rows = page.data or []
        all_rows.extend(rows)
        if len(rows) < POSTGREST_PAGE_SIZE:
            break
        start += POSTGREST_PAGE_SIZE
    return all_rows


def list_findings(case_id: str, curated: bool | None = None) -> list[dict]:
    """List findings for a case. Optional `curated` filter reads from
    extra_metadata.curated (no schema column needed). Paginates through
    PostgREST's 1000-row default cap."""
    c = _client()
    base = c.table("raw_findings").select("*").eq("case_id", case_id)
    if curated is True:
        # PostgREST `cs` = @> JSONB contains. extra_metadata must include {"curated": true}.
        rows = _paginated_select(base.contains("extra_metadata", {"curated": True}))
        return rows
    if curated is False:
        # "not curated" — fetch all, drop curated rows in Python. Case sizes
        # are bounded (~1k rows) so the post-filter is cheap.
        rows = _paginated_select(base)
        return [r for r in rows if not _is_curated(r)]
    return _paginated_select(base)


def set_curated(finding_id: str, curated: bool) -> dict:
    """Toggle the curated flag on a finding. Stored in extra_metadata.curated
    so we don't need a schema column. Read-modify-write to avoid clobbering
    other keys in extra_metadata."""
    c = _client()
    rows = c.table("raw_findings").select("extra_metadata").eq("id", finding_id).execute().data
    if not rows:
        return {}
    current = rows[0].get("extra_metadata") or {}
    if not isinstance(current, dict):
        current = {}
    current["curated"] = bool(curated)
    updated = c.table("raw_findings").update({"extra_metadata": current}).eq("id", finding_id).execute().data
    return updated[0] if updated else {}


def list_curated_findings(case_id: str) -> list[dict]:
    """Shorthand: findings the investigator has marked for follow-up."""
    return list_findings(case_id, curated=True)


def list_correlations(case_id: str, reviewed: bool | None = None) -> list[dict]:
    q = _client().table("correlations").select("*").eq("case_id", case_id)
    if reviewed is not None:
        q = q.eq("reviewed", reviewed)
    return _paginated_select(q)


def set_reviewed(correlation_id: str, reviewed: bool, note: str | None = None):
    upd = {"reviewed": reviewed}
    if note is not None:
        upd["review_note"] = note
    _client().table("correlations").update(upd).eq("id", correlation_id).execute()


def log(case_id: str | None, action: str, actor: str, detail: dict | None = None):
    _client().table("audit_log").insert({
        "case_id": case_id, "action": action, "actor": actor, "detail": detail or {},
    }).execute()
