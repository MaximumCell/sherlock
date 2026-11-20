"""Profile previews (`modules/preview.py`) against trimmed REAL responses recorded 2026-11-20.

Offline: every request is answered by respx from `fixtures/previews/*.html`.
"""
import asyncio
import copy
from pathlib import Path

import httpx
import pytest
from sherlock_core.models import make_finding
from sherlock_core.modules import preview as pv

PAGES = Path(__file__).parent / "fixtures" / "previews"


def page(name: str) -> str:
    return (PAGES / f"{name}.html").read_text(encoding="utf-8")


def html_response(name: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, text=page(name), headers={"content-type": "text/html; charset=utf-8"})


def account(platform: str, url: str, handle: str, extra: dict | None = None, **kw) -> dict:
    return make_finding(case_id="c1", identifier_type="username", identifier_value=handle,
                        source_tool="whatsmyname", platform=platform, url=url,
                        extra={"username": handle, **(extra or {})}, **kw)


# ----------------------------------------------------------------------------- real pages: usable previews
OK = [
    # fixture, requested url, handle, hops after the first, fullname, has picture
    ("instagram", "https://www.instagram.com/nasa/", "nasa", [], "NASA", True),
    ("twitter", "https://x.com/NASA", "NASA", [], "NASA", True),
    ("facebook", "https://www.facebook.com/NASA", "NASA", [], "NASA", True),
    ("youtube", "https://www.youtube.com/@NASA", "NASA", [], "NASA", True),
    ("twitch", "https://www.twitch.tv/twitch", "twitch", [], "Twitch", True),
    ("soundcloud", "https://soundcloud.com/nasa", "nasa", [], "NASA", True),
    ("threads", "https://www.threads.net/@nasa", "nasa", ["https://www.threads.com/@nasa"], "NASA", True),
    ("medium", "https://medium.com/@netflixtechblog", "netflixtechblog", ["https://netflixtechblog.medium.com/"],
     "Netflix Technology Blog", True),
    ("snapchat", "https://www.snapchat.com/add/nasa", "nasa", ["https://www.snapchat.com/@nasa"], "NASA", True),
    ("steam", "https://steamcommunity.com/id/gabelogannewell", "gabelogannewell", [], "Rabscuttle", False),
    ("devto", "https://dev.to/ben", "ben", [], "Ben Halpern", True),
    ("mastodon", "https://mastodon.social/@Mastodon", "Mastodon", [], "Mastodon", True),
    ("goodreads", "https://www.goodreads.com/user/show/1-otis-chandler", "otis", [], "Otis Chandler", True),
    ("kaggle", "https://www.kaggle.com/jhoward", "jhoward", [], "Jeremy Howard", True),
    ("letterboxd", "https://letterboxd.com/dave/", "dave", [], "Dave Vis", True),
    ("github", "https://github.com/github", "github", [], "GitHub", True),
]


@pytest.mark.parametrize("fixture,url,handle,hops,name,picture", OK, ids=[o[0] for o in OK])
def test_real_profile_pages_give_a_preview(fixture, url, handle, hops, name, picture):
    chain = [url, *hops]
    fields, reason = pv.gate(pv.parse_page(page(fixture), chain[-1]), profile_url=url, handle=handle,
                             status=200, hops=chain)
    assert fields is not None, reason
    assert fields["fullname"] == name
    assert bool(fields.get("avatar_url")) is picture
    if picture:
        assert fields["avatar_url"].startswith("https://")
    assert len(fields.get("bio", "")) <= pv.BIO_MAX


def test_boilerplate_is_removed_from_bios():
    def bio(fixture, url, handle):
        fields, _ = pv.gate(pv.parse_page(page(fixture), url), profile_url=url, handle=handle, status=200, hops=[url])
        return fields.get("bio", "")

    assert bio("instagram", "https://www.instagram.com/nasa/", "nasa") == ""            # only follower counts
    assert bio("facebook", "https://www.facebook.com/NASA", "NASA").startswith("Explore the universe")
    assert bio("github", "https://github.com/github", "github") == "How people build software."
    assert bio("twitter", "https://x.com/NASA", "NASA") == "Making the seemingly impossible, possible. ✨"


