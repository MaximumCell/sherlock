"""Case commands. Reads (lists of cases, findings, jobs, ...) are served by Supabase, not here."""
from __future__ import annotations

import logging
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from fastapi.responses import PlainTextResponse
from sherlock_core.jobs import normalize_target, recorrelate
from sherlock_core.models import Case, Correlation, Finding, Job, now_iso

from gateway.agent.llm import LLMClient, default_client
from gateway.agent.orchestrator import Agent
from gateway.auth import CurrentPrincipal
from gateway.schemas import (
    CandidateConfirmed,
    CandidatesOut,
    CaseCreate,
    CaseCreated,
    CasePatch,
    ChatOut,
    ChatRequest,
    CorrelateResult,
    CurateRequest,
    ExposureOut,
    ManualLinkRequest,
    ScanAccepted,
    ScanRequest,
    VariationsOut,
    WakeResult,
)
from gateway.service import (
    StoreDep,
    check_target_allowed,
    consume_llm_quota,
    consume_scan_quota,
    enqueue_planned,
    is_uuid,
    load_case,
    name_params,
    normalize_or_400,
    plan_or_400,
    start_scan,
)
from gateway.wake import Waker, get_waker

log = logging.getLogger("sherlock.gateway.cases")
router = APIRouter(prefix="/cases", tags=["cases"])

WakerDep = Annotated[Waker, Depends(get_waker)]


def get_llm_client() -> LLMClient:
    """The agent's LLM. Tests override this dependency with a mock."""
    try:
        return default_client()
    except Exception as e:
        raise HTTPException(503, "The assistant is not configured on this server.") from e


LLMDep = Annotated[LLMClient, Depends(get_llm_client)]


# ----------------------------------------------------------------------------- cases
@router.post("", response_model=CaseCreated, status_code=201)
def create_case(body: CaseCreate, principal: CurrentPrincipal, store: StoreDep,
                background: BackgroundTasks, waker: WakerDep):
    identifiers: list[dict] = []
    for ident in body.identifiers:
        check_target_allowed(principal, ident.type)
        value = normalize_or_400(ident.type, ident.value)
        if not any(i["type"] == ident.type and i["value"] == value for i in identifiers):
            identifiers.append({"type": ident.type, "value": value})

    if body.hints is not None and not any(i["type"] == "name" for i in identifiers):
        raise HTTPException(400, "hints are only accepted together with a name identifier")
    # Plan before anything is written, so an unusable request leaves nothing behind.
    batches = [plan_or_400("", i["type"], i["value"], params=name_params(i["type"], body.hints)
                           if i["type"] == "name" else None)
               for i in identifiers] if body.scan else []
    for i in identifiers if body.scan else []:
        consume_scan_quota(store, principal, i["type"])

    title = (body.title or "").strip() or identifiers[0]["value"]
    case = store.create_case(identifiers, owner_id=principal.user_id, title=title,
                             tags=[t.strip() for t in body.tags if t.strip()])
    store.upsert_entities(case["id"], [{"kind": i["type"], "value": i["value"], "is_seed": True} for i in identifiers])
    store.log(case["id"], "case_created", "user", {"user": principal.user_id, "identifiers": identifiers})

    jobs: list[dict] = []
    for planned in batches:
        for row in planned:
            row["case_id"] = case["id"]
        jobs.extend(enqueue_planned(store, principal, case["id"], planned, actor="user"))
    if jobs:
        background.add_task(waker, {j["queue"] for j in jobs})
    return {"case": case, "jobs": jobs}


@router.patch("/{case_id}", response_model=Case)
def update_case(case_id: str, body: CasePatch, principal: CurrentPrincipal, store: StoreDep):
    load_case(store, case_id, principal, write=True)
    fields = body.model_dump(exclude_unset=True, exclude={"archived"})
    fields = {k: v for k, v in fields.items() if v is not None}
    if body.archived is not None:
        fields["archived_at"] = now_iso() if body.archived else None
    if not fields:
        raise HTTPException(400, "nothing to update")
    row = store.update_case(case_id, fields)
    if row is None:
        raise HTTPException(404, "case not found")
    store.log(case_id, "case_updated", "user", {"fields": sorted(fields)})
    return row


