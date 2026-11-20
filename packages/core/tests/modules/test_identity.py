"""Identity-queue modules: happy path + empty / error path each, offline."""
import json

import httpx
import pytest
from sherlock_core.modules import Target, get_module
from sherlock_core.modules.activity_fingerprint import estimate_utc_offset, histogram

GH = "https://api.github.com"
HUDSON = "https://cavalier.hudsonrock.com/api/json/v2/osint-tools"


# ------------------------------------------------------------------ user_scanner
def test_user_scanner_username_sweep_is_opt_in():
    """~2,500 sites cannot finish on a 0.1-CPU host, so usernames are off unless enabled."""
    pytest.importorskip("user_scanner")
    import sherlock_core.modules.user_scanner as mod

    assert mod._USERNAME_SWEEP is False
    assert mod.UserScanner.inputs == ("email",)


async def test_user_scanner_maps_library_results(monkeypatch, run, meta):
    pytest.importorskip("user_scanner")
    import sherlock_core.modules.user_scanner as mod
    from user_scanner.core.result import Result, Status

    async def fake_check_all(target, is_email=True, configs=None):
        assert (target, is_email) == ("exampleuser", False)
        return [
            Result(Status.TAKEN, site_name="GitHub", category="dev", url="https://github.com/exampleuser",
                   extra={"followers": 3}, media={"avatar": "https://example.com/a.png"}),
            Result(Status.AVAILABLE, site_name="GitLab", category="dev", url="https://gitlab.com/exampleuser"),
            Result(Status.ERROR, "timeout", site_name="Reddit", category="social"),
            Result(Status.SKIPPED, site_name="Skipped", category="social"),
        ]

    monkeypatch.setattr(mod, "check_all", fake_check_all)
    # the username sweep is opt-in (USER_SCANNER_USERNAMES=1); switch it on for this test
    monkeypatch.setattr(mod.UserScanner, "inputs", ("username", "email"))
    rows = await run("user_scanner", "username", "exampleuser", include_all=True)
    assert [(r["platform"], r["status"]) for r in rows] == [
        ("GitHub", "found"), ("GitLab", "not_found"), ("Reddit", "error"),
    ]
    compact = await run("user_scanner", "username", "exampleuser")
    assert [(r["platform"], r["status"]) for r in compact] == [("GitHub", "found"), ("user-scanner", "found")]
    assert meta(compact[1]) == {"summary": True, "checked": 3, "found": 1, "not_found": 1, "errors": 1}
    gh = rows[0]
    assert gh["source_tool"] == "user-scanner" and gh["module"] == "user_scanner"
    assert gh["extra_metadata"]["url"] == "https://github.com/exampleuser"
    assert gh["extra_metadata"]["extra"] == {"followers": 3, "avatar_url": "https://example.com/a.png"}
    assert meta(rows[2])["reason"] == "timeout"


async def test_user_scanner_nothing_returned(monkeypatch, run):
    pytest.importorskip("user_scanner")
    import sherlock_core.modules.user_scanner as mod

    async def none(target, is_email=True, configs=None):
        assert is_email is True
        return []

    monkeypatch.setattr(mod, "check_all", none)
    assert await run("user_scanner", "email", "user@example.com") == []


# ------------------------------------------------------------------ hudson_rock
async def test_hudson_rock_metadata_only(respx_mock, run, fx, meta):
    route = respx_mock.get(f"{HUDSON}/search-by-email").respond(json=fx("hudson_rock"))
    rows = await run("hudson_rock", "email", "user@example.com")
    assert route.calls.last.request.url.params["email"] == "user@example.com"
    assert len(rows) == 3
    assert {r["platform"] for r in rows} == {"hudson-rock"}
    assert len({r["finding_key"] for r in rows}) == 3  # two machines share a date, still separate rows
    first = meta(rows[0])
    assert first["stealer_family"] == "Lumma" and first["date_compromised"] == "2024-08-24T15:29:20.000Z"
    blob = json.dumps(rows)
    for leaked in ("top_passwords", "top_logins", "E********1", "computer_name", "EXAMPLE-PC", "203.0."):
        assert leaked not in blob


async def test_hudson_rock_clean_and_rate_limited(respx_mock, run, meta):
    respx_mock.get(f"{HUDSON}/search-by-username").mock(side_effect=[
        httpx.Response(200, json={"message": "not associated", "stealers": []}),
        httpx.Response(429, headers={"retry-after": "30"}),
    ])
    assert await run("hudson_rock", "username", "exampleuser") == []
    (err,) = await run("hudson_rock", "username", "exampleuser")
    assert err["status"] == "error" and "429" in meta(err)["reason"]


