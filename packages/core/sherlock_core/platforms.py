"""Display metadata for platforms: label, home domain and a coarse category, for icons and grouping.

    platform_info("GitHub (User)")        -> {"key": "github", "label": "GitHub", "domain": "github.com", "category": "dev"}
    platform_info("x.com")                -> {"key": "twitter", "label": "X (Twitter)", ...}
    platform_info("Some Site", url="https://forum.example.org/u/alice")
                                          -> {"key": "forum.example.org", "label": "forum.example.org", ...}

Pure and offline. Covers the ~190 platforms seen most in the WhatsMyName dataset
(`sherlock_core/data/`), in `modules/profiles.py` and in name-search results. Keys are the
correlation engine's canonical platform names wherever it knows the platform
(`correlation.norm.canonical_platform`, imported, not changed), so a finding's platform and
this registry agree. Stored rows are not touched: the web app reads `GET /platforms` and
maps by platform name or profile host.
"""
from __future__ import annotations

import re
from functools import lru_cache
from typing import Any, Literal
from urllib.parse import urlsplit

from sherlock_core.correlation.norm import HOST_PLATFORM, canonical_platform, clean_host

Category = Literal["social", "dev", "video", "music", "gaming", "forum", "shopping", "professional", "other"]
CATEGORIES: tuple[str, ...] = ("social", "dev", "video", "music", "gaming", "forum", "shopping", "professional",
                               "other")

