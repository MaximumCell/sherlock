"""Gateway test rig: MemoryStore, fake modules, fake token verifier, recorded wake calls."""
import pytest
from fastapi.testclient import TestClient
from gateway.agent.llm import LLMClient
from gateway.auth import Principal, get_token_verifier
from gateway.main import create_app
from gateway.routers.cases import get_llm_client
from gateway.service import reset_purge_clock
from gateway.visitors import reset_touch_cache
from gateway.wake import get_waker
from sherlock_core import config, modules
from sherlock_core.modules.base import Module
from sherlock_core.store import MemoryStore, set_store

TOKENS = {
    "anon": Principal("00000000-0000-4000-8000-00000000000a", is_anonymous=True),
    "user": Principal("00000000-0000-4000-8000-00000000000b", is_anonymous=False,
                      email="kit@example.com", email_verified=True),
    "other": Principal("00000000-0000-4000-8000-00000000000c", is_anonymous=True),
    "admin": Principal("00000000-0000-4000-8000-0000000000ad", is_anonymous=False,
                       email="Operator@Example.com", email_verified=True),
    # the operator's address on an account whose email was never confirmed: not an operator
    "unverified": Principal("00000000-0000-4000-8000-0000000000ae", is_anonymous=False,
                            email="operator@example.com", email_verified=False),
}
ADMIN_EMAILS = frozenset({"operator@example.com"})


def _fake(name_, inputs_, queue_):
    class Fake(Module):
        name = name_
        title = name_.title()
        description = f"fake {name_}"
        inputs = inputs_
        queue = queue_

        async def run(self, target, ctx):
            return []

    return Fake()


class MockLLM(LLMClient):
    def __init__(self, responses=()):
        self.responses = list(responses)
        self.calls = []

    def send(self, history, system_instruction, tools):
        self.calls.append({"history_len": len(history), "system": system_instruction,
                           "tool_names": [t["name"] for t in tools]})
        return self.responses.pop(0) if self.responses else {"text": "(mock exhausted)"}


@pytest.fixture(autouse=True)
def registry(monkeypatch):
    reg = {m.name: m for m in (
        _fake("handles", ("username",), "identity"),
        _fake("mailcheck", ("email", "username"), "identity"),
        _fake("dns", ("domain",), "infra"),
        _fake("people", ("name",), "identity"),
    )}
    monkeypatch.setattr(modules, "_REGISTRY", reg)
    monkeypatch.setattr(modules, "_loaded", True)
    return reg


@pytest.fixture
def store():
    s = MemoryStore()
    set_store(s)
    yield s
    set_store(None)


@pytest.fixture
def woken():
    return []


@pytest.fixture
def llm():
    return MockLLM()


@pytest.fixture
def client(store, woken, llm, monkeypatch):
    monkeypatch.setattr(config, "FRONTEND_ORIGINS", ["https://sherlock.example"])
    monkeypatch.setattr(config, "ADMIN_EMAILS", ADMIN_EMAILS)
    monkeypatch.setattr(config, "INTERNAL_SECRET", "test-secret")
    reset_touch_cache()
    reset_purge_clock()
    app = create_app()

    async def verify(token):
        return TOKENS.get(token)

    async def waker(queues):
        woken.append(sorted(queues))

    app.dependency_overrides[get_token_verifier] = lambda: verify
    app.dependency_overrides[get_waker] = lambda: waker
    app.dependency_overrides[get_llm_client] = lambda: llm
    with TestClient(app) as c:
        yield c


def auth(who="anon"):
    return {"Authorization": f"Bearer {who}"}


@pytest.fixture
def as_anon():
    return auth("anon")


@pytest.fixture
def as_user():
    return auth("user")


@pytest.fixture
def as_other():
    return auth("other")


@pytest.fixture
def as_admin():
    return auth("admin")


@pytest.fixture
def make_case(client, as_anon):
    def _make(headers=None, **body):
        body.setdefault("identifiers", [{"type": "username", "value": "octocat"}])
        r = client.post("/cases", json=body, headers=headers or as_anon)
        assert r.status_code == 201, r.text
        return r.json()

    return _make
