"""Shared fixtures for the offline module tests (network is mocked with respx)."""
import json
from pathlib import Path

import httpx
import pytest
from sherlock_core.modules import ModuleContext, Target, get_module

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fx():
    """Load a recorded response: fx("rdap_domain") -> parsed JSON."""
    def load(name: str):
        return json.loads((FIXTURES / f"{name}.json").read_text(encoding="utf-8"))
    return load


@pytest.fixture
async def http():
    async with httpx.AsyncClient(follow_redirects=True) as client:
        yield client


@pytest.fixture
def ctx(http):
    return ModuleContext(case_id="case-1", http=http, max_concurrency=5)


@pytest.fixture
def run(ctx):
    """await run("crtsh", "domain", "example.com") -> findings of that registered module."""
    async def _run(module: str, target_type: str, value: str, **params):
        mod = get_module(module)
        assert mod is not None, f"module {module} is not registered"
        assert target_type in mod.inputs
        return await mod.run(Target(target_type, value, params), ctx)
    return _run


@pytest.fixture
def meta():
    """Top-level extra_metadata of a finding without the url / extra keys."""
    return lambda f: {k: v for k, v in f["extra_metadata"].items() if k not in ("url", "extra")}
