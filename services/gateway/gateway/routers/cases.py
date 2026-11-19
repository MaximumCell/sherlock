"""Cases router: CRUD + run + findings + report + chat."""
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import PlainTextResponse

from sherlock_core import db, pipeline, correlate
from sherlock_core.report import generate_markdown
from sherlock_core.variations import generate_variations, generate_email_variations
from sherlock_core.collectors import user_scanner_wrapper
from sherlock_core.collectors.scrape_wrapper import enrich_url, is_configured as scrape_configured
from gateway.agent.orchestrator import Agent
from gateway import jobs
from gateway.schemas import CaseCreate, CaseOut, ChatIn, ChatOut, FindingOut

log = logging.getLogger(__name__)

router = APIRouter(prefix="/cases", tags=["cases"])


def _to_case_out(row: dict) -> dict:
    return {
        "id": row["id"],
        "identifiers": row["identifiers"],
        "status": row["status"],
        "created_at": row["created_at"],
    }


def _get_case(case_id: str) -> dict:
    rows = db._client().table("cases").select("*").eq("id", case_id).execute().data
    if not rows:
        raise HTTPException(404, "case not found")
    return rows[0]


@router.post("", status_code=201)
def create_case(body: CaseCreate):
    payload = [i.model_dump() for i in body.identifiers]
    case_id = db.create_case(payload)
    return _to_case_out(_get_case(case_id))


@router.get("")
def list_cases():
    rows = db._client().table("cases").select("*").order("created_at", desc=True).execute().data
    return [_to_case_out(r) for r in rows]


@router.get("/{case_id}")
def get_case(case_id: str):
    return _to_case_out(_get_case(case_id))


@router.delete("/{case_id}", status_code=204)
def delete_case(case_id: str):
    _get_case(case_id)  # 404 if missing
    db.log(case_id, "case_deleted", "api", {})  # log BEFORE delete (FK to cases)
    db._client().table("cases").delete().eq("id", case_id).execute()
    return None


@router.post("/{case_id}/run")
def run_case(case_id: str):
    """Run all collectors + correlation for the case. Synchronous for v1."""
    case = _get_case(case_id)
    pipeline.run_case(case["identifiers"], case_id=case_id)
    return _to_case_out(_get_case(case_id))


@router.post("/{case_id}/scan-username", status_code=202)
def scan_username(case_id: str, background: BackgroundTasks, username: str):
    """Start an async scan of a username and merge findings into this case.

    Returns 202 immediately with a job_id. The scan runs in the background
    (1-3 minutes for a full sweep). Poll GET /cases/{id}/jobs/{job_id}
    for status. Survives the browser closing — the user can come back later.
    """
    _get_case(case_id)  # 404 if missing
    username = username.strip()
    if not username:
        raise HTTPException(400, "username is required")
    job = jobs.create(case_id, "scan_username", username)
    background.add_task(_run_username_scan, job.id, case_id, username)
    log.info(f"queued scan_username job={job.id} case={case_id} username={username}")
    return {"job_id": job.id, "status": "running", "scanned": username, "type": "username"}


@router.get("/{case_id}/jobs/{job_id}")
def get_job(case_id: str, job_id: str):
    job = jobs.get(job_id)
    if not job or job.case_id != case_id:
        raise HTTPException(404, f"job {job_id} not found for case {case_id}")
    return job.to_dict()


@router.get("/{case_id}/jobs")
def list_jobs(case_id: str):
    _get_case(case_id)
    jobs.prune_finished()
    return list_for_case_sorted(case_id)


def list_for_case_sorted(case_id: str) -> list[dict]:
    """List jobs for a case, sorted newest-first."""
    rows = jobs.list_for_case(case_id)
    return sorted(rows, key=lambda r: r["started_at"], reverse=True)


@router.post("/{case_id}/findings/{finding_id}/curate")
def curate_finding(case_id: str, finding_id: str, body: dict):
    """Toggle the curated flag on a finding. Investigators mark findings they
    want to follow up on (enrich, pivot, write into a report)."""
    _get_case(case_id)
    if "curated" not in body:
        raise HTTPException(400, "body must include 'curated' boolean")
    curated = bool(body["curated"])
    row = db.set_curated(finding_id, curated)
    db.log(case_id, "finding_curated" if curated else "finding_uncurated", "user", {"finding_id": finding_id})
    return {
        "id": finding_id,
        "curated": curated,
        "platform": row.get("platform"),
        "identifier_value": row.get("identifier_value"),
    }


