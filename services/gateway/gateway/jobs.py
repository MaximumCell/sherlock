"""In-memory job store for async scan operations.

Why this exists: user_scanner.scan() can take 1-3 minutes per call. A
synchronous POST /cases/{id}/scan-username leaves the browser connection
open that whole time — and any hiccup (server restart, 30-min background
task timeout, network blip) becomes an opaque "Failed to fetch" for the
user. Async scans return 202 immediately; the frontend polls for status.

Storage: simple in-process dict. Survives the request, lost on server
restart. For production scale this would be Redis or a `jobs` table.
"""
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Job:
    id: str
    case_id: str
    kind: str          # "scan_username" | "scan_email" | "enrich"
    target: str        # the value being scanned / the finding being enriched
    status: str = "running"   # "running" | "completed" | "failed"
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    result: dict[str, Any] | None = None
    error: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "case_id": self.case_id,
            "kind": self.kind,
            "target": self.target,
            "status": self.status,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "elapsed_s": (self.finished_at or time.time()) - self.started_at,
            "result": self.result,
            "error": self.error,
        }


_JOBS: dict[str, Job] = {}


def create(case_id: str, kind: str, target: str) -> Job:
    job = Job(id=str(uuid.uuid4()), case_id=case_id, kind=kind, target=target)
    _JOBS[job.id] = job
    return job


def get(job_id: str) -> Job | None:
    return _JOBS.get(job_id)


def complete(job_id: str, result: dict):
    job = _JOBS.get(job_id)
    if not job:
        return
    job.status = "completed"
    job.finished_at = time.time()
    job.result = result


def fail(job_id: str, error: str):
    job = _JOBS.get(job_id)
    if not job:
        return
    job.status = "failed"
    job.finished_at = time.time()
    job.error = error


def list_for_case(case_id: str) -> list[dict]:
    return [j.to_dict() for j in _JOBS.values() if j.case_id == case_id]


def prune_finished(max_age_s: float = 600) -> int:
    """Drop finished jobs older than max_age_s to keep the dict bounded."""
    now = time.time()
    stale = [
        jid for jid, j in _JOBS.items()
        if j.finished_at is not None and (now - j.finished_at) > max_age_s
    ]
    for jid in stale:
        _JOBS.pop(jid, None)
    return len(stale)