@router.delete("/{case_id}", status_code=204, response_class=Response, response_model=None)
def delete_case(case_id: str, principal: CurrentPrincipal, store: StoreDep):
    load_case(store, case_id, principal, write=True)
    store.delete_case(case_id)
    store.log(None, "case_deleted", "user", {"case_id": case_id, "user": principal.user_id})
    return Response(status_code=204)


# ----------------------------------------------------------------------------- scans and jobs
@router.post("/{case_id}/scan", response_model=ScanAccepted, status_code=202)
def scan(case_id: str, body: ScanRequest, principal: CurrentPrincipal, store: StoreDep,
         background: BackgroundTasks, waker: WakerDep):
    load_case(store, case_id, principal, write=True)
    jobs = start_scan(store, principal, case_id, body.type, body.value, body.modules,
                      params=name_params(body.type, body.hints))
    background.add_task(waker, {j["queue"] for j in jobs})
    return {"batch_id": jobs[0]["batch_id"], "jobs": jobs}


@router.post("/{case_id}/wake", response_model=WakeResult, status_code=202)
def wake(case_id: str, principal: CurrentPrincipal, store: StoreDep,
         background: BackgroundTasks, waker: WakerDep):
    """Re-poke the workers of queues that still hold queued jobs for this case."""
    load_case(store, case_id, principal, write=True)
    queues = sorted({j["queue"] for j in store.list_jobs(case_id, active_only=True) if j["status"] == "queued"})
    if queues:
        if not store.hit_rate_limit(f"wake:case:{case_id}", 60, 12):
            raise HTTPException(429, "Too many wake requests; the workers have already been notified.")
        background.add_task(waker, queues)
    return {"queues": queues}


@router.post("/{case_id}/jobs/{job_id}/cancel", response_model=Job)
def cancel_job(case_id: str, job_id: str, principal: CurrentPrincipal, store: StoreDep):
    load_case(store, case_id, principal, write=True)
    job = store.get_job(job_id) if is_uuid(job_id) else None
    if job is None or job["case_id"] != case_id:
        raise HTTPException(404, "job not found")
    if job["status"] not in ("queued", "running"):
        return job  # already finished; cancelling is a no-op
    row = store.cancel_job(job_id)
    store.log(case_id, "job_cancelled", "user", {"job_id": job_id, "module": job["module"]})
    return row


@router.post("/{case_id}/correlate", response_model=CorrelateResult)
def correlate_case(case_id: str, principal: CurrentPrincipal, store: StoreDep):
    load_case(store, case_id, principal, write=True)
    count = recorrelate(case_id, store)
    store.log(case_id, "correlation", "user", {"count": count})
    return {"correlations": count}


# ----------------------------------------------------------------------------- findings and links
@router.post("/{case_id}/findings/{finding_id}/curate", response_model=Finding)
def curate_finding(case_id: str, finding_id: str, body: CurateRequest,
                   principal: CurrentPrincipal, store: StoreDep):
    load_case(store, case_id, principal, write=True)
    finding = store.get_finding(finding_id) if is_uuid(finding_id) else None
    if finding is None or finding["case_id"] != case_id:
        raise HTTPException(404, "finding not found")
    row = store.set_curated(finding_id, body.curated)
    store.log(case_id, "finding_curated" if body.curated else "finding_uncurated", "user", {"finding_id": finding_id})
    return row


@router.post("/{case_id}/correlations", response_model=Correlation, status_code=201)
def manual_link(case_id: str, body: ManualLinkRequest, principal: CurrentPrincipal, store: StoreDep):
    """An investigator links findings by hand. Stored as an approved correlation the engine never touches."""
    load_case(store, case_id, principal, write=True)
    ids = list(dict.fromkeys(body.finding_ids))
    if len(ids) < 2:
        raise HTTPException(400, "a manual link needs at least two different findings")
    for fid in ids:
        finding = store.get_finding(fid) if is_uuid(fid) else None
        if finding is None or finding["case_id"] != case_id:
            raise HTTPException(400, f"finding {fid} does not belong to this case")
    note = (body.note or "").strip() or None
    row = store.insert_correlation({
        "type": "manual_link",
        "corr_key": f"manual:{uuid.uuid4()}",
        "matched_value": None,
        "entities_involved": ids,
        "confidence": 1.0,
        "evidence": [note or "Linked manually by the investigator"],
        "priority": 1.0,
        "status": "approved",
        "review_note": note,
        "reviewed_at": now_iso(),
    }, case_id)
    store.log(case_id, "manual_link", "user", {"correlation_id": row["id"], "finding_ids": ids})
    return row


