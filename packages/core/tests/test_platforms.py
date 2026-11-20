"""Platform display registry (`sherlock_core.platforms`). Pure, offline."""
import pytest
from sherlock_core import platforms as P
from sherlock_core.correlation.norm import HOST_PLATFORM, canonical_platform
from sherlock_core.modules.whatsmyname import load_sites


@pytest.mark.parametrize("value,key,label,domain,category", [
    ("GitHub (User)", "github", "GitHub", "github.com", "dev"),
    ("github", "github", "GitHub", "github.com", "dev"),
    ("X", "twitter", "X (Twitter)", "x.com", "social"),
    ("twitter.com", "twitter", "X (Twitter)", "x.com", "social"),
    ("https://www.linkedin.com/in/someone", "linkedin", "LinkedIn", "linkedin.com", "professional"),
    ("StackOverflow", "stackoverflow", "Stack Overflow", "stackoverflow.com", "dev"),
    ("YouTube Channel", "youtube", "YouTube", "youtube.com", "video"),
    ("Docker Hub (Organization)", "dockerhub", "Docker Hub", "hub.docker.com", "dev"),
    ("chess.com", "chesscom", "Chess.com", "chess.com", "gaming"),
    ("netflixtechblog.medium.com", "medium", "Medium", "medium.com", "social"),
    ("Last.fm", "lastfm", "Last.fm", "last.fm", "music"),
    ("threads.net", "threads", "Threads", "threads.com", "social"),
])
def test_known_platforms(value, key, label, domain, category):
    assert P.platform_info(value) == {"key": key, "label": label, "domain": domain, "category": category}


def test_unknown_platform_falls_back_to_the_profile_host():
    info = P.platform_info("Some Forum", url="https://forum.example.org/u/alice")
    assert info == {"key": "forum.example.org", "label": "forum.example.org", "domain": "forum.example.org",
                    "category": "other"}
    assert P.platform_info("forum.example.org")["domain"] == "forum.example.org"
    bare = P.platform_info("Some Forum (User)")
    assert bare["category"] == "other" and bare["label"] == "Some Forum" and bare["domain"] == ""


def test_keys_agree_with_the_correlation_engine():
    by_key = {e["key"]: e for e in P.all_platforms()}
    for host, canon in HOST_PLATFORM.items():
        if canon in by_key:
            assert P.platform_info(host)["key"] == canon
    for e in by_key.values():
        canon = canonical_platform(e["domain"])
        if canon in HOST_PLATFORM.values():
            assert canon == e["key"], e


def test_registry_shape_and_coverage():
    entries = P.all_platforms()
    assert len(entries) >= 120
    assert len({e["key"] for e in entries}) == len(entries)
    assert all(e["category"] in P.CATEGORIES and e["label"] and e["domain"] for e in entries)
    assert all(e["hosts"][0] == e["domain"] for e in entries)
    # the most common WhatsMyName sites resolve to a registry entry, not the fallback
    names = {s["name"] for s in load_sites()}
    for name in ("Instagram", "Facebook", "TikTok", "Twitch", "Reddit", "Pinterest", "SoundCloud", "Steam",
                 "Spotify", "Vimeo", "Patreon", "Linktree", "Kaggle", "Replit", "Producthunt", "Strava"):
        assert name in names
        assert P.platform_info(name)["domain"], name
