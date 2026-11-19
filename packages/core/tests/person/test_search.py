"""Web-search layer: provider selection, SerpApi mapping, keyless fallback, budget, cache, denylist."""
import httpx
import pytest
from sherlock_core import search as websearch
from sherlock_core.search import (
    BudgetedSearch,
    KeylessProvider,
    SearchBudgetExceeded,
    SearchError,
    SearchHit,
    SerpApiProvider,
    TTLCache,
    is_denied,
)
from sherlock_core.search import keyless as keyless_mod

SERP = "https://serpapi.com/search.json"


def _hit(url, title="t"):
    return SearchHit(title=title, url=url, snippet="", source="fake")


# ------------------------------------------------------------------ selection
def test_selection_order_follows_availability(monkeypatch, http):
    monkeypatch.setattr(KeylessProvider, "available", classmethod(lambda cls: False))
    assert websearch.get_provider(http) is None and not websearch.provider_available()

    monkeypatch.setattr(KeylessProvider, "available", classmethod(lambda cls: True))
    assert isinstance(websearch.get_provider(http), KeylessProvider)

    monkeypatch.setenv("SERPAPI_KEY", "k")
    assert isinstance(websearch.get_provider(http), SerpApiProvider)
    assert websearch.provider_available()


def test_keyless_availability_is_tied_to_the_package_and_the_switch(monkeypatch):
    monkeypatch.setattr(keyless_mod.importlib.util, "find_spec", lambda name: object())
    assert KeylessProvider.available()
    monkeypatch.setenv("SEARCH_DISABLE_KEYLESS", "1")
    assert not KeylessProvider.available()
    monkeypatch.delenv("SEARCH_DISABLE_KEYLESS")
    monkeypatch.setattr(keyless_mod.importlib.util, "find_spec", lambda name: None)
    assert not KeylessProvider.available()


def test_serpapi_needs_its_key(monkeypatch):
    assert not SerpApiProvider.available()
    monkeypatch.setenv("SERPAPI_KEY", "  ")
    assert not SerpApiProvider.available()
    monkeypatch.setenv("SERPAPI_KEY", "abc")
    assert SerpApiProvider.available()


# ------------------------------------------------------------------ serpapi
async def test_serpapi_maps_organic_results(respx_mock, http, fx, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "secret")
    route = respx_mock.get(SERP).respond(json=fx("serpapi_google"))
    hits = await SerpApiProvider(http).search('"Tim Berners-Lee"', num=5)
    params = route.calls.last.request.url.params
    assert params["engine"] == "google" and params["q"] == '"Tim Berners-Lee"'
    assert params["api_key"] == "secret" and params["num"] == "5"
    assert hits[0] == SearchHit(title="Speedtest by Ookla - The Global Broadband Speed Test",
                                url="https://www.speedtest.net/", snippet=hits[0].snippet, source="serpapi-google")
    assert len(hits) == 3 and all(h.url.startswith("https://") for h in hits)


async def test_serpapi_errors_and_empty_pages(respx_mock, http, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "bad")
    respx_mock.get(SERP).mock(side_effect=[
        httpx.Response(401, json={"error": "Invalid API key. Your API key should be here: ..."}),
        httpx.Response(200, json={"error": "Google hasn't returned any results for this query."}),
        httpx.Response(429, text="slow down"),
    ])
    with pytest.raises(SearchError, match="Invalid API key"):
        await SerpApiProvider(http).search("x")
    assert await SerpApiProvider(http).search("x") == []
    with pytest.raises(SearchError, match="HTTP 429"):
        await SerpApiProvider(http).search("x")


# ------------------------------------------------------------------ keyless
async def test_keyless_tries_backends_in_order(monkeypatch):
    calls = []

    def fake(query, num, backend):
        calls.append(backend)
        if backend == "bing":
            raise RuntimeError("No results found.")
        return [{"title": "Tim Berners-Lee", "href": "https://en.wikipedia.org/wiki/Tim_Berners-Lee", "body": "b"},
                {"title": "no url"}]

    monkeypatch.setattr(keyless_mod, "_ddgs_text", fake)
    hits = await KeylessProvider().search('"Tim Berners-Lee"', num=5)
    assert calls == ["bing", "google"]
    assert hits == [SearchHit("Tim Berners-Lee", "https://en.wikipedia.org/wiki/Tim_Berners-Lee", "b", "ddgs-google")]


