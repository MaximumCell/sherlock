"""Name-search (`person_*`) modules: found / empty / error each, offline (respx + recorded fixtures)."""
import json

import httpx
import pytest
from sherlock_core import modules
from sherlock_core.modules.person_util import coarse_location, hints_of
from sherlock_core.modules.person_web import build_queries, classify, profile_of
from sherlock_core.search import KeylessProvider, SearchError, SearchHit

OPENALEX = "https://api.openalex.org/authors"
ORCID = "https://pub.orcid.org/v3.0"
WIKIDATA = "https://www.wikidata.org/w/api.php"
GH = "https://api.github.com"
CH = "https://api.company-information.service.gov.uk"
PERSON_MODULES = {"person_openalex", "person_orcid", "person_wikidata", "person_github", "person_companies",
                  "person_web"}


def _extra(f):
    return f["extra_metadata"]["extra"]


def _hit(url, title, snippet=""):
    return SearchHit(title=title, url=url, snippet=snippet, source="fake")


def test_person_modules_are_registered_for_names():
    names = {m.name for m in modules.modules_for("name", only_available=False)}
    assert names >= PERSON_MODULES
    for name in PERSON_MODULES:
        m = modules.get_module(name)
        assert m.inputs == ("name",) and m.queue == "identity" and m.title and m.description
    assert modules.get_module("person_patents") is None          # no keyless official API verified
    assert modules.get_module("person_companies").requires_env == ("COMPANIES_HOUSE_API_KEY",)


# ------------------------------------------------------------------ helpers
def test_hints_are_cleaned():
    from sherlock_core.modules.base import Target
    t = Target("name", "x", {"city": "  Oxford ", "employer": "", "school": 3, "keywords": "web, w3c;  web",
                             "street": "1 High St"})
    assert hints_of(t) == {"city": "Oxford", "keywords": ["web", "w3c"]}


@pytest.mark.parametrize("raw,expected", [
    ("Oxford, Oxfordshire, United Kingdom, Europe", "Oxford, Oxfordshire, United Kingdom"),
    ("Portland, OR", "Portland, OR"),
    ("12 Sample Street, London", None),
    ("Flat 3, Baker Street", None),
    ("London SW1A 1AA", None),
    ("me@example.org", None),
    (None, None),
])
def test_location_is_city_level_only(raw, expected):
    assert coarse_location(raw) == expected


# ------------------------------------------------------------------ openalex
async def test_openalex_found(respx_mock, run, fx):
    route = respx_mock.get(OPENALEX).respond(json=fx("openalex_authors"))
    rows = await run("person_openalex", "Tim Berners-Lee")
    assert route.calls.last.request.url.params["search"] == "Tim Berners-Lee"
    assert len(route.calls) == 1                                    # no co-author lookups
    assert [r["status"] for r in rows] == ["found"] * 3
    top = rows[0]
    assert top["platform"] == "openalex" and top["extra_metadata"]["url"] == "https://openalex.org/A5025908133"
    e = _extra(top)
    assert e["fullname"] == "Tim Berners‐Lee" and e["orcid"] == "0000-0003-1279-3709"
    assert "University of Oxford" in e["employer"] and e["location"] == "GB"
    assert e["links"] == "https://orcid.org/0000-0003-1279-3709"
    assert e["candidate_hint"]["ids"] == {"openalex": "A5025908133", "orcid": "0000-0003-1279-3709"}
    assert "coauthors" not in e and "associates" not in e["candidate_hint"]


async def test_openalex_empty_and_errors(respx_mock, run):
    respx_mock.get(OPENALEX).mock(side_effect=[
        httpx.Response(200, json={"meta": {"count": 0}, "results": []}),
        httpx.Response(429, headers={"retry-after": "30"}),
    ])
    assert await run("person_openalex", "Nobody Atall") == []
    [err] = await run("person_openalex", "Tim Berners-Lee")
    assert err["status"] == "error" and "429" in err["extra_metadata"]["reason"]