@router.post("/{case_id}/enrich-curated", status_code=202)
def enrich_curated(case_id: str, background: BackgroundTasks):
    """Enrich every curated finding in one go. Runs in the background.
    Returns a job_id; poll GET /cases/{id}/jobs/{job_id} for progress.

    The investigator's typical flow:
      1. scan a username -> 200+ raw hits
      2. open the case and star the interesting ones (Curated)
      3. click "Enrich curated" -> each gets a Firecrawl scrape with emails/locations/handles
      4. pivot on the new emails/handles (find related accounts)
    """
    if not scrape_configured():
        raise HTTPException(
            503,
            "Scraping service not configured. Sign up at https://firecrawl.dev "
            "and set SCRAPING_API_KEY in your .env file.",
        )
    _get_case(case_id)
    targets = db.list_curated_findings(case_id)
    if not targets:
        raise HTTPException(400, "no curated findings to enrich — star some first")
    job = jobs.create(case_id, "enrich_curated", f"{len(targets)} findings")
    background.add_task(_run_enrich_curated, job.id, case_id, [f["id"] for f in targets])
    log.info(f"queued enrich_curated job={job.id} case={case_id} count={len(targets)}")
    return {"job_id": job.id, "status": "running", "scanned": f"{len(targets)} curated findings", "type": "enrich_curated"}


def _run_enrich_curated(job_id: str, case_id: str, finding_ids: list[str]):
    """Enrich each curated finding in sequence. Re-correlate once at the end."""
    try:
        findings = db.list_findings(case_id)
        id_to_finding = {f["id"]: f for f in findings}
        ok = 0
        failed = 0
        for fid in finding_ids:
            target = id_to_finding.get(fid)
            if not target:
                failed += 1
                continue
            meta = target.get("extra_metadata") or {}
            extra = meta.get("extra") or {}
            url = (
                meta.get("url")
                or extra.get("website")
                or (target.get("identifier_value") if str(target.get("identifier_value", "")).startswith("http") else None)
            )
            if not url:
                failed += 1
                continue
            c = db._client()
            prior = c.table("raw_findings").select("id").eq("case_id", case_id).eq("source_tool", "firecrawl").eq("identifier_value", url).execute().data
            for p in prior:
                c.table("raw_findings").delete().eq("id", p["id"]).execute()
            try:
                finding = enrich_url(url, case_id)
                db.upsert_findings([finding], case_id)
                ok += 1
            except Exception:
                log.exception("enrich_url failed for %s", url)
                failed += 1
        db.log(case_id, "enrich_curated", "user", {"total": len(finding_ids), "ok": ok, "failed": failed})
        all_findings = db.list_findings(case_id)
        c = db._client()
        c.table("correlations").delete().eq("case_id", case_id).execute()
        corrs = correlate.correlate(case_id, all_findings)
        db.insert_correlations(corrs, case_id)
        jobs.complete(job_id, {
            "scanned": f"{len(finding_ids)} curated findings",
            "type": "enrich_curated",
            "findings_added": ok,
            "correlations_total": len(corrs),
        })
    except Exception as e:
        log.exception(f"enrich_curated job {job_id} failed")
        jobs.fail(job_id, str(e))


def _run_username_scan(job_id: str, case_id: str, username: str):
    try:
        findings = user_scanner_wrapper.scan(username, is_email=False, case_id=case_id)
        db.upsert_findings(findings, case_id)
        db.log(case_id, "manual_scan_username", "user", {"username": username, "findings": len(findings)})
        all_findings = db.list_findings(case_id)
        db._client().table("correlations").delete().eq("case_id", case_id).execute()
        corrs = correlate.correlate(case_id, all_findings)
        db.insert_correlations(corrs, case_id)
        db.log(case_id, "correlation", "engine", {"count": len(corrs), "after": "manual_scan"})
        jobs.complete(job_id, {
            "scanned": username,
            "type": "username",
            "findings_added": len(findings),
            "correlations_total": len(corrs),
        })
    except Exception as e:
        log.exception(f"scan_username job {job_id} failed")
        jobs.fail(job_id, str(e))


