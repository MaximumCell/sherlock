"""Worker HTTP surface and drain lifecycle. MemoryStore, fake modules, in-process ASGI."""
import asyncio
import json
import time

import httpx
import pytest
from sherlock_core import config, jobs, modules
from sherlock_core.modules.base import Module
from sherlock_core.store import MemoryStore, set_store
from worker import main as worker_main

SECRET = "test-secret"


class Gate(Module):
    """Blocks until the test opens the gate, so 'busy' is observable."""

    name = "gate"
    title = "Gate"
    description = "waits for the test"
    inputs = ("username",)
    queue = "identity"
    release: asyncio.Event
    running = 0
    max_running = 0

    async def run(self, target, ctx):
        cls = type(self)
        cls.running += 1
        cls.max_running = max(cls.max_running, cls.running)
        try:
            await cls.release.wait()
        finally:
            cls.running -= 1
        return [ctx.finding(self, target, platform="example")]


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setattr(modules, "_REGISTRY", {"gate": Gate()})
    monkeypatch.setattr(modules, "_loaded", True)
    monkeypatch.setattr(config, "INTERNAL_SECRET", SECRET)
    monkeypatch.setattr(worker_main, "LINGER_S", 0.0)
    monkeypatch.setattr(jobs, "RETRY_DELAY_S", 0)
    Gate.release = asyncio.Event()
    Gate.running = Gate.max_running = 0
    store = MemoryStore()
    set_store(store)
    yield store
    set_store(None)


@pytest.fixture
def app():
    return worker_main.create_app("identity", drain_on_startup=False)


@pytest.fixture
async def client(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://worker") as c:
        yield c
    await app.state.drainer.stop()


def signed(ts=None, secret=SECRET):
    body = json.dumps({"ts": int(time.time()) if ts is None else ts}).encode()
    return {"content": body, "headers": {"X-Sherlock-Signature": jobs.sign_wake(body, secret)}}


def enqueue(store, n=1):
    cid = store.create_case([{"type": "username", "value": "octocat"}], owner_id="u1")["id"]
    for i in range(n):
        store.enqueue_jobs(jobs.plan_scan(cid, "username", f"user{i}"))
    return cid


async def settle(app):
    task = app.state.drainer.task
    if task:
        await asyncio.wait_for(task, timeout=5)


async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200 and r.json() == {"ok": True, "queue": "identity", "busy": False}


async def test_wake_with_valid_signature_drains_the_queue(client, app, env):
    cid = enqueue(env, 2)
    Gate.release.set()
    r = await client.post("/wake", **signed())
    assert r.status_code == 202 and r.json() == {"ok": True, "queue": "identity", "started": True}
    await settle(app)
    assert {j["status"] for j in env.list_jobs(cid)} == {"succeeded"}
    assert (await client.get("/health")).json()["busy"] is False


async def test_wake_rejects_bad_or_missing_signature(client, app):
    bad = signed(secret="wrong")
    assert (await client.post("/wake", **bad)).status_code == 401
    assert (await client.post("/wake", content=b'{"ts": 1}')).status_code == 401
    good = signed()
    tampered = {"content": good["content"] + b" ", "headers": good["headers"]}
    assert (await client.post("/wake", **tampered)).status_code == 401
    assert app.state.drainer.task is None


async def test_wake_rejects_stale_timestamp(client, app):
    assert (await client.post("/wake", **signed(ts=int(time.time()) - 301))).status_code == 401
    assert (await client.post("/wake", **signed(ts=int(time.time()) + 3600))).status_code == 401
    body = b'{"when": "now"}'
    r = await client.post("/wake", content=body, headers={"X-Sherlock-Signature": jobs.sign_wake(body, SECRET)})
    assert r.status_code == 400
    assert app.state.drainer.task is None


async def test_wake_refused_when_no_secret_is_configured(client, monkeypatch):
    monkeypatch.setattr(config, "INTERNAL_SECRET", "")
    body = b'{"ts": 1}'
    r = await client.post("/wake", content=body, headers={"X-Sherlock-Signature": jobs.sign_wake(body, "")})
    assert r.status_code == 503


async def test_no_double_drain(client, app, env):
    cid = enqueue(env, config.WORKER_CONCURRENCY + 2)
    first = await client.post("/wake", **signed())
    await asyncio.sleep(0.05)
    assert (await client.get("/health")).json()["busy"] is True
    task = app.state.drainer.task
    second = await client.post("/wake", **signed())
    third = await client.post("/wake", **signed())
    assert first.json()["started"] is True
    assert second.status_code == third.status_code == 202
    assert second.json()["started"] is False and third.json()["started"] is False
    assert app.state.drainer.task is task

    Gate.release.set()
    await settle(app)
    assert Gate.max_running == config.WORKER_CONCURRENCY  # a small pool, never more
    assert {j["status"] for j in env.list_jobs(cid)} == {"succeeded"}


async def test_wake_during_a_drain_triggers_one_more_pass(client, app, env):
    enqueue(env, 1)
    await client.post("/wake", **signed())
    await asyncio.sleep(0.05)
    await client.post("/wake", **signed())
    assert app.state.drainer._again is True
    Gate.release.set()
    await settle(app)
    assert app.state.drainer._again is False


async def test_drains_on_startup(env):
    cid = enqueue(env, 1)
    Gate.release.set()
    app = worker_main.create_app("identity")
    async with app.router.lifespan_context(app):
        await settle(app)
        assert env.list_jobs(cid)[0]["status"] == "succeeded"


async def test_shutdown_stops_claiming_and_releases_the_running_job(env, monkeypatch):
    monkeypatch.setattr(worker_main, "SHUTDOWN_GRACE_S", 0.05)
    monkeypatch.setattr(config, "WORKER_CONCURRENCY", 2)
    cid = enqueue(env, 3)
    app = worker_main.create_app("identity")
    async with app.router.lifespan_context(app):
        await asyncio.sleep(0.05)  # two jobs are now blocked inside the module, one waits for a slot
        assert app.state.drainer.busy
    drainer = app.state.drainer
    assert drainer.stopping and not drainer.busy
    assert drainer.kick() is False
    rows = env.list_jobs(cid)
    assert sorted(j["status"] for j in rows) == ["queued", "queued", "queued"]
    assert sorted(j["attempts"] for j in rows) == [0, 1, 1]      # both running jobs were handed back


async def test_drain_survives_a_store_outage(app, monkeypatch):
    def boom():
        raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_KEY are not set")

    monkeypatch.setattr(worker_main, "get_store", boom)
    assert app.state.drainer.kick() is True
    await settle(app)
    assert app.state.drainer.busy is False