async def test_openalex_drops_records_whose_name_does_not_match(respx_mock, run, fx):
    data = fx("openalex_authors")
    data["results"][0]["display_name"], data["results"][0]["display_name_alternatives"] = "Tim Cook", []
    respx_mock.get(OPENALEX).respond(json=data)
    rows = await run("person_openalex", "Tim Berners-Lee")
    assert all("Cook" not in _extra(r)["fullname"] for r in rows) and len(rows) == 2


# ------------------------------------------------------------------ orcid
async def test_orcid_found(respx_mock, run, fx):
    search = respx_mock.get(f"{ORCID}/expanded-search/").respond(json=fx("orcid_search"))
    record = respx_mock.get(f"{ORCID}/0000-0003-1279-3709/record").respond(json=fx("orcid_record"))
    [row] = await run("person_orcid", "Tim Berners-Lee")
    q = search.calls.last.request.url.params["q"]
    assert 'family-name:"Berners Lee"' in q and "given-names:tim*" in q
    assert search.calls.last.request.headers["accept"] == "application/json" and record.called
    e = _extra(row)
    assert row["platform"] == "orcid" and row["extra_metadata"]["url"] == "https://orcid.org/0000-0003-1279-3709"
    assert e["fullname"] == "Timothy Berners-Lee" and e["orcid"] == "0000-0003-1279-3709"
    assert e["employer"].startswith("Inrupt") and "University of Oxford" in e["employer"]
    assert e["location"] == "Boston, US"                            # city + country, never a street
    assert e["links"] == "https://timbl.solidcommunity.net/profile/card#me"
    assert e["employments"][0] == "CoFounder and CTO, Inrupt"
    assert "Timothy J Berners-Lee" in e["candidate_hint"]["aliases"]


async def test_orcid_empty_and_errors(respx_mock, run, fx):
    respx_mock.get(f"{ORCID}/expanded-search/").mock(side_effect=[
        httpx.Response(200, json={"expanded-result": None, "num-found": 0}),
        httpx.Response(403, text="forbidden"),
        httpx.Response(200, json=fx("orcid_search")),
    ])
    respx_mock.get(f"{ORCID}/0000-0003-1279-3709/record").respond(503)
    assert await run("person_orcid", "Nobody Atall") == []
    [err] = await run("person_orcid", "Tim Berners-Lee")
    assert err["status"] == "error" and "403" in err["extra_metadata"]["reason"]
    [partial] = await run("person_orcid", "Tim Berners-Lee")      # record unavailable: search hit only
    assert partial["status"] == "found" and "CERN" in _extra(partial)["employer"]


# ------------------------------------------------------------------ wikidata
def _wikidata(fx, search_status=200):
    def respond(request):
        p = request.url.params
        if p["action"] == "wbsearchentities":
            return httpx.Response(search_status, json=fx("wikidata_search"))
        if "claims" in p.get("props", ""):
            return httpx.Response(200, json=fx("wikidata_entities"))
        return httpx.Response(200, json=fx("wikidata_labels"))
    return respond


async def test_wikidata_found_with_social_handles(respx_mock, run, fx):
    route = respx_mock.get(WIKIDATA).mock(side_effect=_wikidata(fx))
    [row] = await run("person_wikidata", "Tim Berners-Lee")        # the books / TED talks are not humans
    assert len(route.calls) == 3
    e = _extra(row)
    assert row["platform"] == "wikidata" and row["extra_metadata"]["url"] == "https://www.wikidata.org/wiki/Q80"
    assert e["fullname"] == "Tim Berners-Lee" and e["wikidata"] == "Q80" and e["orcid"] == "0000-0003-1279-3709"
    assert (e["twitter"], e["github"], e["mastodon"]) == ("timberners_lee", "timbl", "timbl@w3c.social")
    links = e["links"].split(", ")
    assert {"https://x.com/timberners_lee", "https://github.com/timbl", "https://w3c.social/@timbl",
            "https://en.wikipedia.org/wiki/Tim_Berners-Lee", "https://orcid.org/0000-0003-1279-3709"} <= set(links)
    assert "CERN" in e["employer"] and "computer scientist" in e["occupation"]
    assert e["education"].startswith("The Queen's College")
    assert e["bio"] == "English computer scientist (born 1955)"
    hint = e["candidate_hint"]
    assert hint["ids"] == {"wikidata": "Q80", "orcid": "0000-0003-1279-3709", "twitter": "timberners_lee",
                           "github": "timbl", "mastodon": "timbl@w3c.social"}
    blob = json.dumps(row)
    assert "P569" not in blob and "date_of_birth" not in blob   # birth data / family are never read


