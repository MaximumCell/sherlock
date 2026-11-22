"""Job planning and execution, shared by the gateway (plans) and the workers (run).

    plan_scan   one user action -> one batch of job rows (one per applicable module)
    run_job     run one claimed job: module -> findings -> correlation -> complete / fail
    drain       claim-run loop for one queue: a small pool of WORKER_CONCURRENCY jobs, at most one heavy
    sign_wake   HMAC used by the gateway's wake call and verified by the worker

See docs/CONTRACTS.md ("Jobs").
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import ipaddress
import logging
import re
import uuid
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

import httpx

from sherlock_core import config, modules, uploads
from sherlock_core import correlation as _correlation
from sherlock_core.models import TARGET_TYPES
from sherlock_core.modules.base import ModuleContext, Target, new_http_client
from sherlock_core.store import Store

log = logging.getLogger("sherlock.jobs")
Row = dict[str, Any]

# The contract allows 30 s between heartbeats; tick well inside that (and inside the 20 s budget).
HEARTBEAT_INTERVAL_S: float = 15.0
# Base delay before a failed job is retried (the store multiplies it by the attempt number).
RETRY_DELAY_S: int = 15
WAKE_MAX_AGE_S = 300

# ----------------------------------------------------------------------------- validation
_USERNAME = re.compile(r"^[A-Za-z0-9._-]{2,64}$")
_EMAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")
_DOMAIN = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$")
_PHONE = re.compile(r"^\+[1-9]\d{6,14}$")
_WALLET = re.compile(
    r"^(?:0x[a-fA-F0-9]{40}"                       # EVM
    r"|[13][a-km-zA-HJ-NP-Z1-9]{25,34}"            # Bitcoin legacy
    r"|bc1[ac-hj-np-z02-9]{11,71}"                 # Bitcoin bech32
    r"|[1-9A-HJ-NP-Za-km-z]{32,44})$"              # base58 (Solana and similar)
)


def _public_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None


def normalize_target(target_type: str, value: str) -> str:
    """Validate and normalise one target value. Raises ValueError with a message fit for the user."""
    if target_type not in TARGET_TYPES:
        raise ValueError(f"unknown target type '{target_type}' (expected one of: {', '.join(TARGET_TYPES)})")
    v = (value or "").strip()
    if not v:
        raise ValueError(f"{target_type} value is empty")
    if len(v) > 2048:
        raise ValueError(f"{target_type} value is too long")

    if target_type == "username":
        v = v.lstrip("@")
        if not _USERNAME.match(v):
            raise ValueError("username must be 2-64 characters: letters, digits, dot, underscore or hyphen")
        return v

    if target_type == "email":
        local, _, domain = v.rpartition("@")
        v = f"{local}@{domain.lower()}"
        if len(v) > 254 or not _EMAIL.match(v):
            raise ValueError("email address is not valid")
        return v

    if target_type == "domain":
        v = v.lower()
        if "://" in v:
            v = urlsplit(v).hostname or ""
        v = v.split("/", 1)[0].rstrip(".")
        if not _DOMAIN.match(v):
            raise ValueError("domain is not valid (expected something like example.com)")
        return v

    if target_type == "ip":
        ip = _public_ip(v)
        if ip is None:
            raise ValueError("IP address is not valid")
        if not ip.is_global:
            raise ValueError("only public IP addresses can be scanned")
        return str(ip)

    if target_type == "phone":
        digits = re.sub(r"[\s().-]", "", v)
        if digits.startswith("00"):
            digits = "+" + digits[2:]
        if not digits.startswith("+"):
            digits = "+" + digits
        if not _PHONE.match(digits):
            raise ValueError("phone number must be in international format, e.g. +14155550123")
        return digits

    if target_type == "wallet":
        if not _WALLET.match(v):
            raise ValueError("wallet address format is not recognised")
        return v

    if target_type == "image":
        if uploads.is_upload(v):     # a photo the user uploaded; the gateway checks it is theirs
            return uploads.parse_upload(v).value
        parts = urlsplit(v)
        host = (parts.hostname or "").lower()
        if parts.scheme not in ("http", "https") or not host:
            raise ValueError("image must be an http(s) URL or an uploaded photo")
        ip = _public_ip(host)
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")) or (ip and not ip.is_global):
            raise ValueError("image URL must point to a public host")
        return v

    # name
    v = re.sub(r"\s+", " ", v)
    if not 2 <= len(v) <= 100 or not any(ch.isalpha() for ch in v):
        raise ValueError("name must be 2-100 characters and contain letters")
    return v


# ----------------------------------------------------------------------------- planning
def plan_scan(case_id: str, target_type: str, value: str, modules: list[str] | None = None,
              params: dict[str, Any] | None = None) -> list[Row]:
    """Job rows for one scan batch: one per applicable, available module.

    `modules` optionally restricts the batch to those registry names.
    `params` is copied onto every job and reaches the module as `Target.params`
    (name searches pass their disambiguation hints this way).
    Raises ValueError on invalid input or when no module applies.
    """
    from sherlock_core import modules as registry  # the parameter shadows the module name

    value = normalize_target(target_type, value)
    applicable = registry.modules_for(target_type)
    if modules is not None:
        wanted = list(dict.fromkeys(modules))
        by_name = {m.name: m for m in applicable}
        unknown = [n for n in wanted if n not in by_name]
        if unknown:
            raise ValueError(f"module(s) not available for {target_type}: {', '.join(unknown)}")
        applicable = [by_name[n] for n in wanted]
    if not applicable:
        raise ValueError(f"no module is available for target type '{target_type}'")
    batch_id = str(uuid.uuid4())
    return [
        {
            "case_id": case_id, "batch_id": batch_id, "queue": m.queue, "module": m.name,
            "target_type": target_type, "target_value": value, "params": dict(params or {}),
        }
        for m in applicable
    ]


# ----------------------------------------------------------------------------- correlation
def split_account_keys(correlations: list[Row]) -> set[str]:
    """Account keys of `same_account` rows the user rejected ("split these")."""
    return {str(c.get("matched_value")) for c in correlations
            if c.get("type") == "same_account" and c.get("status") == "rejected" and c.get("matched_value")}


def recorrelate(case_id: str, store: Store) -> int:
    """Re-run the correlation engine for a case and sync the result. Returns the stored row count.

    Accounts the user split (rejected `same_account` rows) are passed as `split_keys`,
    so their findings stay separate and links that depend on the split are recomputed.
    """
    findings = store.list_findings(case_id)
    found = [f for f in findings if f.get("status") == "found"]
    split = split_account_keys(store.list_correlations(case_id, status="rejected"))
    rows = store.sync_correlations(case_id, _correlation.correlate(case_id, found, split_keys=split))
    extract = getattr(_correlation, "extract_entities", None)  # lands with the engine
    if callable(extract):
        # all rows (not only found ones): every identifier already scanned is left out
        entities: list[Row] = list(extract(findings) or [])  # type: ignore[arg-type]
        if entities:
            store.upsert_entities(case_id, entities)
    return len(rows)


# ----------------------------------------------------------------------------- execution
def _persist(job: Row, findings: list[Row], store: Store) -> Row:
    """Blocking part of a successful run. Called in a thread."""
    case_id = job["case_id"]
    store.upsert_findings(findings, case_id, job_id=job["id"])
    store.mark_entity_scanned(case_id, job["target_type"], job["target_value"])
    try:
        recorrelate(case_id, store)
    except Exception as e:  # findings are saved; a correlation bug must not cost the scan
        log.exception("correlation failed for case %s", case_id)
        store.log(case_id, "correlation_error", f"worker:{job['module']}", {"job_id": job["id"], "error": str(e)[:500]})
    return {"findings": len(findings), "found": sum(1 for f in findings if f.get("status") == "found")}


_enrich_slots: dict[asyncio.AbstractEventLoop, asyncio.Semaphore] = {}


def enrich_semaphore() -> asyncio.Semaphore:
    """The one limiter shared by every job of this worker for preview and avatar downloads
    (ENRICH_CONCURRENCY in flight in total), so parallel jobs cannot multiply the memory they use."""
    loop = asyncio.get_running_loop()
    sem = _enrich_slots.get(loop)
    if sem is None:
        _enrich_slots.clear()          # an old loop (tests) is gone
        sem = _enrich_slots[loop] = asyncio.Semaphore(config.ENRICH_CONCURRENCY)
    return sem


async def _enrich(findings: list[Row], http: httpx.AsyncClient, queue: str = "") -> list[Row]:
    """Post-module enrichment, best effort: nothing here may cost the scan.

    1. identity queue: profile previews (picture / name / bio from the public profile page);
    2. perceptual hashes of profile pictures so `avatar_match` can compare them
       (needs Pillow/imagehash, i.e. the worker image).
    Downloads go through `enrich_semaphore()`, shared by all jobs running in this worker.
    """
    shared = enrich_semaphore()
    async def step(name: str, fn: Callable[[], Any], timeout: float) -> None:
        nonlocal findings
        try:
            updated = {f["finding_key"]: f for f in await asyncio.wait_for(fn(), timeout=timeout)}
        except Exception as e:
            log.info("%s skipped: %s", name, str(e) or type(e).__name__)
            return
        findings = [updated.get(f.get("finding_key"), f) for f in findings]

    if queue == "identity":
        from sherlock_core.modules.preview import enrich_previews
        await step("profile previews", lambda: enrich_previews(findings, http, shared=shared), 50)
    from sherlock_core.modules.avatar_hash import hash_avatars
    await step("avatar hashing", lambda: hash_avatars(findings, http, shared=shared), 60)
    return findings


async def _fail(job: Row, store: Store, error: str, *, retry: bool = True) -> None:
    def work() -> None:
        current = store.get_job(job["id"])
        if current and current["status"] == "cancelled":
            return
        row = store.fail_job(job["id"], error, retry=retry, delay_s=RETRY_DELAY_S)
        store.log(job["case_id"], "job_failed", f"worker:{job['module']}", {
            "job_id": job["id"], "target": job["target_value"], "error": error[:500],
            "attempt": job.get("attempts"), "will_retry": bool(row and row["status"] == "queued"),
        })
    try:
        await asyncio.to_thread(work)
    except Exception:
        log.exception("could not record failure of job %s", job["id"])


async def run_job(job: Row, store: Store, http: httpx.AsyncClient | None = None) -> None:
    """Run one claimed job to completion. Never raises for module or storage errors."""
    job_id, case_id = job["id"], job["case_id"]
    module = modules.get_module(job["module"])
    if module is None:
        await _fail(job, store, f"unknown module '{job['module']}'", retry=False)
        return

    async def progress(pct: int, note: str | None = None) -> None:
        try:
            await asyncio.to_thread(store.heartbeat, job_id, pct, note)
        except Exception:
            log.warning("progress update failed for job %s", job_id, exc_info=True)

    client = http or new_http_client()
    ctx = ModuleContext(
        case_id=case_id, http=client, job_id=job_id, progress=progress,
        log=logging.getLogger(f"sherlock.module.{module.name}"), max_concurrency=config.MAX_CONCURRENCY,
    )
    target = Target(type=job["target_type"], value=job["target_value"], params=job.get("params") or {})
    run_task = asyncio.ensure_future(asyncio.wait_for(module.run(target, ctx), timeout=module.timeout_s))
    user_cancelled = False

    async def beat() -> None:
        nonlocal user_cancelled
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL_S)
            try:
                await asyncio.to_thread(store.heartbeat, job_id)
                current = await asyncio.to_thread(store.get_job, job_id)
            except Exception:
                log.warning("heartbeat failed for job %s", job_id, exc_info=True)
                continue
            if current and current["status"] == "cancelled":
                user_cancelled = True
                run_task.cancel()
                return

    beat_task = asyncio.create_task(beat())
    try:
        try:
            findings = await run_task
        except asyncio.CancelledError:
            if user_cancelled:
                log.info("job %s cancelled by the user", job_id)
                return
            # The worker is shutting down. Hand the job back now instead of waiting for the
            # stale-heartbeat requeue (which still covers us if this fails).
            run_task.cancel()
            try:
                store.fail_job(job_id, "worker shut down", retry=True, delay_s=0)
            except Exception:
                log.warning("could not release job %s on shutdown", job_id, exc_info=True)
            raise
        except TimeoutError:
            await _fail(job, store, f"module '{module.name}' timed out after {module.timeout_s:g}s")
            return
        except Exception as e:
            log.warning("module %s failed for job %s: %r", module.name, job_id, e)
            await _fail(job, store, f"{type(e).__name__}: {e}" if str(e) else type(e).__name__)
            return

        try:
            current = await asyncio.to_thread(store.get_job, job_id)
            if current and current["status"] == "cancelled":
                return
            rows = await _enrich(list(findings or []), client, module.queue)
            result = await asyncio.to_thread(_persist, job, rows, store)
            await asyncio.to_thread(store.complete_job, job_id, result)
            await asyncio.to_thread(store.log, case_id, "job_succeeded", f"worker:{module.name}", {
                "job_id": job_id, "target": job["target_value"], **result,
            })
        except Exception as e:
            log.exception("could not store results of job %s", job_id)
            await _fail(job, store, f"storing results failed: {type(e).__name__}: {e}")
    finally:
        beat_task.cancel()
        if http is None:
            await client.aclose()


async def drain(
    queue: str,
    store: Store,
    worker_id: str,
    *,
    http: httpx.AsyncClient | None = None,
    should_stop: Callable[[], bool] | None = None,
    linger_s: float = 0.0,
    poll_s: float = 5.0,
    concurrency: int | None = None,
) -> int:
    """Claim and run jobs for `queue` until none is claimable and none is running. Returns jobs run.

    A small pool: up to `concurrency` (default WORKER_CONCURRENCY) jobs run at once, of which at
    most one is heavy (`Module.heavy`): while a heavy job runs, claims exclude heavy modules.
    Each job keeps its own heartbeat, cancellation and timeout (`run_job`). A failing job never
    stops the pool. `linger_s` > 0 keeps polling for that long while the queue still holds queued
    jobs that are not runnable yet (retries waiting for their backoff), so a retry does not depend
    on someone waking the worker again. Cancelling the drain cancels every running job, which
    hands each one back to the queue.
    """
    slots = max(1, concurrency or config.WORKER_CONCURRENCY)
    heavy = modules.heavy_module_names()
    running: dict[asyncio.Task[None], bool] = {}     # task -> is heavy
    ran = 0
    waited = 0.0

    def stopping() -> bool:
        return bool(should_stop and should_stop())

    try:
        while True:
            while not stopping() and len(running) < slots:
                exclude = sorted(heavy) if any(running.values()) else []
                try:
                    job = await asyncio.to_thread(store.claim_job, queue, worker_id, exclude)
                except Exception:
                    if not running:
                        raise
                    log.warning("claim failed; retrying after a running job finishes", exc_info=True)
                    break
                if job is None:
                    break
                task = asyncio.create_task(run_job(job, store, http), name=f"job-{job['id']}")
                running[task] = job["module"] in heavy
                ran += 1
                waited = 0.0
            if running:
                # Wake on the first finished job, or after poll_s to claim jobs queued meanwhile.
                done, _ = await asyncio.wait(running, timeout=poll_s, return_when=asyncio.FIRST_COMPLETED)
                for task in done:
                    running.pop(task)
                    if not task.cancelled() and task.exception() is not None:
                        log.error("job task crashed", exc_info=task.exception())
                continue
            if stopping():
                break
            if waited >= linger_s or queue not in await asyncio.to_thread(store.queued_queues):
                break
            await asyncio.sleep(poll_s)
            waited += poll_s
    except BaseException:
        # Shutdown (CancelledError) or a store error with nothing left to claim: every running job
        # is cancelled, and run_job hands each one back to the queue.
        for task in running:
            task.cancel()
        await asyncio.gather(*running, return_exceptions=True)
        raise
    return ran


# ----------------------------------------------------------------------------- wake signature
def sign_wake(body: bytes, secret: str) -> str:
    """Hex HMAC-SHA256 of the raw request body, sent as X-Sherlock-Signature."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def verify_wake(body: bytes, signature: str | None, secret: str) -> bool:
    if not secret or not signature:
        return False
    return hmac.compare_digest(sign_wake(body, secret).encode(), signature.strip().lower().encode())