@router.post("/{case_id}/scan-email", status_code=202)
def scan_email(case_id: str, background: BackgroundTasks, email: str):
    """Start an async scan of an email and merge findings into this case.

    Returns 202 immediately with a job_id. Poll GET /cases/{id}/jobs/{job_id}.
    """
    _get_case(case_id)  # 404 if missing
    email = email.strip()
    if not email or "@" not in email:
        raise HTTPException(400, "valid email is required")
    job = jobs.create(case_id, "scan_email", email)
    background.add_task(_run_email_scan, job.id, case_id, email)
    log.info(f"queued scan_email job={job.id} case={case_id} email={email}")
    return {"job_id": job.id, "status": "running", "scanned": email, "type": "email"}


def _run_email_scan(job_id: str, case_id: str, email: str):
    try:
        findings = user_scanner_wrapper.scan(email, is_email=True, case_id=case_id)
        db.upsert_findings(findings, case_id)
        db.log(case_id, "manual_scan_email", "user", {"email": email, "findings": len(findings)})
        all_findings = db.list_findings(case_id)
        db._client().table("correlations").delete().eq("case_id", case_id).execute()
        corrs = correlate.correlate(case_id, all_findings)
        db.insert_correlations(corrs, case_id)
        db.log(case_id, "correlation", "engine", {"count": len(corrs), "after": "manual_scan"})
        jobs.complete(job_id, {
            "scanned": email,
            "type": "email",
            "findings_added": len(findings),
            "correlations_total": len(corrs),
        })
    except Exception as e:
        log.exception(f"scan_email job {job_id} failed")
        jobs.fail(job_id, str(e))


@router.get("/{case_id}/variations")
def get_case_variations(
    case_id: str,
    count: int = 5,
    exclude: str = "",
):
    """Generate close username variations for the case WITHOUT running a scan.

    Returns up to `count` closely related usernames the investigator might
    want to pivot on — like the "Related accounts" row under an Instagram
    profile. Each variation is a clickable chip in the UI that opens a new
    case (or runs a scan on the current case, depending on user action).

    `exclude` (optional, comma-separated) — variations the caller has already
    seen. We won't return any of them, so a "Get 5 more" button can rerun
    this endpoint with the previously-returned values in `exclude` and get
    fresh ones back instead of the same 5. Repeated calls keep widening
    until the transformation space is exhausted.
    """
    _get_case(case_id)
    case = db._client().table("cases").select("*").eq("id", case_id).execute().data[0]
    exclude_set: set[str] = {x for x in (exclude or "").split(",") if x.strip()}
    out: dict[str, list[str]] = {}
    for ident in case["identifiers"]:
        if ident["type"] == "username":
            from sherlock_core.variations import generate_variations
            out["username"] = generate_variations(ident["value"], count=count, exclude=exclude_set)
        elif ident["type"] == "email":
            from sherlock_core.variations import generate_email_variations
            out["email"] = generate_email_variations(ident["value"], count=count, exclude=exclude_set)
    return {
        "case_id": case_id,
        "identifiers": case["identifiers"],
        "variations": out,
    }


@router.post("/{case_id}/run-with-variations")
def run_case_with_variations(case_id: str, count: int = 5):
    """Generate LLM-driven username variations, scan each, re-correlate.

    Slow: 5 variations * 280 platforms ~= several minutes.
    """
    case = _get_case(case_id)
    identifiers = case["identifiers"]

    # 1. generate variations for each username/email identifier
    variations_by_value: dict[str, list[str]] = {}
    for ident in identifiers:
        if ident["type"] == "username":
            vs = generate_variations(ident["value"], count=count)
        elif ident["type"] == "email":
            vs = generate_email_variations(ident["value"], count=count)
        else:
            continue
        variations_by_value[ident["value"]] = vs
        db.log(case_id, "variations_generated", "agent", {"identifier": ident["value"], "type": ident["type"], "variations": vs})

    # 2. scan each variation
    total_scanned = 0
    for ident in identifiers:
        if ident["type"] not in ("username", "email"):
            continue
        is_email = ident["type"] == "email"
        for v in variations_by_value.get(ident["value"], []):
            try:
                findings = user_scanner_wrapper.scan(v, is_email=is_email, case_id=case_id)
                db.upsert_findings(findings, case_id)
                db.log(case_id, "variation_scan", "user-scanner", {"variation": v, "findings": len(findings)})
                total_scanned += 1
            except Exception as e:
                db.log(case_id, "variation_scan", "user-scanner", {"variation": v, "error": str(e)})

    # 3. re-correlate
    findings = db.list_findings(case_id)
    corrs = correlate.correlate(case_id, findings)
    db.insert_correlations(corrs, case_id)
    db.log(case_id, "correlation", "engine", {"count": len(corrs), "after": "variations"})

    return {
        "case": _to_case_out(_get_case(case_id)),
        "variations": variations_by_value,
        "variations_scanned": total_scanned,
    }


