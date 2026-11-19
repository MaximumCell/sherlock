"""Fixtures for the name-search tests: recorded responses, a mocked HTTP client, a fake search provider."""
import json
from pathlib import Path

import httpx
import pytest
from sherlock_core import search as websearch
from sherlock_core.modules import ModuleContext, Target, get_module
from sherlock_core.search import SearchHit, SearchProvider

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fx():
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
    """await run("person_orcid", "Tim Berners-Lee", city="Oxford") -> findings."""
    async def _run(module: str, value: str, **params):
        mod = get_module(module)
        assert mod is not None, f"module {module} is not registered"
        assert mod.inputs == ("name",) and mod.queue == "identity"
        return await mod.run(Target("name", value, params), ctx)
    return _run


@pytest.fixture(autouse=True)
def isolated_search(monkeypatch):
    """No test may reach a real search engine or share cached results with another test."""
    for var in ("SERPAPI_KEY", "SEARCH_DISABLE_KEYLESS", "SEARCH_MAX_QUERIES_PER_JOB", "GITHUB_TOKEN",
                "OPENALEX_API_KEY", "COMPANIES_HOUSE_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setattr("sherlock_core.search.keyless._ddgs_text", _no_network)
    websearch.CACHE.clear()
    yield
    websearch.CACHE.clear()


def _no_network(*a, **k):
    raise AssertionError("the ddgs library must not be called in tests")


class FakeProvider(SearchProvider):
    """Answers from a dict {query substring: [hits]}; records every upstream query."""
    name = "fake"

    def __init__(self, answers=None, error=None):
        self.answers = answers or {}
        self.error = error
        self.queries: list[str] = []

    @classmethod
    def available(cls) -> bool:
        return True

    async def search(self, query, *, num=10):
        self.queries.append(query)
        if self.error:
            raise self.error
        for needle, hits in self.answers.items():
            if needle in query:
                return list(hits)[:num]
        return []


def hit(url, title, snippet=""):
    return SearchHit(title=title, url=url, snippet=snippet, source="fake")


@pytest.fixture
def fake_search(monkeypatch):
    """Install a FakeProvider as the selected web-search provider."""
    def install(answers=None, error=None):
        provider = FakeProvider(answers, error)
        monkeypatch.setattr(websearch, "get_provider", lambda http: provider)
        monkeypatch.setattr(websearch, "provider_available", lambda: True)
        return provider
    return install