# key, label, domain, category, *aliases (site names as WhatsMyName / user-scanner spell them)
_ENTRIES: tuple[tuple[str, ...], ...] = (
    # social
    ("twitter", "X (Twitter)", "x.com", "social", "x", "twitter archived profile", "twitter archived tweets"),
    ("instagram", "Instagram", "instagram.com", "social", "instagram imginn", "instagram archives"),
    ("facebook", "Facebook", "facebook.com", "social"),
    ("threads", "Threads", "threads.com", "social", "threads.net"),
    ("snapchat", "Snapchat", "snapchat.com", "social"),
    ("pinterest", "Pinterest", "pinterest.com", "social"),
    ("bluesky", "Bluesky", "bsky.app", "social", "bluesky username", "bluesky domain as user"),
    ("mastodon", "Mastodon", "mastodon.social", "social", "mastodon api", "mastodon-mastodon", "mastodon.online"),
    ("telegram", "Telegram", "t.me", "social"),
    ("discord", "Discord", "discord.com", "social", "discord user", "discord invite"),
    ("vk", "VK", "vk.com", "social"),
    ("okru", "OK", "ok.ru", "social", "ok.ru", "odnoklassniki"),
    ("weibo", "Weibo", "weibo.com", "social"),
    ("tumblr", "Tumblr", "tumblr.com", "social"),
    ("medium", "Medium", "medium.com", "social"),
    ("substack", "Substack", "substack.com", "social"),
    ("wordpress", "WordPress.com", "wordpress.com", "social", "wordpress.com public", "wordpress.com private"),
    ("blogspot", "Blogger", "blogspot.com", "social"),
    ("livejournal", "LiveJournal", "livejournal.com", "social"),
    ("wattpad", "Wattpad", "wattpad.com", "social"),
    ("flickr", "Flickr", "flickr.com", "social"),
    ("deviantart", "DeviantArt", "deviantart.com", "social"),
    ("artstation", "ArtStation", "artstation.com", "social"),
    ("imgur", "Imgur", "imgur.com", "social"),
    ("giphy", "GIPHY", "giphy.com", "social", "giphy channel"),
    ("linktree", "Linktree", "linktr.ee", "social"),
    ("aboutme", "About.me", "about.me", "social"),
    ("carrd", "Carrd", "carrd.co", "social", "carrd.co"),
    ("beacons", "Beacons", "beacons.ai", "social"),
    ("gravatar", "Gravatar", "gravatar.com", "social"),
    ("vero", "VERO", "vero.co", "social"),
    ("minds", "Minds", "minds.com", "social"),
    ("gab", "Gab", "gab.com", "social"),
    ("gettr", "GETTR", "gettr.com", "social"),
    ("truthsocial", "Truth Social", "truthsocial.com", "social"),
    ("parler", "Parler", "parler.com", "social"),
    ("tellonym", "Tellonym", "tellonym.me", "social"),
    ("plurk", "Plurk", "plurk.com", "social"),
    ("mixi", "mixi", "mixi.jp", "social"),
    ("naver", "Naver", "naver.com", "social"),
    ("pixelfed", "Pixelfed", "pixelfed.social", "social", "pixelfed.social"),
    ("myspace", "Myspace", "myspace.com", "social"),
    ("clubhouse", "Clubhouse", "clubhouse.com", "social"),
    ("letterboxd", "Letterboxd", "letterboxd.com", "social"),
    ("goodreads", "Goodreads", "goodreads.com", "social"),
    ("myanimelist", "MyAnimeList", "myanimelist.net", "social"),
    ("anilist", "AniList", "anilist.co", "social"),
    ("untappd", "Untappd", "untappd.com", "social"),
    ("foursquare", "Foursquare", "foursquare.com", "social"),
    ("pikabu", "Pikabu", "pikabu.ru", "social"),
    ("wykop", "Wykop", "wykop.pl", "social"),
    ("lemon8", "Lemon8", "lemon8-app.com", "social"),
    # video / streaming
    ("youtube", "YouTube", "youtube.com", "video", "youtube channel", "youtube user", "youtube user2"),
    ("tiktok", "TikTok", "tiktok.com", "video"),
    ("twitch", "Twitch", "twitch.tv", "video"),
    ("vimeo", "Vimeo", "vimeo.com", "video"),
    ("dailymotion", "Dailymotion", "dailymotion.com", "video"),
    ("kick", "Kick", "kick.com", "video"),
    ("rumble", "Rumble", "rumble.com", "video", "rumblechannel", "rumbleuser"),
    ("bitchute", "BitChute", "bitchute.com", "video"),
    ("kwai", "Kwai", "kwai.com", "video"),
    ("younow", "YouNow", "younow.com", "video"),
    ("bigolive", "BIGO LIVE", "bigo.tv", "video", "bigo live"),
    ("coub", "Coub", "coub.com", "video"),
    ("periscope", "Periscope", "periscope.tv", "video"),
    ("aparat", "Aparat", "aparat.com", "video"),
    # music
    ("spotify", "Spotify", "open.spotify.com", "music"),
    ("soundcloud", "SoundCloud", "soundcloud.com", "music"),
    ("bandcamp", "Bandcamp", "bandcamp.com", "music"),
    ("mixcloud", "Mixcloud", "mixcloud.com", "music"),
    ("lastfm", "Last.fm", "last.fm", "music", "last.fm"),
    ("genius", "Genius", "genius.com", "music", "genius artist", "genius user"),
    ("discogs", "Discogs", "discogs.com", "music"),
    ("ultimateguitar", "Ultimate Guitar", "ultimate-guitar.com", "music"),
    ("bandlab", "BandLab", "bandlab.com", "music"),
    ("freesound", "Freesound", "freesound.org", "music"),
    ("audiojungle", "AudioJungle", "audiojungle.net", "music"),
    # gaming
    ("steam", "Steam", "steamcommunity.com", "gaming", "steamgifts"),
    ("xbox", "Xbox", "xbox.com", "gaming", "xbox gamertag", "gamer dvr"),
    ("playstation", "PlayStation Network", "playstation.com", "gaming", "playstation network"),
    ("roblox", "Roblox", "roblox.com", "gaming"),
    ("chesscom", "Chess.com", "chess.com", "gaming", "chess.com"),
    ("lichess", "Lichess", "lichess.org", "gaming", "lichess.org"),
    ("itchio", "itch.io", "itch.io", "gaming", "itch.io"),
    ("gamejolt", "Game Jolt", "gamejolt.com", "gaming"),
    ("faceit", "FACEIT", "faceit.com", "gaming"),
    ("opgg", "OP.GG", "op.gg", "gaming", "op.gg"),
    ("osu", "osu!", "osu.ppy.sh", "gaming", "osu!"),
    ("kongregate", "Kongregate", "kongregate.com", "gaming"),
    ("newgrounds", "Newgrounds", "newgrounds.com", "gaming"),
    ("gog", "GOG", "gog.com", "gaming"),
    ("fortnitetracker", "Fortnite Tracker", "fortnitetracker.com", "gaming"),
    ("speedrun", "speedrun.com", "speedrun.com", "gaming"),
    ("monkeytype", "Monkeytype", "monkeytype.com", "gaming"),
    ("runescape", "RuneScape", "runescape.com", "gaming"),
    # dev
    ("github", "GitHub", "github.com", "dev", "github user", "github gists", "gists"),
    ("gitlab", "GitLab", "gitlab.com", "dev"),
    ("bitbucket", "Bitbucket", "bitbucket.org", "dev"),
    ("codeberg", "Codeberg", "codeberg.org", "dev"),
    ("gitee", "Gitee", "gitee.com", "dev"),
    ("sourceforge", "SourceForge", "sourceforge.net", "dev"),
    ("stackoverflow", "Stack Overflow", "stackoverflow.com", "dev", "stack overflow"),
    ("codepen", "CodePen", "codepen.io", "dev"),
    ("codesandbox", "CodeSandbox", "codesandbox.io", "dev"),
    ("replit", "Replit", "replit.com", "dev"),
    ("kaggle", "Kaggle", "kaggle.com", "dev"),
    ("huggingface", "Hugging Face", "huggingface.co", "dev"),
    ("npm", "npm", "npmjs.com", "dev"),
    ("pypi", "PyPI", "pypi.org", "dev"),
    ("rubygems", "RubyGems", "rubygems.org", "dev", "rubygems.org"),
    ("dockerhub", "Docker Hub", "hub.docker.com", "dev", "docker hub user", "docker hub organization",
     "docker hub"),
    ("devto", "DEV Community", "dev.to", "dev", "dev.to"),
    ("hashnode", "Hashnode", "hashnode.com", "dev"),
    ("keybase", "Keybase", "keybase.io", "dev"),
    ("leetcode", "LeetCode", "leetcode.com", "dev"),
    ("hackerrank", "HackerRank", "hackerrank.com", "dev"),
    ("codeforces", "Codeforces", "codeforces.com", "dev"),
    ("codechef", "CodeChef", "codechef.com", "dev"),
    ("codewars", "Codewars", "codewars.com", "dev"),
    ("atcoder", "AtCoder", "atcoder.jp", "dev"),
    ("topcoder", "Topcoder", "topcoder.com", "dev"),
    ("hackerone", "HackerOne", "hackerone.com", "dev"),
    ("bugcrowd", "Bugcrowd", "bugcrowd.com", "dev"),
    ("tryhackme", "TryHackMe", "tryhackme.com", "dev"),
    ("codecademy", "Codecademy", "codecademy.com", "dev"),
    ("freecodecamp", "freeCodeCamp", "freecodecamp.org", "dev"),
    ("scratch", "Scratch", "scratch.mit.edu", "dev"),
    ("wakatime", "WakaTime", "wakatime.com", "dev"),
    ("hackaday", "Hackaday.io", "hackaday.io", "dev", "hackaday.io"),
    ("asciinema", "asciinema", "asciinema.org", "dev"),
    ("pastebin", "Pastebin", "pastebin.com", "dev"),
    ("greasyfork", "Greasy Fork", "greasyfork.org", "dev"),
    ("figma", "Figma", "figma.com", "dev"),
    # forums / Q&A
    ("reddit", "Reddit", "reddit.com", "forum"),
    ("hackernews", "Hacker News", "news.ycombinator.com", "forum"),
    ("quora", "Quora", "quora.com", "forum"),
    ("disqus", "Disqus", "disqus.com", "forum"),
    ("lobsters", "Lobsters", "lobste.rs", "forum", "lobste.rs"),
    ("devrant", "devRant", "devrant.com", "forum"),
    ("habr", "Habr", "habr.com", "forum", "habr user", "habr q a"),
    ("fandom", "Fandom", "fandom.com", "forum"),
    ("boardgamegeek", "BoardGameGeek", "boardgamegeek.com", "forum"),
    ("knowyourmeme", "Know Your Meme", "knowyourmeme.com", "forum"),
    ("steemit", "Steemit", "steemit.com", "forum"),
    # shopping / payments / creator support
    ("etsy", "Etsy", "etsy.com", "shopping"),
    ("ebay", "eBay", "ebay.com", "shopping", "ebay stores"),
    ("poshmark", "Poshmark", "poshmark.com", "shopping"),
    ("depop", "Depop", "depop.com", "shopping"),
    ("gumroad", "Gumroad", "gumroad.com", "shopping"),
    ("tindie", "Tindie", "tindie.com", "shopping"),
    ("rarible", "Rarible", "rarible.com", "shopping"),
    ("patreon", "Patreon", "patreon.com", "shopping"),
    ("kofi", "Ko-fi", "ko-fi.com", "shopping", "ko-fi"),
    ("buymeacoffee", "Buy Me a Coffee", "buymeacoffee.com", "shopping"),
    ("kickstarter", "Kickstarter", "kickstarter.com", "shopping"),
    ("paypal", "PayPal.Me", "paypal.me", "shopping", "paypal.me", "paypal business"),
    ("venmo", "Venmo", "venmo.com", "shopping"),
    ("cameo", "Cameo", "cameo.com", "shopping"),
    # professional
    ("linkedin", "LinkedIn", "linkedin.com", "professional"),
    ("xing", "XING", "xing.com", "professional"),
    ("behance", "Behance", "behance.net", "professional"),
    ("dribbble", "Dribbble", "dribbble.com", "professional"),
    ("researchgate", "ResearchGate", "researchgate.net", "professional"),
    ("googlescholar", "Google Scholar", "scholar.google.com", "professional", "google scholar"),
    ("orcid", "ORCID", "orcid.org", "professional"),
    ("producthunt", "Product Hunt", "producthunt.com", "professional", "product hunt"),
    ("muckrack", "Muck Rack", "muckrack.com", "professional"),
    ("fiverr", "Fiverr", "fiverr.com", "professional"),
    ("freelancer", "Freelancer", "freelancer.com", "professional"),
    ("peerlist", "Peerlist", "peerlist.io", "professional"),
    ("coroflot", "Coroflot", "coroflot.com", "professional"),
    ("slideshare", "SlideShare", "slideshare.net", "professional"),
    ("speakerdeck", "Speaker Deck", "speakerdeck.com", "professional"),
    ("udemy", "Udemy", "udemy.com", "professional"),
    ("crunchbase", "Crunchbase", "crunchbase.com", "professional"),
    # other
    ("strava", "Strava", "strava.com", "other"),
    ("garmin", "Garmin Connect", "connect.garmin.com", "other", "garmin connect"),
    ("duolingo", "Duolingo", "duolingo.com", "other"),
    ("trello", "Trello", "trello.com", "other"),
    ("tradingview", "TradingView", "tradingview.com", "other"),
    ("quizlet", "Quizlet", "quizlet.com", "other"),
    ("openstreetmap", "OpenStreetMap", "openstreetmap.org", "other"),
    ("inaturalist", "iNaturalist", "inaturalist.org", "other"),
    ("polarsteps", "Polarsteps", "polarsteps.com", "other"),
    ("instructables", "Instructables", "instructables.com", "other"),
    ("tenor", "Tenor", "tenor.com", "other"),
    ("wikipedia", "Wikipedia", "wikipedia.org", "other"),
    ("wikidata", "Wikidata", "wikidata.org", "other"),
    ("companieshouse", "Companies House", "find-and-update.company-information.service.gov.uk", "professional",
     "companies-house", "companies house"),
    ("openalex", "OpenAlex", "openalex.org", "professional"),
)

