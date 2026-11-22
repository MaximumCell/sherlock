"""Queue worker: one process per queue (WORKER_QUEUE), deployed as a free web service.

The process may be asleep. The gateway wakes it with a signed `POST /wake`; it then
drains its queue with a small pool (WORKER_CONCURRENCY jobs at once, at most one
memory-heavy module among them) and goes idle. It also drains on startup, because
a cold start usually means jobs are already waiting. Jobs live in Postgres, so a
killed worker loses nothing: the stale-heartbeat requeue hands its job to the next claim.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import time
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sherlock_core import config
from sherlock_core.jobs import WAKE_MAX_AGE_S, drain, verify_wake
from sherlock_core.store import get_store

from worker.logs import setup_logging

log = logging.getLogger("sherlock.worker")

# How long a drain keeps polling for retries that are waiting out their backoff.
LINGER_S = 90.0
# On shutdown, give the in-flight jobs this long to finish before cancelling them (each is handed back).
SHUTDOWN_GRACE_S = 10.0


class Health(BaseModel):
    ok: bool
    queue: str
    busy: bool


class WakeAccepted(BaseModel):
    ok: bool
    queue: str
    started: bool


class Drainer:
    """Owns the single drain loop (a pool of up to WORKER_CONCURRENCY jobs) of this process."""

    def __init__(self, queue: str) -> None:
        self.queue = queue
        self.worker_id = f"{queue}-{socket.gethostname()}-{os.getpid()}"
        self.task: asyncio.Task | None = None
        self.stopping = False
        self._again = False

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()

    def kick(self) -> bool:
        """Start the drain loop unless one is running. True when a new loop was started."""
        if self.stopping:
            return False
        if self.busy:
            self._again = True  # a job may have been queued after the loop's last claim
            return False
        self.task = asyncio.create_task(self._run(), name=f"drain-{self.queue}")
        return True

    async def _run(self) -> None:
        try:
            store = get_store()
            while not self.stopping:
                self._again = False
                n = await drain(self.queue, store, self.worker_id,
                                should_stop=lambda: self.stopping, linger_s=LINGER_S)
                log.info("drain finished", extra={"queue": self.queue, "jobs": n})
                if not self._again:
                    break
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("drain loop crashed")

    async def stop(self) -> None:
        self.stopping = True  # stop claiming
        if not self.busy:
            return
        assert self.task is not None
        _, pending = await asyncio.wait({self.task}, timeout=SHUTDOWN_GRACE_S)
        if pending:
            self.task.cancel()
            with suppress(asyncio.CancelledError, Exception):
                await self.task


def create_app(queue: str | None = None, *, drain_on_startup: bool = True) -> FastAPI:
    drainer = Drainer(queue or config.QUEUE_PREFIX + config.WORKER_QUEUE)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        # uvicorn turns SIGTERM into this lifespan shutdown.
        if drain_on_startup:
            drainer.kick()
        yield
        await drainer.stop()

    app = FastAPI(title=f"Sherlock worker ({drainer.queue})", version="2.0.0", lifespan=lifespan)
    app.state.drainer = drainer

    @app.get("/health", response_model=Health)
    async def health() -> Health:
        return Health(ok=True, queue=drainer.queue, busy=drainer.busy)

    @app.post("/wake", status_code=202, response_model=WakeAccepted)
    async def wake(request: Request):
        body = await request.body()
        if not config.INTERNAL_SECRET:
            return JSONResponse({"detail": "INTERNAL_SECRET is not configured"}, status_code=503)
        if not verify_wake(body, request.headers.get("x-sherlock-signature"), config.INTERNAL_SECRET):
            return JSONResponse({"detail": "bad signature"}, status_code=401)
        try:
            ts = float(json.loads(body)["ts"])
        except (ValueError, KeyError, TypeError):
            return JSONResponse({"detail": 'body must be {"ts": <unix seconds>}'}, status_code=400)
        if abs(time.time() - ts) > WAKE_MAX_AGE_S:
            return JSONResponse({"detail": "stale wake request"}, status_code=401)
        started = drainer.kick()
        return WakeAccepted(ok=True, queue=drainer.queue, started=started)

    return app


setup_logging()
app = create_app()