# ----------------------------------------------------------------------------- name-search candidates
def _name_search(store, case: dict, name: str | None) -> tuple[str, dict]:
    """The searched name (the case's name identifier unless one is given) and the hints it ran with."""
    jobs = [j for j in store.list_jobs(case["id"]) if j.get("target_type") == "name"]   # newest first
    known = [i["value"] for i in case.get("identifiers") or [] if i.get("type") == "name"]
    known += [j["target_value"] for j in jobs if j["target_value"] not in known]
    if name is not None:
        name = normalize_or_400("name", name)
        if name not in known:
            raise HTTPException(404, "this case has no name search for that name")
    elif known:
        name = known[0]
    else:
        raise HTTPException(404, "this case has no name search")
    hints = next((j.get("params") or {} for j in jobs if j["target_value"] == name and j.get("params")), {})
    return name, dict(hints)


def _candidates(store, case_id: str, name: str, hints: dict):
    from sherlock_core.resolve import resolve_candidates, unassigned_finding_ids

    findings = [f for f in store.list_findings(case_id, status="found")
                if f.get("identifier_type") == "name" and f.get("identifier_value") == name]
    cands = resolve_candidates(findings, name, hints)
    return cands, unassigned_finding_ids(findings, cands)


@router.get("/{case_id}/candidates", response_model=CandidatesOut)
def candidates(case_id: str, principal: CurrentPrincipal, store: StoreDep,
               name: Annotated[str | None, Query(min_length=2, max_length=100)] = None):
    """The distinct people among a name search's findings, ranked and explained (deterministic, no LLM).
    Read-only, so demo cases are allowed."""
    case = load_case(store, case_id, principal, write=False)
    name, hints = _name_search(store, case, name)
    cands, unassigned = _candidates(store, case_id, name, hints)
    return {"name": name, "hints": hints, "candidates": [c.to_dict() for c in cands],
            "unassigned_finding_ids": unassigned}


def _pivots(candidate) -> list[dict]:
    """A confirmed candidate's handles, emails, links and domains as unscanned entity rows."""
    a = candidate.attributes
    source = candidate.finding_ids[0] if candidate.finding_ids else None
    rows: list[dict] = []

    def add(kind: str, value: str, platform: str | None = None) -> None:
        try:
            v = normalize_target(kind, value) if kind != "url" else value.strip()
        except ValueError:
            return                       # e.g. a fediverse handle that is not a plain username
        if v and not any(r["kind"] == kind and r["value"] == v for r in rows):
            rows.append({"kind": kind, "value": v, "platform": platform, "source_finding_id": source,
                         "is_seed": False, "scanned": False})

    for h in a.get("handles") or []:
        add("username", h["handle"], h["platform"])
    for email in a.get("emails") or []:
        add("email", email)
    for link in a.get("links") or []:
        if link.lower().startswith(("http://", "https://")) and len(link) <= 2048:
            add("url", link)
    for domain in a.get("domains") or []:
        add("domain", domain)
    return rows