async def test_keyless_reports_blocks_but_not_empty_results(monkeypatch):
    monkeypatch.setattr(keyless_mod, "_ddgs_text", lambda q, n, b: (_ for _ in ()).throw(RuntimeError("No results found.")))
    assert await KeylessProvider().search("x") == []
    monkeypatch.setattr(keyless_mod, "_ddgs_text", lambda q, n, b: (_ for _ in ()).throw(RuntimeError("Ratelimit 202")))
    with pytest.raises(SearchError, match="Ratelimit"):
        await KeylessProvider().search("x")


# ------------------------------------------------------------------ budget and cache
async def test_budget_caps_upstream_queries_and_cache_is_free(fake_search):
    provider = fake_search({"a": [_hit("https://example.org/a")]})
    search = BudgetedSearch(provider, max_queries=2, cache=TTLCache())
    assert await search.search("a 1") and await search.search("  A   1 ") and search.used == 1   # normalised + cached
    await search.search("a 2")
    assert search.used == 2 and search.remaining == 0
    with pytest.raises(SearchBudgetExceeded):
        await search.search("a 3")
    assert await search.search("a 1") == [_hit("https://example.org/a")]                    # cached still answers
    assert provider.queries == ["a 1", "a 2"]


def test_default_budget_is_eight_and_configurable(fake_search, monkeypatch):
    provider = fake_search()
    assert BudgetedSearch(provider).max_queries == 8
    monkeypatch.setenv("SEARCH_MAX_QUERIES_PER_JOB", "3")
    assert BudgetedSearch(provider).max_queries == 3
    monkeypatch.setenv("SEARCH_MAX_QUERIES_PER_JOB", "lots")
    assert BudgetedSearch(provider).max_queries == 8


async def test_cache_is_shared_across_jobs_and_expires(fake_search, monkeypatch):
    provider = fake_search({"q": [_hit("https://example.org/q")]})
    cache = TTLCache(ttl_s=60)
    await BudgetedSearch(provider, cache=cache).search("q")
    second = BudgetedSearch(provider, cache=cache)
    await second.search("q")
    assert second.used == 0 and provider.queries == ["q"]
    clock = [1000.0]
    monkeypatch.setattr("sherlock_core.search.base.time.monotonic", lambda: clock[0])
    cache.put(("fake", "z", 10), [])
    clock[0] += 61
    assert cache.get(("fake", "z", 10)) is None


def test_cache_evicts_oldest_when_full():
    cache = TTLCache(max_entries=4)
    for i in range(6):
        cache.put(("p", str(i), 10), [])
    assert cache.get(("p", "5", 10)) == [] and len(cache._data) <= 4


# ------------------------------------------------------------------ denylist
@pytest.mark.parametrize("url", [
    "https://www.spokeo.com/Tim-Berners-Lee", "https://whitepages.com/name/x", "http://beenverified.com/p",
    "https://www.truepeoplesearch.com/results?name=x", "https://fastpeoplesearch.com/name/x",
    "https://radaris.com/p/Tim/Berners-Lee/", "https://www.mylife.com/x", "https://peekyou.com/x",
    "https://www.intelius.com/x", "https://zabasearch.com/x", "https://thatsthem.com/name/x", "https://uk.pipl.com/x",
    "spokeo.com", "https://WWW.SPOKEO.COM/x",
])
def test_denylist_blocks_people_search_sites(url):
    assert is_denied(url)


@pytest.mark.parametrize("url", [
    "https://github.com/timbl", "https://en.wikipedia.org/wiki/Tim_Berners-Lee", "https://notspokeo.com/x",
    "https://spokeo.com.example.org/x", "", "not a url",
])
def test_denylist_leaves_other_sites(url):
    assert not is_denied(url)


async def test_denied_hits_never_leave_the_search_layer(fake_search):
    provider = fake_search({"x": [_hit("https://www.spokeo.com/Tim"), _hit("https://github.com/timbl"),
                                  _hit("https://radaris.com/p/Tim"), _hit("")]})
    hits = await BudgetedSearch(provider, cache=TTLCache()).search("x")
    assert [h.url for h in hits] == ["https://github.com/timbl"]