@pytest.mark.parametrize("text,host,kept", [
    # seen on WhatsMyName sites in the 2026-11-20 smoke run
    ("AtCoder is a programming contest site for anyone from beginners to experts.", "atcoder.jp", False),
    ("Explore Lungle’s 63 photos on Flickr!", "flickr.com", False),
    ("Hey 👋 I just created a page here. You can now buy me a coffee!", "buymeacoffee.com", False),
    ("Create a free link in bio with Bio Sites by Square", "bio.site", False),
    ("View the profile of Na Sa on Codementor.", "codementor.io", False),
    ("NASA's AniList user profile", "anilist.co", False),
    # real bios stay, including a long one that mentions the site late
    ("Founding Researcher at fast.ai. Hon Professor at University of Queensland. Previously: Distinguished "
     "Research Scientist at University of San Francisco. President/Chief Scientist of Kaggle.", "kaggle.com", True),
    ("Making the seemingly impossible, possible. ✨", "x.com", True),
])
def test_site_text_is_not_a_bio(text, host, kept):
    assert bool(pv.clean_bio(text, pv._site_words(host, ""))) is kept


@pytest.mark.parametrize("title,host,expected", [
    ("Личный профиль Ivan", "championat.com", "Ivan"),
    ("smythe's collection | Bandcamp", "bandcamp.com", "smythe"),
    ("Na Sa's Developer Profile | Codementor", "codementor.io", "Na Sa"),
])
def test_profile_of_wrappers_are_removed_from_names(title, host, expected):
    assert pv.clean_title(title, host, "", "nasa") == expected


def test_a_name_equal_to_the_handle_alone_is_not_a_preview():
    fields, reason = pv.gate({"title": "nasa | Arduino Project Hub"}, profile_url="https://projecthub.arduino.cc/nasa",
                             handle="nasa", status=200, hops=["https://projecthub.arduino.cc/nasa"])
    assert fields is None and "handle" in reason


def test_cross_links_come_from_rel_me_and_json_ld():
    fields, _ = pv.gate(pv.parse_page(page("devto"), "https://dev.to/ben"), profile_url="https://dev.to/ben",
                        handle="ben", status=200, hops=["https://dev.to/ben"])
    assert "https://twitter.com/bendhalpern" in fields["links"]
    assert all("dev.to" not in u for u in fields["links"])          # links to the site itself are not cross-links


def test_steam_share_image_is_generic():
    raw = pv.parse_page(page("steam"), "https://steamcommunity.com/id/gabelogannewell")
    assert "steam_share_image" in raw["image"]
    assert pv.is_generic_image(raw["image"], "steamcommunity.com", "gabelogannewell")


# ----------------------------------------------------------------------------- real pages: walls and blocks
WALLS = [
    # replit answered 302 -> /login?goto=/@replit with its sign-up page
    ("replit", "https://replit.com/@replit", "replit", ["https://replit.com/login?source=root-profile&goto=%2F%40replit"]),
    ("strava", "https://www.strava.com/athletes/strava", "strava", []),       # "Signup for free to see more ..."
    ("lastfm", "https://www.last.fm/user/rj", "rj", []),                       # "Client Challenge"
    ("reddit", "https://www.reddit.com/user/spez/", "spez", []),               # bot page, title "Reddit" only
    ("tiktok", "https://www.tiktok.com/@nasa", "nasa", []),                    # WAF page, no meta
    ("pinterest", "https://www.pinterest.com/nasa/", "nasa", []),              # JS-only, og:site_name only
]


@pytest.mark.parametrize("fixture,url,handle,hops", WALLS, ids=[w[0] for w in WALLS])
def test_real_walls_give_no_preview(fixture, url, handle, hops):
    chain = [url, *hops]
    fields, reason = pv.gate(pv.parse_page(page(fixture), chain[-1]), profile_url=url, handle=handle,
                             status=200, hops=chain)
    assert fields is None and reason


@pytest.mark.parametrize("status", [403, 404, 410, 500])
def test_non_200_is_never_a_preview(status):
    url = "https://x.com/NASA"
    fields, reason = pv.gate(pv.parse_page(page("twitter"), url), profile_url=url, handle="NASA",
                             status=status, hops=[url])
    assert fields is None and str(status) in reason