# ------------------------------------------------------------------ gravatar
async def test_gravatar_profile(respx_mock, run, fx):
    respx_mock.get("https://en.gravatar.com/b58996c504c5638798eb6b511e6f49af.json").respond(json=fx("gravatar"))
    (row,) = await run("gravatar", "email", " User@Example.com ")
    extra = row["extra_metadata"]["extra"]
    assert row["platform"] == "gravatar" and row["extra_metadata"]["url"] == "https://gravatar.com/exampleuser"
    assert extra["fullname"] == "Example User" and extra["location"] == "Springfield"
    assert extra["bio"] == "Builds example things." and extra["username"] == "exampleuser"
    assert extra["avatar_url"].startswith("https://0.gravatar.com/avatar/")
    assert extra["links"] == "https://x.com/exampleuser, https://github.com/exampleuser, https://example.com/blog"
    assert extra["emails"] == "user@example.com"


async def test_gravatar_unknown_email(respx_mock, run):
    # an unknown hash answers 200 with an empty body (recorded behaviour); 404 is handled too
    respx_mock.get(url__startswith="https://en.gravatar.com/").mock(side_effect=[
        httpx.Response(200, content=b"", headers={"content-type": "text/html"}),
        httpx.Response(404, json={"error": "User not found"}),
    ])
    assert await run("gravatar", "email", "nobody@example.com") == []
    assert await run("gravatar", "email", "nobody@example.com") == []


# ------------------------------------------------------------------ xposedornot
async def test_xposedornot_breach_names(respx_mock, run, fx, meta):
    respx_mock.get("https://api.xposedornot.com/v1/check-email/test@example.com").respond(json=fx("xposedornot_found"))
    rows = await run("xposedornot", "email", "test@example.com")
    assert [meta(r)["breach_name"] for r in rows] == ["Adobe", "LinkedIn"]
    assert all(r["platform"] == "breach" and r["status"] == "found" for r in rows)
    assert rows[0]["finding_key"] != rows[1]["finding_key"]
    assert set(meta(rows[0])) == {"breach_name", "breach_date", "data_classes"}


async def test_xposedornot_not_found_and_bot_wall(respx_mock, run, meta):
    respx_mock.get(url__startswith="https://api.xposedornot.com/v1/check-email/").mock(side_effect=[
        httpx.Response(404, json={"Error": "Not found"}),
        httpx.Response(403, html="<title>Just a moment...</title>"),
        httpx.Response(429, headers={"retry-after": "5"}, json={"message": "slow down"}),
    ])
    assert await run("xposedornot", "email", "nobody@example.com") == []
    for expected in ("403", "429"):
        (err,) = await run("xposedornot", "email", "nobody@example.com")
        assert err["status"] == "error" and expected in meta(err)["reason"]


# ------------------------------------------------------------------ leakcheck_public
async def test_leakcheck_sources(respx_mock, run, fx, meta):
    route = respx_mock.get("https://leakcheck.io/api/public").respond(json=fx("leakcheck_found"))
    rows = await run("leakcheck_public", "email", "test@example.com")
    assert route.calls.last.request.url.params["check"] == "test@example.com"
    summary, breaches = rows[0], rows[1:]
    assert summary["platform"] == "leakcheck" and meta(summary)["breach_count"] == 5
    assert "password" in meta(summary)["exposed_fields"]  # a field *name*, never a value
    assert [meta(b)["breach_name"] for b in breaches][:2] == ["Wishbone.io", "saveonlens.com"]
    assert meta(breaches[0])["breach_date"] == "2020-01" and meta(breaches[1])["breach_date"] is None
    assert all(b["platform"] == "breach" for b in breaches)
    assert len({b["finding_key"] for b in breaches}) == 5


async def test_leakcheck_not_found_and_limited(respx_mock, run, fx, meta):
    respx_mock.get("https://leakcheck.io/api/public").mock(side_effect=[
        httpx.Response(200, json=fx("leakcheck_not_found")),
        httpx.Response(429, json={"success": False, "error": "Too many requests"}),
    ])
    assert await run("leakcheck_public", "username", "exampleuser") == []
    (err,) = await run("leakcheck_public", "username", "exampleuser")
    assert err["status"] == "error" and "429" in meta(err)["reason"]


