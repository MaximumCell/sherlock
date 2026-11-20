"""`linkedin_search`: LinkedIn through public search results only. Offline.

`fixtures/linkedin_ddgs.json` holds real keyless (ddgs/Bing) answers recorded 2026-11-20 for
public figures; FakeProvider hits are synthetic and say so.
"""
import json
import re
from pathlib import Path

import pytest
from sherlock_core import jobs
from sherlock_core.modules import Target, get_module
from sherlock_core.modules.linkedin_search import parse_hit, slug_matches, slug_of
from sherlock_core.resolve import resolve_candidates
from sherlock_core.search import SearchError, SearchHit

from .conftest import hit

RECORDED = json.loads((Path(__file__).parent / "fixtures" / "linkedin_ddgs.json").read_text(encoding="utf-8"))


@pytest.fixture
def recorded_keyless(monkeypatch):
    """The real keyless provider, answering from the recorded ddgs rows (matched on the quoted term)."""
    asked = []

    def fake_ddgs(query, num, backend):
        asked.append(query)
        term = re.search(r'"([^"]+)"', query).group(1).casefold()
        for q, rec in RECORDED.items():
            if q.startswith("_") or not rec["rows"]:
                continue
            if re.search(r'"([^"]+)"', q).group(1).casefold() == term:
                return rec["rows"]
        raise RuntimeError("No results found.")

    monkeypatch.setattr("sherlock_core.search.keyless._ddgs_text", fake_ddgs)
    return asked


@pytest.fixture
def li(ctx):
    mod = get_module("linkedin_search")
    assert mod is not None and mod.queue == "identity" and set(mod.inputs) == {"username", "name"}

    async def _run(target_type, value, **params):
        return await mod.run(Target(target_type, value, params), ctx)
    return _run


def extra(row):
    return row["extra_metadata"]["extra"]


# ----------------------------------------------------------------------------- recorded keyless answers
async def test_username_from_recorded_keyless_results(li, recorded_keyless, respx_mock):
    (row,) = await li("username", "satyanadella")
    assert recorded_keyless == ['site:linkedin.com/in "satyanadella"']
    assert row["status"] == "found" and row["platform"] == "linkedin"
    assert row["extra_metadata"]["url"] == "https://www.linkedin.com/in/satyanadella"
    e = extra(row)
    assert e["fullname"] == "Satya Nadella"
    assert e["headline"] == "Chairman and CEO at Microsoft"
    assert e["employer"] == "Microsoft"
    assert e["linkedin"] == "satyanadella" and e["handle"] == "satyanadella"
    assert e["preview"]["source"] == "search-snippet" and e["preview"]["provider"] == "ddgs-bing"
    assert "avatar_url" not in e                                  # ddgs returns no thumbnails
    assert not respx_mock.calls                                   # linkedin.com is never fetched


async def test_name_from_recorded_keyless_results(li, recorded_keyless):
    (row,) = await li("name", "Reid Hoffman")
    e = extra(row)
    assert e["fullname"] == "Reid Hoffman" and e["headline"] == "Co-Founder, LinkedIn, Manas AI"
    assert e["candidate_hint"]["kind"] == "profile"
    assert e["candidate_hint"]["ids"] == {"linkedin": "reidhoffman"}
    assert row["identifier_type"] == "name"


async def test_keyless_no_results_is_empty_not_an_error(li, recorded_keyless):
    assert await li("name", "Satya Nadella") == []


# ----------------------------------------------------------------------------- parsing
def test_slugs():
    assert slug_of("https://uk.linkedin.com/in/ada-lovelace-1a2b3c/") == "ada-lovelace-1a2b3c"
    assert slug_of("https://www.linkedin.com/in/maximumcell?trk=x") == "maximumcell"
    assert slug_of("https://www.linkedin.com/posts/satyanadella_x-activity-1") == ""
    assert slug_of("https://linkedin.example.com/in/x") == ""
    assert slug_matches("maximumcell", "maximumcell")
    assert slug_matches("maximumcell-1a2b3c", "maximumcell")
    assert not slug_matches("maximumcellular", "maximumcell")
    assert not slug_matches("notmaximumcell", "maximumcell")


def test_concatenated_ddgs_rows_are_cut_and_their_snippet_ignored():
    # synthetic, in the exact shape the Bing backend produced on 2026-11-20 (real rows hold private people)
    h = SearchHit(
        title="Jane Example - CTO at Examplecorp | LinkedInJohn Other - Consultant at Othercorp ...Ann Third - Nurse ...",
        url="https://www.linkedin.com/in/janeexample",
        snippet="CTO at Examplecorp · Building things ... Consultant · Experience: Othercorp · Location: Elsewhere",
        source="ddgs-bing")
    f = parse_hit(h)
    assert f["polluted"] and f["name"] == "Jane Example" and f["headline"] == "CTO at Examplecorp"
    assert f["employer"] == "Examplecorp" and "location" not in f       # Othercorp / Elsewhere are someone else's
    g = parse_hit(SearchHit(title="Jane Example - RN, BSN | LinkedInJane Example - Student at Example U | LinkedIn",
                            url="https://www.linkedin.com/in/jane-example-1", snippet="", source="ddgs-google"))
    assert g["polluted"] and g["headline"] == "RN, BSN"