async def test_wikidata_empty_and_errors(respx_mock, run, fx):
    respx_mock.get(WIKIDATA).mock(side_effect=_wikidata(fx, search_status=429))
    [err] = await run("person_wikidata", "Tim Berners-Lee")
    assert err["status"] == "error" and "429" in err["extra_metadata"]["reason"]
    respx_mock.get(WIKIDATA).respond(json={"search": []})
    assert await run("person_wikidata", "Nobody Atall") == []


# ------------------------------------------------------------------ github
async def test_github_found(respx_mock, run, fx):
    search = respx_mock.get(f"{GH}/search/users").respond(json=fx("github_search_users"))
    respx_mock.get(f"{GH}/users/torvalds").respond(json=fx("github_user"))
    respx_mock.get(f"{GH}/users/nthng-quan").respond(json={"login": "nthng-quan", "name": "Quan Nguyen"})
    respx_mock.get(url__regex=rf"{GH}/users/.+").respond(404)
    rows = await run("person_github", "Linus Torvalds")
    assert search.calls.last.request.url.params["q"] == 'fullname:"Linus Torvalds"'
    logins = [_extra(r)["username"] for r in rows]
    assert "nthng-quan" not in logins                       # profile name says someone else
    top = rows[0]
    e = _extra(top)
    assert top["platform"] == "github" and top["extra_metadata"]["url"] == "https://github.com/torvalds"
    assert e["github"] == "torvalds" and e["fullname"] == "Linus Torvalds"
    assert e["employer"] == "Linux Foundation" and e["location"] == "Portland, OR"
    assert e["candidate_hint"]["kind"] == "profile"


async def test_github_rate_limits(respx_mock, run, fx):
    respx_mock.get(f"{GH}/search/users").mock(side_effect=[
        httpx.Response(403, headers={"x-ratelimit-remaining": "0"}, json={"message": "API rate limit exceeded"}),
        httpx.Response(200, json=fx("github_search_users")),
        httpx.Response(200, json={"total_count": 0, "items": []}),
    ])
    respx_mock.get(url__regex=rf"{GH}/users/.+").respond(429, json={"message": "rate limit"})
    [err] = await run("person_github", "Linus Torvalds")
    assert err["status"] == "error" and "rate limit" in err["extra_metadata"]["reason"]
    partial = await run("person_github", "Linus Torvalds")
    assert len(partial) == 5 and all("partial" in r["extra_metadata"] for r in partial)
    assert await run("person_github", "Nobody Atall") == []


# ------------------------------------------------------------------ companies house
async def test_companies_house_keeps_only_allowlisted_fields(respx_mock, run, fx, monkeypatch):
    assert not modules.get_module("person_companies").available()
    monkeypatch.setenv("COMPANIES_HOUSE_API_KEY", "key")
    assert modules.get_module("person_companies").available()
    search = respx_mock.get(f"{CH}/search/officers").respond(json=fx("companies_house_officer_search"))
    appts = respx_mock.get(f"{CH}/officers/AbCdEf123456/appointments").respond(json=fx("companies_house_appointments"))
    [row] = await run("person_companies", "Ada Example")
    assert search.calls.last.request.headers["authorization"].startswith("Basic ") and appts.called
    e = _extra(row)
    assert row["platform"] == "companies-house" and e["fullname"] == "Ada Example"
    assert e["employer"] == "EXAMPLE ENGINES LTD" and e["jurisdiction"] == "gb"
    assert e["appointments"] == [
        {"role": "director", "company": "EXAMPLE ENGINES LTD", "company_number": "01234567",
         "company_status": "active", "jurisdiction": "gb", "appointed_on": "2015-04-01"},
        {"role": "secretary", "company": "OLD WIDGETS LIMITED", "company_number": "07654321",
         "company_status": "dissolved", "jurisdiction": "gb", "appointed_on": "2009-01-10",
         "resigned_on": "2012-06-30"},
    ]
    blob = json.dumps(row).lower()
    for leaked in ("sample street", "ab1 2cd", "1970", "date_of_birth", "nationality", "country_of_residence",
                   "address"):
        assert leaked not in blob