@router.get("/{case_id}/findings")
def list_findings(case_id: str, curated: bool | None = None):
    _get_case(case_id)
    rows = db.list_findings(case_id, curated=curated)
    # surface the curated flag as a top-level field (it's stored in extra_metadata
    # so we don't need a schema column). Keep extra_metadata intact for callers.
    for r in rows:
        meta = r.get("extra_metadata") or {}
        r["curated"] = bool(meta.get("curated")) if isinstance(meta, dict) else False
    return rows


@router.post("/{case_id}/enrich")
def enrich_finding(case_id: str, finding_id: str):
    """Scrape the public profile URL of a finding and attach the result.

    Uses Firecrawl-compatible API (SCRAPING_API_KEY / SCRAPING_API_URL).
    Stores the result as a new finding with platform='scraped:<host>'.
    Re-running on the same URL overwrites the previous scrape result.
    """
    if not scrape_configured():
        raise HTTPException(
            503,
            "Scraping service not configured. Sign up at https://firecrawl.dev "
            "and set SCRAPING_API_KEY in your .env file.",
        )
    _get_case(case_id)
    # find the target finding to get its profile URL
    findings = db.list_findings(case_id)
    target = next((f for f in findings if f.get("id") == finding_id), None)
    if not target:
        raise HTTPException(404, f"finding {finding_id} not found in case {case_id}")
    # prefer meta.url, fallback to extra.website, then identifier_value if it looks like a URL
    meta = target.get("extra_metadata") or {}
    extra = meta.get("extra") or {}
    url = (
        meta.get("url")
        or extra.get("website")
        or (target.get("identifier_value") if str(target.get("identifier_value", "")).startswith("http") else None)
    )
    if not url:
        raise HTTPException(400, f"finding {finding_id} has no profile URL to scrape")
    # delete any prior scrape of the same URL in this case so re-running overwrites
    c = db._client()
    prior = c.table("raw_findings").select("id").eq("case_id", case_id).eq("source_tool", "firecrawl").eq("identifier_value", url).execute().data
    for p in prior:
        c.table("raw_findings").delete().eq("id", p["id"]).execute()
    try:
        finding = enrich_url(url, case_id)
    except Exception as e:
        raise HTTPException(502, f"scrape failed: {e}")
    persisted = db.upsert_findings([finding], case_id)
    db.log(case_id, "enrich_url", "user", {"finding_id": finding_id, "url": url, "platform": finding["platform"]})
    # re-correlate (the scrape may have produced new emails/handles)
    all_findings = db.list_findings(case_id)
    c.table("correlations").delete().eq("case_id", case_id).execute()
    corrs = correlate.correlate(case_id, all_findings)
    db.insert_correlations(corrs, case_id)
    # Use the row that came back from the upsert (avoids a read-after-write race
    # against PostgREST). Fall back to a re-query only if the upsert returned
    # nothing for some reason.
    new_finding_id = persisted[0]["id"] if persisted else None
    if not new_finding_id:
        new_finding_id = next(
            (f["id"] for f in db.list_findings(case_id)
             if f.get("identifier_value") == url and f.get("source_tool") == "firecrawl"),
            None,
        )
    return {
        "scraped_url": url,
        "platform": finding["platform"],
        "finding_id": new_finding_id,
        "correlations_total": len(corrs),
    }


@router.post("/{case_id}/report", response_class=PlainTextResponse)
def generate_report(case_id: str):
    _get_case(case_id)
    md = generate_markdown(case_id)
    db.log(case_id, "report", "api", {"length": len(md)})
    return md


@router.get("/{case_id}/report", response_class=PlainTextResponse)
def get_report(case_id: str):
    """Regenerate the report on demand (deterministic from current data)."""
    _get_case(case_id)
    return generate_markdown(case_id)


@router.post("/{case_id}/chat", response_model=ChatOut)
def chat_with_agent(case_id: str, body: ChatIn):
    """Send a message to the LLM agent for this case. Synchronous v1."""
    _get_case(case_id)
    agent = Agent(case_id)
    out = agent.chat(body.message)
    db.log(case_id, "agent_chat", "api", {
        "iterations": out["iterations"],
        "tool_calls": [tc["name"] for tc in out["tool_calls_made"]],
    })
    return out