def test_canonical_pointing_elsewhere_is_a_wall():
    html = page("twitter").replace('href="https://x.com/NASA"', 'href="https://x.com/"')
    raw = pv.parse_page(html, "https://x.com/NASA")
    raw["og_url"] = "https://x.com/"
    fields, reason = pv.gate(raw, profile_url="https://x.com/NASA", handle="NASA", status=200,
                             hops=["https://x.com/NASA"])
    assert fields is None and "canonical" in reason


def test_redirect_to_another_account_is_rejected():
    fields, reason = pv.gate({"title": "Team | about.me", "description": "Meet the about.me team."},
                             profile_url="https://about.me/aboutme", handle="aboutme", status=200,
                             hops=["https://about.me/aboutme", "https://about.me/team"])
    assert fields is None and "away" in reason


@pytest.mark.parametrize("title,expected", [
    ("NASA (@nasa) • Instagram photos and videos", "NASA"),
    ("NASA (@NASA) on X", "NASA"),
    ("Steam Community :: Rabscuttle", "Rabscuttle"),
    ("Dave Vis’s profile", "Dave Vis"),
    ("Ben Halpern — DEV Community Profile", "Ben Halpern"),
    ("Log in • Instagram", ""),
    ("Instagram", ""),
])
def test_clean_title(title, expected):
    host = {"Steam": "steamcommunity.com", "DEV": "dev.to", "X": "x.com"}
    h = next((v for k, v in host.items() if k in title), "instagram.com")
    assert pv.clean_title(title, h, "", "nasa") == expected


@pytest.mark.parametrize("url,generic", [
    ("https://abs.twimg.com/responsive-web/client-web/icon-ios.77d25eba.png", True),
    ("https://pbs.twimg.com/sticky/default_profile_images/default_profile_400x400.png", True),
    ("https://example.com/static/og-image.png", True),
    ("https://pbs.twimg.com/profile_images/1321163587679784960/0ZxKlEKB_400x400.jpg", False),
    ("https://cdn.example.com/logo/alice.png", False),          # varies with the handle
])
def test_generic_images(url, generic):
    host = "x.com" if "twimg" in url else "example.com"
    assert pv.is_generic_image(url, host, "alice") is generic


# ----------------------------------------------------------------------------- enrich_previews end to end
async def test_enrich_previews_end_to_end(respx_mock):
    respx_mock.get("https://www.instagram.com/nasa/").mock(return_value=html_response("instagram"))
    respx_mock.get("https://x.com/nasa").mock(return_value=html_response("twitter"))
    respx_mock.get("https://replit.com/@nasa").respond(
        302, headers={"location": "/login?source=root-profile&goto=%2F%40nasa"})
    respx_mock.get("https://replit.com/login").mock(return_value=html_response("replit"))
    rows = [
        account("Instagram", "https://www.instagram.com/nasa/", "nasa"),
        account("X", "https://x.com/nasa", "nasa", extra={"bio": "set by the module"}),     # has data: skipped
        account("Replit", "https://replit.com/@nasa", "nasa"),
        account("Twitter", "https://x.com/nasa", "nasa", discriminator="2"),
        account("gitlab", "https://gitlab.com/nasa", "nasa", status="not_found"),
        account("whatsmyname", "https://github.com/WebBreacher/WhatsMyName", "nasa", meta={"summary": True}),
    ]
    before = copy.deepcopy(rows)
    report: dict[str, str] = {}
    async with httpx.AsyncClient() as http:
        out = await pv.enrich_previews(rows, http, report=report)
    assert rows == before                                     # inputs are never mutated
    assert [r["platform"] for r in out] == ["Instagram", "Twitter"]
    ig = out[0]["extra_metadata"]["extra"]
    assert ig["fullname"] == "NASA" and ig["avatar_url"].startswith("https://scontent")
    assert ig["username"] == "nasa"                           # module data kept
    assert ig["preview"]["source"] == "page-meta" and ig["preview"]["fetched_at"]
    assert set(ig["preview"]) >= {"source", "fetched_at", "title", "site_name"}
    tw = out[1]["extra_metadata"]["extra"]
    assert tw["bio"] == "Making the seemingly impossible, possible. ✨"
    assert "login" in report["https://replit.com/@nasa"]
    assert all(c.request.url.host != "gitlab.com" for c in respx_mock.calls)   # not_found rows are skipped


