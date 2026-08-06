"""Supabase wrapper. Everything DB-facing goes through this module (swap = one file).
Client is created lazily so collectors/correlation stay usable without creds.
"""
from core import config


def _client():
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY not set in .env")
    from supabase import create_client  # deferred import: dep not needed offline
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)


def create_case(identifiers: list[dict]) -> str:
    row = _client().table("cases").insert({"identifiers": identifiers}).execute().data[0]
    return row["id"]


def update_case_status(case_id: str, status: str):
    _client().table("cases").update({"status": status}).eq("id", case_id).execute()


def upsert_findings(findings: list[dict], case_id: str):
    if not findings:
        return
    rows = [{**f, "case_id": case_id} for f in findings]
    # idempotent: unique (case_id, source_tool, platform, identifier_value)
    _client().table("raw_findings").upsert(
        rows, on_conflict="case_id,source_tool,platform,identifier_value"
    ).execute()


def insert_correlations(corrs: list[dict], case_id: str):
    if not corrs:
        return
    rows = [{**c, "case_id": case_id} for c in corrs]
    _client().table("correlations").insert(rows).execute()


def list_findings(case_id: str) -> list[dict]:
    return _client().table("raw_findings").select("*").eq("case_id", case_id).execute().data


def list_correlations(case_id: str, reviewed: bool | None = None) -> list[dict]:
    q = _client().table("correlations").select("*").eq("case_id", case_id)
    if reviewed is not None:
        q = q.eq("reviewed", reviewed)
    return q.execute().data


def set_reviewed(correlation_id: str, reviewed: bool, note: str | None = None):
    upd = {"reviewed": reviewed}
    if note is not None:
        upd["review_note"] = note
    _client().table("correlations").update(upd).eq("id", correlation_id).execute()


def log(case_id: str | None, action: str, actor: str, detail: dict | None = None):
    _client().table("audit_log").insert({
        "case_id": case_id, "action": action, "actor": actor, "detail": detail or {},
    }).execute()
