"""Three-state outcomes: unknown rows, rule health classification, preview downgrades (offline)."""
import copy
from pathlib import Path

import httpx
import pytest
from sherlock_core.correlation import correlate, group_accounts, summarize
from sherlock_core.data import rule_health as rh
from sherlock_core.models import make_finding
from sherlock_core.modules import preview as pv
from sherlock_core.scoring import score_exposure
from sherlock_core.walled import UNKNOWN_REASONS, WALLED, is_unknown, reason_from_text, unknown_meta

PAGES = Path(__file__).parent / "modules" / "fixtures" / "previews"


def row(platform, status="found", url=None, module="whatsmyname", meta=None, value="alice", **kw):
    return make_finding(case_id="c1", identifier_type="username", identifier_value=value, source_tool=module,
                        module=module, platform=platform, status=status,
                        url=url or f"https://{platform.lower()}.com/{value}", meta=meta,
                        extra={"username": value}, **kw)


def unknown_row(platform, reason="login_wall", **kw):
    return row(platform, status="error", meta=unknown_meta(reason, "why"), **kw)


# ----------------------------------------------------------------------------- the unknown shape
def test_unknown_rows_are_error_rows_with_a_reason():
    u = unknown_row("Instagram")
    assert u["status"] == "error" and is_unknown(u)
    assert u["extra_metadata"]["reason"] in UNKNOWN_REASONS and u["extra_metadata"]["unknown"] is True
    plain_error = row("GitHub", status="error", meta={"reason": "upstream returned HTTP 500"})
    assert not is_unknown(plain_error) and not is_unknown(row("GitHub")) and not is_unknown(row("x", "not_found"))
    assert not is_unknown(row("whatsmyname", status="error", meta={"summary": True, "reason": "blocked"}))
    with pytest.raises(ValueError):
        unknown_meta("nope")


@pytest.mark.parametrize(("text", "reason"), [
    ("HTTP 429 Too Many Requests", "rate_limited"), ("Rate limit / Cloudflare protection block", "rate_limited"),
    ("redirected to login", "login_wall"), ("Availability check gave no verdict", "ambiguous"),
    ("No public account (a private one looks the same)", "ambiguous"), ("Connection reset by peer", "blocked"),
    (None, "blocked"),
])
def test_reason_from_library_text(text, reason):
    assert reason_from_text(text) == reason


def test_walled_registry_holds_only_verified_platforms():
    assert set(WALLED) == {"instagram", "facebook", "threads"}   # TikTok / LinkedIn / Snapchat told apart
    for info in WALLED.values():
        assert "{account}" in info["url"] and info["note"]


# ----------------------------------------------------------------------------- counts ignore unknown
def test_summary_counts_unknown_separately_and_accounts_use_found_only():
    rows = [row("GitHub"), row("GitLab", "not_found"), unknown_row("Instagram"), unknown_row("Facebook"),
            row("Reddit", status="error", meta={"reason": "HTTP 500"})]
    for i, r in enumerate(rows):
        r["id"] = f"f{i}"
    stats = summarize(rows)
    assert (stats["found"], stats["not_found"], stats["error"], stats["unknown"]) == (1, 1, 3, 2)
    assert stats["by_source"]["whatsmyname"]["unknown"] == 2
    assert stats["account_count"] == 1 and stats["platforms_found"] == 1
    assert [a.platform for a in group_accounts(rows)] == ["github"]
    assert all(set(c["entities_involved"]) <= {"f0"} for c in correlate("c1", rows))


def test_scoring_ignores_unknown_rows():
    base = [row("GitHub")]
    base[0]["id"] = "f0"
    more = base + [unknown_row("Instagram"), unknown_row("Threads")]
    for i, r in enumerate(more[1:], 1):
        r["id"] = f"f{i}"
    assert score_exposure(more, [])["score"] == score_exposure(base, [])["score"]


# ----------------------------------------------------------------------------- rule health classification
@pytest.mark.parametrize(("known", "random", "status"), [
    (["found", "found"], "not_found", "ok"),
    (["not_found", "found"], "not_found", "ok"),                  # one known account is enough
    (["not_found", "not_found"], "unknown", "false_negative"),
    (["unknown"], "not_found", "false_negative"),
    (["found"], "found", "indistinguishable"),
    (["not_found"], "not_found", "indistinguishable"),           # the Instagram login shell
    (["unknown", "unknown"], "unknown", "indistinguishable"),
    (["not_found"], "found", "false_positive"),
    (["error", "error"], "not_found", "error"),
    (["found"], "error", "error"),
    ([], "not_found", "error"),
])
def test_classify_rule(known, random, status):
    assert rh.classify_rule(known, random)[0] == status


SITE = {"name": "Alpha", "uri_check": "https://alpha.example/u/{account}", "e_code": 200, "e_string": "profile",
        "m_code": 404, "m_string": "Not Found", "known": ["realone", "realtwo"], "cat": "social"}