async def test_never_overwrites_and_merges_links(respx_mock):
    respx_mock.get("https://dev.to/ben").mock(return_value=html_response("devto"))
    row = account("DEV Community", "https://dev.to/ben", "ben", extra={"links": "https://benhalpern.com"})
    row["extra_metadata"]["extra"]["location"] = "Somewhere"
    async with httpx.AsyncClient() as http:
        (out,) = await pv.enrich_previews([row], http)
    extra = out["extra_metadata"]["extra"]
    assert extra["location"] == "Somewhere"
    links = [x.strip() for x in extra["links"].split(",")]
    assert links[0] == "https://benhalpern.com" and "https://github.com/benhalpern" in links


async def test_private_hosts_are_never_fetched(respx_mock):
    route = respx_mock.get(url__regex=r".*").respond(200, text="<title>x</title>")
    rows = [account("intranet", "http://127.0.0.1/alice", "alice"), account("lan", "http://router.local/alice", "alice")]
    async with httpx.AsyncClient() as http:
        assert await pv.enrich_previews(rows, http) == []
    assert not route.called


async def test_redirect_to_a_private_host_is_not_followed(respx_mock):
    respx_mock.get("https://example.com/alice").respond(302, headers={"location": "http://10.0.0.1/alice"})
    inner = respx_mock.get("http://10.0.0.1/alice").respond(200, text=page("twitter"))
    async with httpx.AsyncClient() as http:
        assert await pv.enrich_previews([account("Example", "https://example.com/alice", "alice")], http) == []
    assert not inner.called


async def test_429_skips_the_host_for_the_rest_of_the_run(respx_mock):
    first = respx_mock.get("https://x.com/alice").respond(429)
    second = respx_mock.get("https://x.com/bob").mock(return_value=html_response("twitter"))
    rows = [account("X", "https://x.com/alice", "alice"), account("X", "https://x.com/bob", "bob")]
    async with httpx.AsyncClient() as http:
        assert await pv.enrich_previews(rows, http) == []
    assert first.called and not second.called


async def test_non_html_is_ignored(respx_mock):
    respx_mock.get("https://example.com/alice").respond(200, json={"name": "Alice"})
    async with httpx.AsyncClient() as http:
        assert await pv.enrich_previews([account("Example", "https://example.com/alice", "alice")], http) == []


async def test_time_budget_returns_what_it_has(respx_mock):
    async def slow(request):
        await asyncio.sleep(5)
        return html_response("twitter")

    respx_mock.get("https://slow.example.com/alice").mock(side_effect=slow)
    respx_mock.get("https://www.instagram.com/nasa/").mock(return_value=html_response("instagram"))
    rows = [account("Slow", "https://slow.example.com/alice", "alice"),
            account("Instagram", "https://www.instagram.com/nasa/", "nasa")]
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    async with httpx.AsyncClient() as http:
        out = await pv.enrich_previews(rows, http, budget_s=0.5)
    assert loop.time() - t0 < 2
    assert [r["platform"] for r in out] == ["Instagram"]


async def test_same_image_for_different_accounts_is_dropped(respx_mock):
    shared = page("soundcloud")
    for h in ("alice", "bob"):
        respx_mock.get(f"https://soundcloud.com/{h}").respond(
            200, text=shared.replace("https://soundcloud.com/nasa", f"https://soundcloud.com/{h}"),
            headers={"content-type": "text/html"})
    rows = [account("SoundCloud", "https://soundcloud.com/alice", "alice"),
            account("SoundCloud", "https://soundcloud.com/bob", "bob")]
    async with httpx.AsyncClient() as http:
        out = await pv.enrich_previews(rows, http)
    assert out and all("avatar_url" not in r["extra_metadata"]["extra"] for r in out)


def test_candidates_priority_order_and_limit():
    rows = [account("Zeta", "https://zeta.example/alice", "alice"),
            account("GitHub", "https://github.com/alice", "alice"),
            account("Instagram", "https://www.instagram.com/alice/", "alice"),
            account("Alpha", "https://alpha.example/alice", "alice"),
            make_finding(case_id="c1", identifier_type="name", identifier_value="Alice", source_tool="person_web",
                         platform="web", url="https://news.example/a")]
    picked = pv.select_candidates(rows, limit=3)
    assert [r["platform"] for r in picked] == ["Instagram", "GitHub", "Alpha"]
    assert pv.select_candidates(rows, limit=3) == picked      # deterministic
