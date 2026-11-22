"""Poke sleeping workers after jobs were enqueued.

Best effort by design: a worker on a free instance may take a minute to cold-start,
so the call uses a short timeout and its outcome is ignored. The inbound request is
what starts the instance, and the worker drains its queue on startup anyway.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable, Iterable

import httpx
from sherlock_core import config
from sherlock_core.jobs import sign_wake

log = logging.getLogger("sherlock.gateway.wake")

# A sleeping Render free instance takes ~30-60 s to start, and the platform only finishes
# starting it while the waking request is still open. A 4 s timeout dropped the request too
# early and left jobs queued until someone else woke the worker. Wakes run in a background
# task, so nobody waits on this.
WAKE_TIMEOUT_S = 90.0

Waker = Callable[[Iterable[str]], Awaitable[None]]


async def poke_workers(queues: Iterable[str], *, client: httpx.AsyncClient | None = None) -> None:
    """POST {WORKER_URL_<QUEUE>}/wake for each queue. Never raises."""
    targets = {q: config.WORKER_URLS.get(q.removeprefix(config.QUEUE_PREFIX), "") for q in sorted(set(queues))}
    targets = {q: url for q, url in targets.items() if url}
    if not targets:
        return
    if not config.INTERNAL_SECRET:
        log.warning("INTERNAL_SECRET is not set; workers cannot be woken")
        return
    body = json.dumps({"ts": int(time.time())}).encode()
    headers = {"Content-Type": "application/json", "X-Sherlock-Signature": sign_wake(body, config.INTERNAL_SECRET)}

    async def one(http: httpx.AsyncClient, queue: str, url: str) -> None:
        try:
            r = await http.post(f"{url.rstrip('/')}/wake", content=body, headers=headers)
            log.info("woke worker", extra={"queue": queue, "status": r.status_code})
        except httpx.HTTPError as e:  # expected while the worker is cold
            log.info("wake not acknowledged", extra={"queue": queue, "error": type(e).__name__})
        except Exception:
            log.warning("wake failed", extra={"queue": queue}, exc_info=True)

    owned = client is None
    http = client or httpx.AsyncClient(timeout=WAKE_TIMEOUT_S)
    try:
        await asyncio.gather(*(one(http, q, url) for q, url in targets.items()))
    finally:
        if owned:
            await http.aclose()


def get_waker() -> Waker:
    """Dependency so tests can record pokes instead of sending them."""
    return poke_workers