@pytest.mark.parametrize(("known_answer", "random_answer", "status"), [
    ((200, "profile"), (404, "Not Found"), "ok"),
    ((404, "Not Found"), (404, "Not Found"), "indistinguishable"),
    ((200, "profile"), (200, "profile"), "indistinguishable"),
    ((403, "Just a moment"), (404, "Not Found"), "false_negative"),
    ((404, "Not Found"), (200, "profile"), "false_positive"),
    (None, None, "error"),
])
async def test_check_rule_with_fake_responses(respx_mock, known_answer, random_answer, status):
    for name in ("realone", "realtwo"):
        route = respx_mock.get(f"https://alpha.example/u/{name}")
        route.mock(side_effect=httpx.ConnectError("x")) if known_answer is None else route.respond(known_answer[0], text=known_answer[1])
    rnd = respx_mock.get("https://alpha.example/u/zqmadeup0000")
    rnd.mock(side_effect=httpx.ConnectError("x")) if random_answer is None else rnd.respond(random_answer[0], text=random_answer[1])
    async with httpx.AsyncClient() as http:
        entry = await rh.check_rule(SITE, http, rand="zqmadeup0000")
    assert entry["status"] == status and entry["checked_at"] and entry["detail"]


async def test_run_and_write_health_file(respx_mock, tmp_path, monkeypatch):
    monkeypatch.setattr(rh, "load_sites", lambda: (SITE, {**SITE, "name": "Beta", "known": []}))
    monkeypatch.setattr(rh, "random_name", lambda: "zqmadeup0000")
    respx_mock.get(url__regex=r"https://alpha\.example/u/real.*").respond(200, text="profile")
    respx_mock.get("https://alpha.example/u/zqmadeup0000").respond(404, text="Not Found")
    async with httpx.AsyncClient() as http:
        results = await rh.run(concurrency=2, http=http)
    assert {k: v["status"] for k, v in results.items()} == {"Alpha": "ok", "Beta": "error"}
    doc = rh.write(results, "test connection", tmp_path / "h.json")
    assert doc["meta"]["counts"]["ok"] == 1 and doc["meta"]["connection"] == "test connection"
    assert (tmp_path / "h.json").read_text().startswith("{")


def test_random_names_look_made_up():
    a, b = rh.random_name(), rh.random_name()
    assert a != b and a.startswith("zq") and len(a) == 14


# ----------------------------------------------------------------------------- preview downgrade
def html(name, status=200):
    return httpx.Response(status, text=(PAGES / f"{name}.html").read_text(encoding="utf-8"),
                          headers={"content-type": "text/html; charset=utf-8"})


async def test_sweep_hits_on_walls_and_landing_pages_become_unknown(respx_mock):
    # login redirect (recorded Replit wall), redirect to the site's home page, a "Client Challenge" page
    respx_mock.get("https://replit.com/@alice").respond(302, headers={"location": "/login?goto=%2F%40alice"})
    respx_mock.get("https://replit.com/login").mock(return_value=html("replit"))
    respx_mock.get("https://forum.example.org/u/alice").respond(302, headers={"location": "https://forum.example.org/"})
    respx_mock.get("https://forum.example.org/").respond(
        200, text="<title>Forum</title><meta property='og:title' content='Welcome to Forum'>",
        headers={"content-type": "text/html"})
    respx_mock.get("https://www.last.fm/user/alice").mock(return_value=html("lastfm"))
    respx_mock.get("https://dev.to/alice").mock(return_value=html("devto"))
    rows = [
        row("Replit", url="https://replit.com/@alice"),
        row("Forum", url="https://forum.example.org/u/alice", module="user_scanner"),
        row("Last.fm", url="https://www.last.fm/user/alice"),
        row("DEV Community", url="https://dev.to/alice", module="profiles"),   # not a sweep: never downgraded
    ]
    before = copy.deepcopy(rows)
    async with httpx.AsyncClient() as http:
        out = await pv.enrich_previews(rows, http)
    assert rows == before
    down = {r["platform"]: r for r in out if r["status"] == "error"}
    assert set(down) == {"Replit", "Forum", "Last.fm"}
    for r in down.values():
        meta = r["extra_metadata"]
        assert is_unknown(r) and meta["reason"] == "ambiguous" and meta["was"] == "found"
        assert meta["detail"].startswith("profile page check:")
    assert down["Replit"]["finding_key"] == rows[0]["finding_key"]        # replaces the found row on upsert


async def test_walled_platforms_and_plain_failures_are_not_downgraded(respx_mock):
    shell = (Path(__file__).parent / "modules" / "fixtures" / "walled" / "instagram_shell.html").read_text()
    respx_mock.get("https://www.instagram.com/alice/").respond(200, text=shell, headers={"content-type": "text/html"})
    respx_mock.get("https://site.example/alice").respond(403, text="nope", headers={"content-type": "text/html"})
    rows = [row("Instagram", url="https://www.instagram.com/alice/", module="user_scanner"),
            row("Site", url="https://site.example/alice")]
    async with httpx.AsyncClient() as http:
        assert await pv.enrich_previews(rows, http) == []


def test_needs_downgrade_reasons():
    hit = row("Forum", url="https://forum.example.org/u/alice")
    assert pv.needs_downgrade(hit, "redirected away from the profile")
    assert pv.needs_downgrade(hit, "wall / error page: 'Log in'")
    assert not pv.needs_downgrade(hit, "HTTP 403") and not pv.needs_downgrade(hit, "nothing personal on the page")
    assert not pv.needs_downgrade(row("Instagram"), "redirected to a login / consent page")