# Words in site names that only say which page of the platform was checked.
_QUALIFIERS = re.compile(r"\s*\((?:[^)]*)\)\s*|\b(?:user|users|username|channel|profile|profiles|account|"
                         r"organization|organisation|public|community)\b", re.I)


def _squash(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


@lru_cache(maxsize=1)
def _index() -> tuple[dict[str, dict[str, str]], dict[str, str], dict[str, str]]:
    """(entries by key, squashed name/alias -> key, domain -> key)."""
    by_key: dict[str, dict[str, str]] = {}
    names: dict[str, str] = {}
    domains: dict[str, str] = {}
    for key, label, domain, category, *aliases in _ENTRIES:
        assert category in CATEGORIES, (key, category)
        by_key[key] = {"key": key, "label": label, "domain": domain, "category": category}
        for n in (key, label, *aliases):
            names.setdefault(_squash(n), key)
        domains[domain] = key
    for host, canon in HOST_PLATFORM.items():           # every host the correlation engine knows
        if canon in by_key:
            domains.setdefault(host, canon)
    return by_key, names, domains


def _host_of(value: str) -> str:
    v = value.strip()
    if "://" not in v:
        v = "https://" + v
    try:
        return clean_host(urlsplit(v).hostname or "")
    except ValueError:
        return ""


def _by_host(host: str) -> str | None:
    _, _, domains = _index()
    h = clean_host(host)
    while h and "." in h:
        if h in domains:
            return domains[h]
        h = h.split(".", 1)[1]                            # subdomains: netflixtechblog.medium.com
    return None


def platform_info(name_or_host: Any, url: str | None = None) -> dict[str, str]:
    """{key, label, domain, category} for a site name, a host or a profile URL.

    Unknown platforms fall back to the host of `url` (or of `name_or_host` when it is a
    host / URL): label and key are that host, category "other".
    """
    by_key, names, _ = _index()
    raw = str(name_or_host or "").strip()
    looks_like_host = "://" in raw or bool(re.fullmatch(r"(?:[\w-]+\.)+[a-z]{2,}(?:/.*)?", raw.lower()))
    if raw and not looks_like_host:
        for candidate in (raw, _QUALIFIERS.sub(" ", raw)):
            key = names.get(_squash(candidate))
            if key:
                return dict(by_key[key])
        canon = canonical_platform(raw)
        if canon in by_key:
            return dict(by_key[canon])
    hosts = ([_host_of(raw)] if looks_like_host else []) + ([_host_of(url)] if url else [])
    for host in hosts:
        if host and (key := _by_host(host)):
            return dict(by_key[key])
    if raw and looks_like_host:
        canon = canonical_platform(raw)
        if canon in by_key:
            return dict(by_key[canon])
    host = next((h for h in hosts if h), "")
    if host:
        return {"key": host, "label": host, "domain": host, "category": "other"}
    label = " ".join(_QUALIFIERS.sub(" ", raw).split()) or raw
    return {"key": canonical_platform(raw) or _squash(raw), "label": label, "domain": "", "category": "other"}


def all_platforms() -> list[dict[str, Any]]:
    """Every registry entry, sorted by label, for `GET /platforms`:
    {key, label, domain, category, aliases: [site names], hosts: [hosts incl. domain]}."""
    by_key, _, domains = _index()
    aliases = {key: list(rest) for key, _label, _domain, _cat, *rest in _ENTRIES}
    hosts: dict[str, list[str]] = {}
    for host, key in domains.items():
        hosts.setdefault(key, []).append(host)
    return sorted(
        ({**v, "aliases": aliases.get(k, []), "hosts": sorted(hosts.get(k, []), key=lambda h: h != v["domain"])}
         for k, v in by_key.items()),
        key=lambda e: e["label"].casefold())