async def test_companies_house_empty_and_errors(respx_mock, run, monkeypatch):
    monkeypatch.setenv("COMPANIES_HOUSE_API_KEY", "key")
    respx_mock.get(f"{CH}/search/officers").mock(side_effect=[
        httpx.Response(200, json={"items": []}),
        httpx.Response(401, json={"error": "Invalid Authorization"}),
        httpx.Response(429, text=""),
    ])
    assert await run("person_companies", "Ada Example") == []
    [bad_key] = await run("person_companies", "Ada Example")
    assert bad_key["status"] == "error" and "COMPANIES_HOUSE_API_KEY" in bad_key["extra_metadata"]["reason"]
    [limited] = await run("person_companies", "Ada Example")
    assert "429" in limited["extra_metadata"]["reason"]


# ------------------------------------------------------------------ web
def test_queries_use_hints_and_fit_the_budget():
    plain = build_queries("Tim Berners-Lee", {})
    assert plain[0] == ("general", '"Tim Berners-Lee"') and len(plain) <= 8
    assert ("linkedin", '"Tim Berners-Lee" site:linkedin.com/in') in plain
    hinted = build_queries('Tim "Berners-Lee"', {"employer": "Inrupt", "city": "Boston", "keywords": ["web", "solid pods"]})
    assert hinted[0] == ("general", '"Tim Berners-Lee" Inrupt Boston web "solid pods"')
    assert hinted[-1] == ("plain", '"Tim Berners-Lee"') and len(hinted) <= 8


@pytest.mark.parametrize("url,expected", [
    ("https://github.com/timbl", ("github", "timbl")),
    ("https://uk.linkedin.com/in/tim-berners-lee", ("linkedin", "tim-berners-lee")),
    ("https://x.com/timberners_lee", ("twitter", "timberners_lee")),
    ("https://scholar.google.com/citations?user=AbC123&hl=en", ("googlescholar", "AbC123")),
    ("https://github.com/timbl/rdflib/issues", None),
    ("https://example.org/timbl", None),
])
def test_profile_urls_give_platform_and_handle(url, expected):
    assert profile_of(url) == expected


def test_classification():
    assert classify(_hit("https://github.com/timbl", "Tim"), "github") == "profile"
    assert classify(_hit("https://www.bbc.co.uk/news/technology-1", "x"), "general") == "news"
    assert classify(_hit("https://blog.example.org/2024/03/web", "x"), "general") == "news"
    assert classify(_hit("https://www.w3.org/People/Berners-Lee/", "x"), "general") == "mention"