@router.post("/{case_id}/candidates/{candidate_id}/confirm", response_model=CandidateConfirmed)
def confirm_candidate(case_id: str, candidate_id: str, principal: CurrentPrincipal, store: StoreDep,
                      name: Annotated[str | None, Query(min_length=2, max_length=100)] = None):
    """The investigator says "this is the person". Records it and adds the candidate's accounts,
    emails, links and domains as pivot suggestions. Starts NO scan: pivoting stays a separate,
    rate-limited user action."""
    case = load_case(store, case_id, principal, write=True)
    check_target_allowed(principal, "name")
    name, hints = _name_search(store, case, name)
    cands, _ = _candidates(store, case_id, name, hints)
    candidate = next((c for c in cands if c.candidate_id == candidate_id), None)
    if candidate is None:
        raise HTTPException(404, "candidate not found (the findings may have changed; reload the candidates)")
    before = {(e["kind"], e["value"]) for e in store.list_entities(case_id)}
    pivots = [r for r in _pivots(candidate) if (r["kind"], r["value"]) not in before]
    store.upsert_entities(case_id, pivots)
    added = {(r["kind"], r["value"]) for r in pivots}
    entities = [e for e in store.list_entities(case_id) if (e["kind"], e["value"]) in added]
    store.log(case_id, "candidate_confirmed", "user", {
        "user": principal.user_id, "name": name, "candidate_id": candidate.candidate_id, "label": candidate.label,
        "score": candidate.score, "finding_ids": candidate.finding_ids,
        "entities": [{"kind": e["kind"], "value": e["value"]} for e in entities],
    })
    return {"candidate": candidate.to_dict(), "entities": entities}


# ----------------------------------------------------------------------------- report, variations, chat
@router.get("/{case_id}/report", response_class=PlainTextResponse, response_model=None,
            responses={200: {"content": {"text/markdown": {}}}})
def report(case_id: str, principal: CurrentPrincipal, store: StoreDep):
    load_case(store, case_id, principal, write=False)
    from sherlock_core.report import generate_markdown  # heavy and rewritten independently

    markdown = generate_markdown(case_id, store=store)
    store.log(case_id, "report_generated", "user", {})
    return PlainTextResponse(markdown, media_type="text/markdown; charset=utf-8")


@router.get("/{case_id}/exposure", response_model=ExposureOut)
def exposure(case_id: str, principal: CurrentPrincipal, store: StoreDep):
    """Deterministic exposure score of the case (no LLM). Read-only, so demo cases are allowed."""
    load_case(store, case_id, principal, write=False)
    from sherlock_core.scoring import score_exposure

    return score_exposure(store.list_findings(case_id), store.list_correlations(case_id))


@router.get("/{case_id}/variations", response_model=VariationsOut)
def variations(case_id: str, principal: CurrentPrincipal, store: StoreDep, llm: LLMDep,
               value: Annotated[str, Query(min_length=1, max_length=320)],
               type: Annotated[Literal["username", "email"], Query()] = "username",
               count: Annotated[int, Query(ge=1, le=20)] = 5,
               exclude: Annotated[str | None, Query(max_length=4000)] = None):
    """Close variations of a username or email, for the investigator to pick from. Scans nothing."""
    load_case(store, case_id, principal, write=False)
    value = normalize_or_400(type, value)
    consume_llm_quota(store, principal)
    from sherlock_core.variations import generate_email_variations, generate_variations

    seen = {v.strip() for v in (exclude or "").split(",") if v.strip()}
    generate = generate_email_variations if type == "email" else generate_variations
    out = generate(value, count=count, llm=llm, exclude=seen)
    store.log(case_id, "variations_generated", "user", {"type": type, "value": value, "count": len(out)})
    return {"variations": out}


@router.post("/{case_id}/chat", response_model=ChatOut)
def chat(case_id: str, body: ChatRequest, principal: CurrentPrincipal, store: StoreDep, llm: LLMDep,
         background: BackgroundTasks, waker: WakerDep):
    load_case(store, case_id, principal, write=True)
    consume_llm_quota(store, principal)
    agent = Agent(case_id, llm=llm, principal=principal, store=store)
    try:
        out = agent.chat(body.message)
    except Exception as e:
        log.exception("agent failed for case %s", case_id)
        raise HTTPException(502, "The assistant could not answer right now. Try again in a moment.") from e
    finally:
        if agent.queues_to_wake:
            background.add_task(waker, set(agent.queues_to_wake))
    store.log(case_id, "agent_chat", "user", {
        "iterations": out["iterations"], "tool_calls": [tc["name"] for tc in out["tool_calls_made"]],
    })
    return out