def test_snippet_fields_and_localised_titles():
    f = parse_hit(hit("https://www.linkedin.com/in/ada", "Ada Example - Engineer - Examplecorp | LinkedIn",
                      "Engineer · Experience: Examplecorp · Education: Example University · Location: Oxford · "
                      "500+ connections on LinkedIn"))
    assert f == {"polluted": False, "name": "Ada Example", "headline": "Engineer", "employer": "Examplecorp",
                 "education": "Example University", "location": "Oxford"}
    g = parse_hit(hit("https://ch.linkedin.com/in/ada", "Ada Example – Thalwil, Zürich, Schweiz | Berufliches Profil ...",
                      "Ort: Thalwil · 500+ Kontakte auf LinkedIn."))
    assert g["name"] == "Ada Example" and g["location"] == "Thalwil, Zürich, Schweiz" and "headline" not in g


# ----------------------------------------------------------------------------- behaviour (synthetic hits)
async def test_username_accepts_only_slug_matches(li, fake_search):
    provider = fake_search({"site:linkedin.com/in": [
        hit("https://www.linkedin.com/in/maximumcell-1a2b3c", "Max Cell - Engineer | LinkedIn"),
        hit("https://www.linkedin.com/in/maximumcellular", "Someone Else - Sales | LinkedIn"),
        hit("https://www.linkedin.com/company/maximumcell", "Maximumcell | LinkedIn"),
        hit("https://www.linkedin.com/in/max-cell", "Max Cell | LinkedIn", "maximumcell"),
    ]})
    rows = await li("username", "maximumcell")
    assert [extra(r)["linkedin"] for r in rows] == ["maximumcell-1a2b3c"]
    assert provider.queries == ['site:linkedin.com/in "maximumcell"']


async def test_username_with_separators_tries_the_hyphen_form_second(li, fake_search):
    provider = fake_search({'"max-cell"': [hit("https://www.linkedin.com/in/max-cell", "Max Cell | LinkedIn")]})
    (row,) = await li("username", "max.cell")
    assert provider.queries == ['site:linkedin.com/in "max.cell"', 'site:linkedin.com/in "max-cell"']
    assert extra(row)["linkedin"] == "max-cell"


async def test_name_uses_hints_caps_results_and_feeds_candidate_resolution(li, fake_search):
    hits = [hit(f"https://www.linkedin.com/in/ada-lovelace-{i}", f"Ada Lovelace - Engineer {i} | LinkedIn",
                f"Engineer · Experience: Firm{i} · Location: London") for i in range(7)]
    hits.insert(0, hit("https://www.linkedin.com/in/bob", "Bob Builder - mentions Ada Lovelace | LinkedIn"))
    provider = fake_search({"site:linkedin.com/in": hits})
    rows = await li("name", "Ada Lovelace", city="London", employer="Firm 0")
    assert provider.queries == ['site:linkedin.com/in "Ada Lovelace" London "Firm 0"']    # one query: it matched
    assert len(rows) == 5 and all(extra(r)["fullname"] == "Ada Lovelace" for r in rows)
    cands = resolve_candidates(rows, "Ada Lovelace", {"city": "London"})
    assert len(cands) == 5                                       # five different profiles, five candidates
    assert {c.label for c in cands} == {f"Ada Lovelace (Firm{i})" for i in range(5)}   # employer from the snippet
    assert all(any("London" in e for e in c.evidence) for c in cands)   # the city hint counts for each


async def test_thumbnail_becomes_the_avatar(li, fake_search):
    fake_search({"site:linkedin.com/in": [SearchHit(
        title="Ada Example - Engineer | LinkedIn", url="https://www.linkedin.com/in/ada-example",
        snippet="", source="serpapi-google", thumbnail="https://media.licdn.example/ada.jpg")]})
    (row,) = await li("username", "ada-example")
    assert extra(row)["avatar_url"] == "https://media.licdn.example/ada.jpg"


async def test_provider_errors_and_unavailability(li, fake_search, monkeypatch):
    fake_search(error=SearchError("SerpApi: Invalid API key."))
    (row,) = await li("username", "maximumcell")
    assert row["status"] == "error" and "Invalid API key" in row["extra_metadata"]["reason"]

    from sherlock_core import search as websearch
    monkeypatch.setattr(websearch, "get_provider", lambda http: None)
    monkeypatch.setattr(websearch, "provider_available", lambda: False)
    assert get_module("linkedin_search").available() is False
    (row,) = await li("username", "maximumcell")
    assert row["status"] == "error"


def test_planned_for_username_and_name_scans_when_available(fake_search, monkeypatch):
    fake_search({})
    for target_type, value in (("username", "maximumcell"), ("name", "Ada Lovelace")):
        planned = {j["module"] for j in jobs.plan_scan("c1", target_type, value)}
        assert "linkedin_search" in planned
    monkeypatch.setenv("SEARCH_DISABLE_KEYLESS", "1")
    from sherlock_core import search as websearch
    monkeypatch.setattr(websearch, "provider_available", lambda: any(p.available() for p in websearch.PROVIDERS))
    assert "linkedin_search" not in {j["module"] for j in jobs.plan_scan("c1", "username", "maximumcell")}