# ------------------------------------------------------------------ github
async def test_github_profile_and_commit_email(respx_mock, run, fx, meta, monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    user = fx("github_user") | {"blog": "example.org/linus", "twitter_username": "example_tw"}
    respx_mock.get(f"{GH}/users/torvalds").respond(json=user)
    respx_mock.get(f"{GH}/users/torvalds/events/public").respond(json=fx("github_events"))
    commit = respx_mock.get(url__startswith=f"{GH}/repos/torvalds/linux/commits/").respond(json=fx("github_commit"))
    (row,) = await run("github", "username", "torvalds")
    extra = row["extra_metadata"]["extra"]
    assert row["platform"] == "github" and row["extra_metadata"]["url"] == "https://github.com/torvalds"
    assert extra["fullname"] == "Linus Torvalds" and extra["location"] == "Portland, OR"
    assert extra["company"] == "Linux Foundation" and extra["created_at"] == "2011-09-03T15:26:22Z"
    assert extra["twitter"] == "example_tw" and extra["links"] == "https://example.org/linus"
    assert isinstance(extra["followers"], int) and extra["avatar_url"].startswith("https://avatars.")
    assert extra["email"] == "torvalds@linux-foundation.org"
    assert meta(row)["commit_emails"] == ["torvalds@linux-foundation.org"]
    assert commit.call_count == 1  # one head commit per distinct repository
    assert "authorization" not in commit.calls.last.request.headers


async def test_github_skips_noreply_and_other_authors(respx_mock, run, fx, meta):
    respx_mock.get(f"{GH}/users/torvalds").respond(json=fx("github_user"))
    respx_mock.get(f"{GH}/users/torvalds/events/public").respond(json=fx("github_events"))
    commit = fx("github_commit")
    commit["commit"]["author"]["email"] = "1024025+torvalds@users.noreply.github.com"
    respx_mock.get(url__startswith=f"{GH}/repos/torvalds/linux/commits/").respond(json=commit)
    (row,) = await run("github", "username", "torvalds")
    assert "email" not in row["extra_metadata"]["extra"] and "commit_emails" not in meta(row)


async def test_github_unknown_user_and_rate_limit(respx_mock, run, meta):
    respx_mock.get(f"{GH}/users/nobody-zzq").respond(404, json={"message": "Not Found"})
    assert await run("github", "username", "nobody-zzq") == []
    respx_mock.get(f"{GH}/users/limited").respond(
        403, headers={"x-ratelimit-remaining": "0"}, json={"message": "API rate limit exceeded for 203.0.113.1."},
    )
    (err,) = await run("github", "username", "limited")
    assert err["status"] == "error" and "rate limit" in meta(err)["reason"]


async def test_github_token_is_sent_and_rate_limited_extras_keep_profile(respx_mock, run, fx, meta, monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    profile = respx_mock.get(f"{GH}/users/torvalds").respond(json=fx("github_user"))
    respx_mock.get(f"{GH}/users/torvalds/events/public").respond(
        429, json={"message": "You have exceeded a secondary rate limit."},
    )
    (row,) = await run("github", "username", "torvalds")
    assert profile.calls.last.request.headers["authorization"] == "Bearer test-token"
    assert row["status"] == "found" and "rate limit" in meta(row)["partial"]


async def test_github_email_lookup(respx_mock, run, fx, meta):
    users = respx_mock.get(f"{GH}/search/users").respond(json=fx("github_search_users"))
    commits = respx_mock.get(f"{GH}/search/commits").respond(json=fx("github_search_commits"))
    rows = await run("github", "email", "Torvalds@linux-foundation.org")
    assert users.calls.last.request.url.params["q"] == "torvalds@linux-foundation.org in:email"
    assert commits.calls.last.request.url.params["q"] == "author-email:torvalds@linux-foundation.org"
    by_login = {r["extra_metadata"]["extra"]["username"]: r for r in rows}
    assert set(by_login) == {"libJNI", "torvalds"}
    assert meta(by_login["torvalds"])["matched_by"] == "commit author email"
    assert meta(by_login["libJNI"])["matched_by"] == "public profile email"
    assert by_login["torvalds"]["extra_metadata"]["url"] == "https://github.com/torvalds"
    assert "fullname" not in by_login["torvalds"]["extra_metadata"]["extra"]  # commit names are spoofable
    assert len({r["finding_key"] for r in rows}) == 2


async def test_github_email_no_match(respx_mock, run):
    empty = {"total_count": 0, "incomplete_results": False, "items": []}
    respx_mock.get(f"{GH}/search/users").respond(json=empty)
    respx_mock.get(f"{GH}/search/commits").respond(json=empty)
    assert await run("github", "email", "nobody@example.com") == []


# ------------------------------------------------------------------ activity_fingerprint
def _mock_activity(respx_mock, fx, *, hn=None, gh=None, se_users=None, se_posts=None):
    respx_mock.get("https://hn.algolia.com/api/v1/search_by_date").respond(json=hn or {"hits": []})
    respx_mock.get(url__regex=rf"{GH}/users/[^/]+/events/public.*").respond(json=gh if gh is not None else [])
    respx_mock.get("https://api.stackexchange.com/2.3/users").respond(json=se_users or {"items": []})
    if se_posts is not None:
        respx_mock.get(url__regex=r"https://api\.stackexchange\.com/2\.3/users/\d+/posts.*").respond(json=se_posts)


async def test_activity_fingerprint_per_platform_and_combined(respx_mock, run, fx, meta, monkeypatch):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    _mock_activity(
        respx_mock, fx, hn=fx("hn_search"), gh=fx("github_events"),
        se_users=fx("stackexchange_users"), se_posts=fx("stackexchange_posts"),
    )
    rows = await run("activity_fingerprint", "username", "TorvaldsDB")
    by_platform = {r["platform"]: r for r in rows}
    assert set(by_platform) == {"hackernews", "github", "stackoverflow", "activity"}
    for name, size in (("hackernews", 3), ("github", 5), ("stackoverflow", 3)):
        act = meta(by_platform[name])["activity"]
        assert act["sample_size"] == size == sum(act["hours_utc"]) == sum(act["weekdays"])
        assert len(act["hours_utc"]) == 24 and len(act["weekdays"]) == 7
        assert act["first"] <= act["last"]
    assert meta(by_platform["hackernews"])["activity"]["last"] == "2024-03-11T12:57:11+00:00"
    assert "identity_match" in meta(by_platform["stackoverflow"])
    combined = meta(by_platform["activity"])
    assert combined["sources"] == ["hackernews", "github"]  # display-name matches are not pooled
    assert combined["activity"]["sample_size"] == 8
    assert combined["confidence"] == "low"  # fewer than 30 samples
    assert -12 <= combined["utc_offset_estimate"] <= 12
    assert "comment_text" not in json.dumps(rows) and "story_title" not in json.dumps(rows)


async def test_activity_fingerprint_no_activity_and_all_sources_down(respx_mock, run, fx, meta):
    _mock_activity(respx_mock, fx)
    assert await run("activity_fingerprint", "username", "nobody-zzq") == []
    respx_mock.reset()
    respx_mock.get("https://hn.algolia.com/api/v1/search_by_date").respond(503)
    respx_mock.get(url__regex=rf"{GH}/users/[^/]+/events/public.*").respond(
        403, headers={"x-ratelimit-remaining": "0"}, json={"message": "API rate limit exceeded"},
    )
    respx_mock.get("https://api.stackexchange.com/2.3/users").respond(400, json={"error_name": "throttle_violation"})
    (err,) = await run("activity_fingerprint", "username", "nobody-zzq")
    assert err["status"] == "error" and err["platform"] == "activity"
    assert "hackernews" in meta(err)["reason"]


def test_utc_offset_estimate_from_quiet_window():
    # active 14:00-05:59 UTC, silent 06:00-13:59 UTC -> quiet centre ~10:00 UTC = 04:00 local -> UTC-6
    hours = [10] * 6 + [0] * 8 + [10] * 10
    est = estimate_utc_offset(hours)
    assert est["utc_offset_estimate"] in (-7, -6, -5) and est["confidence"] == "medium"
    assert estimate_utc_offset([1] * 24)["confidence"] == "low"       # flat: no quiet window
    assert estimate_utc_offset([0] * 24)["utc_offset_estimate"] is None
    assert histogram([])["sample_size"] == 0


# ------------------------------------------------------------------ phone_meta
async def test_phone_meta_valid_number(run, meta):
    pytest.importorskip("phonenumbers")
    (row,) = await run("phone_meta", "phone", "+44 20 7183 8750")
    m = meta(row)
    assert row["status"] == "found" and row["platform"] == "phone"
    assert row["extra_metadata"]["extra"] == {"phone": "+442071838750"}
    assert m["valid"] is True and m["region"] == "GB" and m["line_type"] == "fixed_line"
    assert m["timezones"] == ["Europe/London"] and m["country_code"] == 44
    # metadata of the number only: nothing that names a subscriber
    assert not {"owner", "name", "fullname", "subscriber"} & (set(m) | set(row["extra_metadata"]["extra"]))


async def test_phone_meta_invalid_and_unparsable(run, meta):
    pytest.importorskip("phonenumbers")
    (invalid,) = await run("phone_meta", "phone", "+1 555 0100")
    assert invalid["status"] == "not_found" and meta(invalid)["valid"] is False
    (err,) = await run("phone_meta", "phone", "not a number")
    assert err["status"] == "error" and "parsable" in meta(err)["reason"]
    national = await get_module("phone_meta").run(
        Target("phone", "020 7183 8750", {"region": "GB"}), _ctx_for(invalid),
    )
    assert national[0]["extra_metadata"]["extra"]["phone"] == "+442071838750"


def _ctx_for(finding):
    from sherlock_core.modules import ModuleContext

    return ModuleContext(case_id=finding["case_id"], http=None)  # phone_meta never touches the network
