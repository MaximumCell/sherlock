"""Profile-enrichment modules: one found path and one not-found path each, offline.

Fixtures `profile_<platform>.json` were recorded on 2026-11-19 from the public APIs
against organisational / well-known public accounts and trimmed to the fields the
modules read. `profile_npm.json` keeps the recorded shape with the person replaced.
"""
import httpx
import pytest
from sherlock_core.correlation import correlate
from sherlock_core.modules import all_modules
from sherlock_core.modules.profiles import as_url, join_links, strip_html

CONTRACT_KEYS = {
    "fullname", "bio", "location", "email", "links", "avatar_url", "created_at", "followers", "following",
    "twitter", "github", "reddit", "facebook", "karma",
}

# module -> (handle, request URL, status and body of "no such account", platform, profile URL, expected extra subset)
CASES = {
    "profile_gitlab": (
        "sytses", "https://gitlab.com/api/v4/users", (200, []), "gitlab", "https://gitlab.com/sytses",
        {"fullname": "Sid Sijbrandij"},
    ),
    "profile_keybase": (
        "chris", "https://keybase.io/_/api/1.0/user/lookup.json",
        (200, {"status": {"code": 0, "name": "OK"}, "them": [None]}), "keybase", "https://keybase.io/chris",
        {"fullname": "Chris Coyne", "location": "Maine", "twitter": "malgorithms", "github": "malgorithms",
         "reddit": "malgorithms", "created_at": "2014-02-06T02:18:28+00:00"},
    ),
    "profile_hackernews": (
        "patio11", "https://hacker-news.firebaseio.com/v0/user/patio11.json", (200, None), "hackernews",
        "https://news.ycombinator.com/user?id=patio11", {"created_at": "2008-11-17T08:42:42+00:00"},
    ),
    "profile_bluesky": (
        "bsky.app", "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile",
        (400, {"error": "InvalidRequest", "message": "Profile not found"}), "bluesky",
        "https://bsky.app/profile/bsky.app", {"fullname": "Bluesky", "created_at": "2023-04-12T04:53:57.057Z"},
    ),
    "profile_mastodon": (
        "Gargron", "https://mastodon.social/api/v1/accounts/lookup", (404, {"error": "Record not found"}),
        "mastodon", "https://mastodon.social/@Gargron",
        {"fullname": "Eugen Rochko", "links": "https://github.com/Gargron, https://eugenrochko.com"},
    ),
    "profile_devto": (
        "ben", "https://dev.to/api/users/by_username", (404, {"error": "not found", "status": 404}), "devto",
        "https://dev.to/ben",
        {"fullname": "Ben Halpern", "twitter": "bendhalpern", "github": "benhalpern", "location": "NY",
         "links": "http://benhalpern.com", "created_at": "2015-12-27"},
    ),
    "profile_lichess": (
        "thibault", "https://lichess.org/api/user/thibault", (404, {"error": "Not found"}), "lichess",
        "https://lichess.org/@/thibault",
        {"fullname": "Thibault Duplessis",
         "links": "https://github.com/ornicar, https://mas.to/@thibault, https://www.twitch.tv/ornicar2"},
    ),
    "profile_chesscom": (
        "Hikaru", "https://api.chess.com/pub/player/hikaru", (404, {"code": 0, "message": "not found"}),
        "chess.com", "https://www.chess.com/member/Hikaru",
        {"fullname": "Hikaru Nakamura", "location": "Florida", "links": "https://twitch.tv/gmhikaru",
         "created_at": "2014-01-06T21:20:58+00:00"},
    ),
    "profile_codeberg": (
        "forgejo", "https://codeberg.org/api/v1/users/forgejo", (404, {"message": "user does not exist"}),
        "codeberg", "https://codeberg.org/forgejo",
        {"fullname": "Forgejo", "bio": "Beyond coding. We forge.", "links": "https://forgejo.org"},
    ),
    "profile_npm": (
        "exampleuser", "https://registry.npmjs.org/-/v1/search", (200, {"objects": [], "total": 0}), "npm",
        "https://www.npmjs.com/~exampleuser", {"email": "exampleuser@example.net"},
    ),
    "profile_dockerhub": (
        "nginx", "https://hub.docker.com/v2/users/nginx/", (404, {"message": "User not found"}), "dockerhub",
        "https://hub.docker.com/u/nginx",
        {"fullname": "NGINX Inc.", "location": "San Francisco", "links": "https://www.nginx.com/"},
    ),
    "profile_huggingface": (
        "julien-c", "https://huggingface.co/api/users/julien-c/overview",
        (404, {"error": "This user does not exist"}), "huggingface", "https://huggingface.co/julien-c",
        {"fullname": "Julien Chaumond"},
    ),
    "profile_codeforces": (
        "tourist", "https://codeforces.com/api/user.info", (400, {"status": "FAILED", "comment": "not found"}),
        "codeforces", "https://codeforces.com/profile/tourist",
        {"fullname": "Gennady Korotkevich", "location": "Gomel, Belarus"},
    ),
}


def test_every_profile_module_has_a_case():
    mods = {m.name: m for m in all_modules() if m.name.startswith("profile_")}
    assert set(mods) == set(CASES)
    for m in mods.values():
        assert m.inputs == ("username",) and m.queue == "identity" and m.available()


