"""Queue position of a case's search, for the "waiting for other searches" message.

The browser cannot see other people's jobs (row-level security), so the gateway counts them.
It returns counts only, never another case's id, target or owner.
"""
from __future__ import annotations

import math
from typing import Annotated, Any

from fastapi import APIRouter, Query
from sherlock_core import config

from gateway.auth import CurrentPrincipal
from gateway.schemas import QueueStatus
from gateway.service import StoreDep, load_case

router = APIRouter(prefix="/queue", tags=["queue"])

Row = dict[str, Any]
MIN_WAIT_S = 30


def queue_status(case_id: str, rows: list[Row], *, concurrency: int, avg_job_s: int) -> Row:
    """Pure: the status of `case_id` from `{case_id, queue, status, created_at}` rows of active jobs.

    Per queue where the case has queued jobs: the searches ahead are other cases whose oldest
    unfinished job there is older than this case's. Claims are round-robin between cases, so the
    case gets a slot after roughly (idle searches ahead + 1) slots free up."""
    mine = [r for r in rows if r["case_id"] == case_id]
    queued = sum(1 for r in mine if r["status"] == "queued")
    running = sum(1 for r in mine if r["status"] == "running")
    ahead = jobs_ahead = idle_ahead = 0
    for q in sorted({r["queue"] for r in mine if r["status"] == "queued"}):
        in_q = [r for r in rows if r["queue"] == q]
        my_start = min(str(r["created_at"]) for r in in_q if r["case_id"] == case_id)
        starts: dict[str, str] = {}
        busy: dict[str, int] = {}
        count: dict[str, int] = {}
        for r in in_q:
            cid = r["case_id"]
            if cid == case_id:
                continue
            starts[cid] = min(starts.get(cid, str(r["created_at"])), str(r["created_at"]))
            count[cid] = count.get(cid, 0) + 1
            busy[cid] = busy.get(cid, 0) + (r["status"] == "running")
        before = [cid for cid, t in starts.items() if t < my_start]
        ahead = max(ahead, len(before))
        jobs_ahead = max(jobs_ahead, sum(count[c] for c in before))
        idle_ahead = max(idle_ahead, sum(1 for c in before if not busy[c]))
    waiting = queued > 0 and running == 0 and ahead > 0
    wait = None
    if waiting:
        wait = max(MIN_WAIT_S, math.ceil((idle_ahead + 1) * avg_job_s / max(1, concurrency)))
    return {"case_id": case_id, "queued": queued, "running": running, "waiting": waiting, "ahead": ahead,
            "jobs_ahead": jobs_ahead, "estimated_wait_s": wait}


@router.get("/status", response_model=QueueStatus)
def status(principal: CurrentPrincipal, store: StoreDep,
           case_id: Annotated[str, Query(min_length=1, max_length=64)]):
    load_case(store, case_id, principal, write=False)
    queues = sorted({j["queue"] for j in store.list_jobs(case_id, active_only=True)})
    rows = store.active_job_summary(queues) if queues else []
    return queue_status(case_id, rows, concurrency=config.WORKER_CONCURRENCY,
                        avg_job_s=config.QUEUE_AVG_JOB_SECONDS)