async def test_web_found_classifies_and_filters(fake_search, run):
    provider = fake_search({
        "site:linkedin.com/in": [
            _hit("https://uk.linkedin.com/in/tim-berners-lee", "Tim Berners-Lee - Inrupt | LinkedIn",
                 "Experience: Inrupt · Education: University of Oxford · Location: Boston"),
            _hit("https://www.linkedin.com/in/alice-example", "Alice Example - Engineer | LinkedIn",
                 "Worked with Tim Berners-Lee on the web"),        # someone else's profile naming him
        ],
        "site:github.com": [_hit("https://github.com/timbl", "timbl (Tim Berners-Lee) · GitHub", "Director of W3C")],
        "news": [_hit("https://www.bbc.co.uk/news/technology-123", "Tim Berners-Lee warns about the web", "BBC")],
        '"Tim Berners-Lee"': [
            _hit("https://www.w3.org/People/Berners-Lee/", "Tim Berners-Lee", "Inventor of the World Wide Web"),
            _hit("https://www.spokeo.com/Tim-Berners-Lee", "Tim Berners-Lee - addresses, phones", "Tim Berners-Lee"),
            _hit("https://example.org/unrelated", "Gardening tips", "No names here"),
            _hit("ftp://example.org/x", "Tim Berners-Lee", ""),
        ],
    })
    rows = await run("person_web", "Tim Berners-Lee")
    assert len(provider.queries) == 7 and provider.queries[0] == '"Tim Berners-Lee"'
    by_url = {r["extra_metadata"]["url"]: r for r in rows}
    assert set(by_url) == {"https://uk.linkedin.com/in/tim-berners-lee", "https://github.com/timbl",
                           "https://www.bbc.co.uk/news/technology-123", "https://www.w3.org/People/Berners-Lee/"}
    li = _extra(by_url["https://uk.linkedin.com/in/tim-berners-lee"])
    assert li["linkedin"] == "tim-berners-lee" and li["result_kind"] == "profile"
    assert li["employer"] == "Inrupt" and li["education"] == "University of Oxford" and li["location"] == "Boston"
    gh = _extra(by_url["https://github.com/timbl"])
    assert gh["github"] == "timbl" and gh["fullname"] == "Tim Berners-Lee"
    assert _extra(by_url["https://www.bbc.co.uk/news/technology-123"])["result_kind"] == "news"
    w3 = by_url["https://www.w3.org/People/Berners-Lee/"]
    assert _extra(w3)["result_kind"] == "mention" and "bio" not in _extra(w3)
    assert w3["extra_metadata"]["search_provider"] == "fake"
    assert all(r["platform"] == "web" and r["status"] == "found" and _extra(r)["fullname"] for r in rows)
    assert not any("spokeo" in json.dumps(r) for r in rows)


async def test_web_hints_go_into_the_first_query(fake_search, run):
    provider = fake_search()
    assert await run("person_web", "Tim Berners-Lee", employer="Inrupt", city="Boston") == []
    assert provider.queries[0] == '"Tim Berners-Lee" Inrupt Boston' and provider.queries[-1] == '"Tim Berners-Lee"'


async def test_web_respects_the_budget(fake_search, run, monkeypatch):
    monkeypatch.setenv("SEARCH_MAX_QUERIES_PER_JOB", "2")
    provider = fake_search()
    await run("person_web", "Tim Berners-Lee")
    assert len(provider.queries) == 2


async def test_web_provider_errors_become_an_error_finding(fake_search, run):
    provider = fake_search(error=SearchError("SerpApi: Your account has run out of searches."))
    [err] = await run("person_web", "Tim Berners-Lee")
    assert err["status"] == "error" and "run out of searches" in err["extra_metadata"]["reason"]
    assert len(provider.queries) == 2                          # gives up early instead of burning time


def test_web_is_unavailable_without_a_provider(monkeypatch):
    monkeypatch.setattr(KeylessProvider, "available", classmethod(lambda cls: False))
    mod = modules.get_module("person_web")
    assert not mod.available()
    assert "person_web" not in {m.name for m in modules.modules_for("name")}
    monkeypatch.setenv("SERPAPI_KEY", "k")
    assert mod.available()


def test_plan_scan_copies_params_onto_every_job():
    from sherlock_core.jobs import plan_scan
    hints = {"city": "Boston", "keywords": ["web"]}
    rows = plan_scan("case-1", "name", "  Tim   Berners-Lee ", ["person_openalex", "person_orcid"], params=hints)
    assert [r["params"] for r in rows] == [hints, hints] and rows[0]["params"] is not hints
    assert all(r["target_value"] == "Tim Berners-Lee" for r in rows)
    assert plan_scan("case-1", "name", "Tim Berners-Lee", ["person_orcid"])[0]["params"] == {}