@pytest.mark.parametrize("module", sorted(CASES))
async def test_profile_found(module, respx_mock, run, fx):
    handle, api, _missing, platform, url, expected = CASES[module]
    route = respx_mock.get(api).respond(json=fx(module))
    (row,) = await run(module, "username", handle)
    assert route.call_count == 1
    assert (row["status"], row["platform"], row["module"]) == ("found", platform, module)
    assert row["identifier_value"] == handle
    assert row["extra_metadata"]["url"] == url
    extra = row["extra_metadata"]["extra"]
    assert expected.items() <= extra.items()
    assert set(extra) <= CONTRACT_KEYS                      # nothing beyond the public profile fields
    assert all("<" not in str(v) for v in extra.values())   # no HTML left in any field


@pytest.mark.parametrize("module", sorted(CASES))
async def test_profile_not_found(module, respx_mock, run):
    handle, api, (status, body), *_ = CASES[module]
    respx_mock.get(api).respond(status, json=body)
    assert await run(module, "username", handle) == []


@pytest.mark.parametrize("status", [403, 429])
async def test_profile_blocked_is_an_error_row(status, respx_mock, run, meta):
    respx_mock.get("https://lichess.org/api/user/thibault").respond(status)
    (row,) = await run("profile_lichess", "username", "thibault")
    assert (row["status"], row["platform"]) == ("error", "lichess")
    assert str(status) in meta(row)["reason"]


async def test_profile_request_details(respx_mock, run, fx):
    bsky = respx_mock.get("https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile").respond(json=fx("profile_bluesky"))
    await run("profile_bluesky", "username", "@Bsky")
    assert bsky.calls.last.request.url.params["actor"] == "bsky.bsky.social"   # no dot -> default domain
    npm = respx_mock.get("https://registry.npmjs.org/-/v1/search").respond(json=fx("profile_npm"))
    assert await run("profile_npm", "username", "example") == []                # search hit, other maintainer
    assert npm.calls.last.request.url.params["text"] == "maintainer:example"
    assert await run("profile_npm", "username", "not a handle") == []           # never sent upstream
    assert npm.call_count == 1


async def test_profile_server_error_raises(respx_mock, run):
    respx_mock.get("https://codeberg.org/api/v1/users/forgejo").respond(502)
    with pytest.raises(httpx.HTTPStatusError):
        await run("profile_codeberg", "username", "forgejo")


def test_text_helpers():
    assert strip_html("<p>Hi &amp; bye<br>x: https:&#x2F;&#x2F;a.example</p><p>two</p>") == (
        "Hi & bye\nx: https://a.example\ntwo"
    )
    assert as_url("github.com/ornicar") == "https://github.com/ornicar"
    assert as_url("not a url") == "" and as_url("user@example.com") == "" and as_url("ftp://x.example") == ""
    assert join_links("a.example", None, "https://a.example", "b.example/x") == "https://a.example, https://b.example/x"


# ------------------------------------------------------------------ the point of it all
async def test_profiles_give_the_correlation_engine_something_to_link(respx_mock, run, fx):
    """Three accounts under three different handles, linked only by what the profiles say."""
    respx_mock.get("https://keybase.io/_/api/1.0/user/lookup.json").respond(json=fx("profile_keybase"))
    respx_mock.get("https://dev.to/api/users/by_username").respond(json=fx("profile_devto"))
    respx_mock.get("https://mastodon.social/api/v1/accounts/lookup").respond(json=fx("profile_mastodon"))
    respx_mock.get("https://codeberg.org/api/v1/users/eugen").respond(json={
        **fx("profile_codeberg"), "login": "eugen", "full_name": "Eugen Rochko", "website": "eugenrochko.com/",
        "html_url": "https://codeberg.org/eugen",
    })
    rows = [
        *await run("profile_keybase", "username", "chris"),
        *await run("profile_devto", "username", "ben"),
        *await run("profile_mastodon", "username", "Gargron"),
        *await run("profile_codeberg", "username", "eugen"),
    ]
    # the accounts the profiles point at, as an existence checker reports them (no profile data)
    for platform, handle in (("GitHub", "malgorithms"), ("X", "bendhalpern"), ("Reddit", "malgorithms")):
        rows.append({
            "identifier_type": "username", "identifier_value": handle, "source_tool": "whatsmyname",
            "module": "whatsmyname", "platform": platform, "status": "found",
            "finding_key": f"wmn-{platform}-{handle}", "extra_metadata": {"url": None, "extra": {}},
        })
    for i, row in enumerate(rows):
        row["id"] = f"f{i}"
    by_id = {r["id"]: r["platform"] for r in rows}

    assert correlate("case-1", [r for r in rows if r["source_tool"] == "whatsmyname"]) == []   # the old result
    corrs = correlate("case-1", rows)
    got = {(c["type"], c["matched_value"]): {by_id[i] for i in c["entities_involved"]} for c in corrs}
    assert got[("shared_external_handle", "malgorithms@github")] == {"keybase", "GitHub"}     # Keybase proof
    assert got[("shared_external_handle", "malgorithms@reddit")] == {"keybase", "Reddit"}
    assert got[("shared_external_handle", "bendhalpern@twitter")] == {"devto", "X"}           # dev.to field
    assert got[("shared_url", "eugenrochko.com")] == {"mastodon", "codeberg"}                 # profile links
    assert got[("shared_display_name", "Eugen Rochko")] == {"mastodon", "codeberg"}
