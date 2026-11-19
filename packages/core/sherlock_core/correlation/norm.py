"""Normalisation helpers shared by fact extraction and the rules. Pure, stdlib only.

Everything that decides "are these two values the same thing" lives here:
emails, URLs, platform names (one alias table for site names AND hosts),
handles taken from profile URLs, display names and free text.
"""
from __future__ import annotations

import re
from collections.abc import Iterator
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
URL_RE = re.compile(r"https?://[^\s<>\"'`,;\]\[(){}|\\^]+", re.I)
_HANDLE_OK = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._\-]{0,63}$")
_WS = re.compile(r"\s+")
_HOSTLIKE = re.compile(r"^(?:[a-z0-9\-]+\.)+[a-z]{2,}$")

# ----------------------------------------------------------------------------- platforms
# canonical name -> (site-name aliases, hosts). The single source of truth.
_PLATFORMS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "twitter": (("x", "x (twitter)", "twitter/x", "x/twitter", "twitter (x)"), ("twitter.com", "x.com")),
    "instagram": (("ig", "insta"), ("instagram.com", "instagr.am")),
    "github": (("gh",), ("github.com", "gist.github.com")),
    "gitlab": ((), ("gitlab.com",)),
    "linkedin": ((), ("linkedin.com",)),
    "youtube": (("yt",), ("youtube.com", "youtu.be")),
    "tiktok": ((), ("tiktok.com",)),
    "medium": ((), ("medium.com",)),
    "hackerone": ((), ("hackerone.com",)),
    "bugcrowd": ((), ("bugcrowd.com",)),
    "reddit": ((), ("reddit.com",)),
    "gravatar": ((), ("gravatar.com",)),
    "facebook": (("fb",), ("facebook.com", "fb.com", "fb.me")),
    "telegram": (("tg",), ("t.me", "telegram.me")),
    "mastodon": ((), ("mastodon.social",)),
    "twitch": ((), ("twitch.tv",)),
    "pinterest": ((), ("pinterest.com",)),
    "keybase": ((), ("keybase.io",)),
    "devto": (("dev community",), ("dev.to",)),
    "bluesky": (("bsky",), ("bsky.app",)),
    "threads": ((), ("threads.net", "threads.com")),
    "snapchat": (("snap",), ("snapchat.com",)),
    "soundcloud": ((), ("soundcloud.com",)),
    "vk": (("vkontakte",), ("vk.com",)),
    "steam": (("steam community",), ("steamcommunity.com",)),
    "bitbucket": ((), ("bitbucket.org",)),
    "kaggle": ((), ("kaggle.com",)),
    "behance": ((), ("behance.net",)),
    "dribbble": ((), ("dribbble.com",)),
    "producthunt": ((), ("producthunt.com",)),
    "patreon": ((), ("patreon.com",)),
    "npm": (("npmjs",), ("npmjs.com",)),
    "pypi": ((), ("pypi.org",)),
    "dockerhub": (("docker",), ("hub.docker.com",)),
    "stackoverflow": ((), ("stackoverflow.com",)),
    "codepen": ((), ("codepen.io",)),
    "replit": ((), ("replit.com",)),
    "aboutme": ((), ("about.me",)),
    "linktree": ((), ("linktr.ee",)),
    "flickr": ((), ("flickr.com",)),
    "vimeo": ((), ("vimeo.com",)),
    "hackernews": (("hn", "ycombinator"), ("news.ycombinator.com",)),
    "tumblr": ((), ("tumblr.com",)),
    "leetcode": ((), ("leetcode.com",)),
    "huggingface": (("hugging face",), ("huggingface.co",)),
    "discord": ((), ("discord.com", "discord.gg")),
    "hudsonrock": (("hudson-rock", "hudson rock"), ()),
}


def _squash(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


HOST_PLATFORM: dict[str, str] = {}
_NAME_PLATFORM: dict[str, str] = {}
for _canon, (_aliases, _hosts) in _PLATFORMS.items():
    _NAME_PLATFORM[_canon] = _canon
    for _a in _aliases:
        _NAME_PLATFORM[_squash(_a)] = _canon
    for _h in _hosts:
        HOST_PLATFORM[_h] = _canon

_HOST_PREFIXES = ("www.", "m.", "mobile.", "en.", "old.", "new.")

# Platforms that are exposure sources, not places an account lives.
NON_SOCIAL_PLATFORMS = frozenset({"breach", "hudsonrock", "spiderfoot"})


def clean_host(host: Any) -> str:
    h = str(host or "").strip().lower().rstrip(".")
    h = h.rsplit("@", 1)[-1].split(":", 1)[0]
    changed = True
    while changed:
        changed = False
        for p in _HOST_PREFIXES:
            # keep "m.me"-style two-label hosts intact
            if h.startswith(p) and h.count(".") >= 2:
                h, changed = h[len(p):], True
    return h


def platform_from_host(host: Any) -> str | None:
    """Canonical platform for a host. EXACT host match only (after www./m. stripping)."""
    return HOST_PLATFORM.get(clean_host(host))


def canonical_platform(name: Any) -> str:
    """One canonical platform name for a site name, a host, or a `scraped:<host>` tag.

    'X', 'Twitter', 'x.com', 'scraped:twitter.com' -> 'twitter'. Unknown names are
    lower-cased with punctuation removed; unknown hosts are returned cleaned.
    """
    raw = str(name or "").strip().lower()
    if not raw:
        return ""
    if raw.startswith("scraped:"):
        raw = raw.split(":", 1)[1].strip()
    if raw in _NAME_PLATFORM:
        return _NAME_PLATFORM[raw]
    host = clean_host(raw)
    if _HOSTLIKE.match(host):
        return HOST_PLATFORM.get(host, host)
    sq = _squash(raw)
    return _NAME_PLATFORM.get(sq, sq)


# ----------------------------------------------------------------------------- values
def flatten(value: Any, _depth: int = 0) -> Iterator[str]:
    """Yield every string inside a value that may be None, a scalar, a list or a dict."""
    if value is None or isinstance(value, bool) or _depth > 4:
        return
    if isinstance(value, str):
        if value.strip():
            yield value
    elif isinstance(value, int | float):
        yield str(value)
    elif isinstance(value, dict):
        for v in value.values():
            yield from flatten(v, _depth + 1)
    elif isinstance(value, list | tuple | set | frozenset):
        for v in value:
            yield from flatten(v, _depth + 1)


def split_values(value: Any) -> list[str]:
    """Items of a field that may be a list or a comma / whitespace separated string."""
    out: list[str] = []
    for s in flatten(value):
        out.extend(p for p in re.split(r"[,\s]+", s) if p)
    return out


def norm_text(value: Any) -> str:
    """Casefolded, whitespace-collapsed text ('' for non-strings)."""
    if not isinstance(value, str):
        return ""
    return _WS.sub(" ", value).strip().casefold()


def norm_name(value: Any) -> str:
    return norm_text(value)


_NOREPLY = re.compile(r"^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|mailer-daemon|postmaster)\b")


def norm_email(value: Any) -> str | None:
    """Lower-cased email, or None when it is not one (or is a no-reply / example address)."""
    if not isinstance(value, str):
        return None
    s = value.strip().strip("<>()[]\"'.,;:").lower()
    if s.startswith("mailto:"):
        s = s[7:].split("?", 1)[0]
    if not EMAIL_RE.fullmatch(s):
        return None
    local, domain = s.rsplit("@", 1)
    if _NOREPLY.match(local) or "noreply" in domain or domain in ("example.com", "example.org"):
        return None
    return s


def find_emails(text: Any) -> list[str]:
    if not isinstance(text, str):
        return []
    out = []
    for m in EMAIL_RE.findall(text):
        e = norm_email(m)
        if e and e not in out:
            out.append(e)
    return out


_TRACKING = frozenset({
    "fbclid", "gclid", "dclid", "msclkid", "igshid", "igsh", "mc_cid", "mc_eid", "ref", "ref_src",
    "ref_url", "source", "si", "s", "t", "feature", "_hsenc", "_hsmi", "yclid", "spm", "share_id",
    "trk", "originalsubdomain", "lang", "hl",
})


def _split_url(value: Any):
    if not isinstance(value, str):
        return None
    s = value.strip().strip("<>\"'").rstrip(".,;:!?)>]}'\"")
    if not s or " " in s or s.lower().startswith(("mailto:", "javascript:", "tel:", "data:")):
        return None
    if "://" not in s:
        s = "https://" + s.lstrip("/")
    try:
        parts = urlsplit(s)
        host = clean_host(parts.hostname or "")
    except ValueError:
        return None
    if parts.scheme.lower() not in ("http", "https") or not _HOSTLIKE.match(host):
        return None
    return host, parts


def norm_url(value: Any) -> str | None:
    """Comparable form of a URL: `host/path?query`.

    Scheme-insensitive, `www.` stripped, no fragment, no trailing slash, no tracking
    parameters, remaining parameters sorted. None when the value is not a web URL.
    """
    sp = _split_url(value)
    if not sp:
        return None
    host, parts = sp
    path = re.sub(r"/{2,}", "/", parts.path or "").rstrip("/")
    try:
        query = sorted(
            (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in _TRACKING and not k.lower().startswith("utm_")
        )
    except ValueError:
        query = []
    out = host + path
    if query:
        out += "?" + urlencode(query)
    return out


def url_host(value: Any) -> str:
    sp = _split_url(value)
    return sp[0] if sp else ""


def find_urls(text: Any) -> list[str]:
    """Explicit http(s) URLs in free text (original spelling, trailing punctuation removed)."""
    if not isinstance(text, str):
        return []
    out = []
    for m in URL_RE.findall(text):
        u = m.rstrip(".,;:!?)>]}'\"")
        if u not in out:
            out.append(u)
    return out


# ----------------------------------------------------------------------------- handles
# First path segments that are site furniture, never a handle.
RESERVED_SEGMENTS = frozenset({
    "channel", "title", "s", "p", "in", "user", "users", "u", "share", "sharer", "sharer.php", "intent",
    "home", "about", "explore", "search", "settings", "reel", "reels", "stories", "story", "post", "posts",
    "status", "statuses", "video", "videos", "watch", "playlist", "results", "feed", "hashtag", "i",
    "login", "logout", "signup", "signin", "sign-in", "sign-up", "join", "register", "privacy", "terms",
    "tos", "help", "support", "legal", "policies", "policy", "contact", "press", "jobs", "careers", "blog",
    "news", "company", "pricing", "features", "enterprise", "orgs", "organizations", "topics", "trending",
    "collections", "marketplace", "sponsors", "apps", "app", "download", "downloads", "embed", "tv",
    "live", "tag", "tags", "t", "c", "r", "e", "d", "groups", "pages", "page", "events", "profile.php",
    "profile", "profiles", "people", "pub", "school", "notifications", "messages", "discover", "shorts",
    "gaming", "music", "premium", "account", "accounts", "oauth", "api", "docs", "developer",
    "developers", "security", "site", "pulse", "learning", "showcase", "public", "web", "joinchat",
    "addstickers", "package", "packages", "project", "projects", "questions", "wiki", "static", "assets",
    "images", "img", "media", "favicon.ico", "robots.txt", "index.html", "index.php", "hc", "en",
    "undefined", "null", "id", "invite", "store", "shop", "product", "products", "category", "categories",
    "article", "articles", "comments", "submit", "new", "edit", "admin", "dashboard", "following",
    "followers", "likes", "lists", "moments", "compose", "ads", "business", "advertising",
    "copyright", "cookies", "sitemap", "sitemap.xml", "rss", "feed.xml", "amp", "mobile", "next",
    "item", "items", "login.php", "dialog", "plugins", "tr", "gp", "dp", "maps", "file", "files", "sh",
    "scl", "o", "a", "b", "v", "w", "x", "l", "g", "m", "n",
})

# platform -> path prefixes; the handle is the segment AFTER one of these.
_PREFIX_HANDLE = {
    "linkedin": ("in",),
    "reddit": ("user", "u"),
    "steam": ("id",),
    "pypi": ("user",),
    "dockerhub": ("u",),
    "stackoverflow": (),      # numeric ids, no usable handle
    "hackernews": (),         # /user?id=name, handled below
    "discord": (),
}
# platforms where a profile path must start with "@".
_AT_HANDLE = frozenset({"medium", "tiktok", "mastodon", "threads"})


def norm_handle(value: Any) -> str | None:
    """Lower-cased handle without a leading '@', or None when it cannot be one."""
    if not isinstance(value, str):
        return None
    h = value.strip().lstrip("@~").rstrip(".,;:!?)/")
    if not _HANDLE_OK.match(h):
        return None
    return h.lower()


def handle_from_url(value: Any) -> tuple[str, str] | None:
    """(canonical platform, handle) for a profile URL on a known platform, else None.

    The platform is decided from the parsed HOST (exact match), never from a substring,
    so `dropbox.com/s/abc` is not a Twitter handle. Reserved path words are skipped.
    """
    sp = _split_url(value)
    if not sp:
        return None
    host, parts = sp
    platform = HOST_PLATFORM.get(host)
    if not platform or host == "youtu.be":
        return None
    segs = [s for s in (parts.path or "").split("/") if s]
    if platform == "hackernews":
        if segs[:1] == ["user"]:
            for k, v in parse_qsl(parts.query):
                if k == "id" and (h := norm_handle(v)):
                    return platform, h
        return None
    if not segs:
        return None
    first = segs[0]
    cand: str | None = None
    if platform == "youtube":
        if first.startswith("@"):
            cand = first
        elif first.lower() in ("c", "user", "channel") and len(segs) >= 2:
            if first.lower() == "channel" and not segs[1].startswith("UC"):
                return None
            cand = segs[1]
    elif platform in _PREFIX_HANDLE:
        if first.lower() in _PREFIX_HANDLE[platform] and len(segs) >= 2:
            cand = segs[1]
    elif platform in _AT_HANDLE:
        cand = first if first.startswith("@") else None
    elif first.lower() not in RESERVED_SEGMENTS:
        cand = first
    if not cand:
        return None
    if platform == "youtube" and cand.startswith("UC") and first.lower() == "channel":
        return (platform, cand) if _HANDLE_OK.match(cand) else None   # channel ids are case-sensitive
    handle = norm_handle(cand)
    if not handle or handle in RESERVED_SEGMENTS:
        return None
    return platform, handle


# Explicit "this is my handle on <platform>" phrasing in free text. Never bare words.
_KEYWORDS = {
    "twitter": "twitter", "instagram": "instagram", "insta": "instagram", "ig": "instagram",
    "github": "github", "gitlab": "gitlab", "telegram": "telegram", "tiktok": "tiktok",
    "youtube": "youtube", "mastodon": "mastodon", "twitch": "twitch", "snapchat": "snapchat",
    "facebook": "facebook", "bluesky": "bluesky", "bsky": "bluesky", "threads": "threads",
    "keybase": "keybase", "reddit": "reddit", "linkedin": "linkedin",
}
_KW = "|".join(sorted(_KEYWORDS, key=len, reverse=True))
_H = r"([A-Za-z0-9_][A-Za-z0-9._\-]{1,38})"
# keyword, then a separator or whitespace, then an explicit @handle ("twitter: @name", "ig @name")
_TEXT_HANDLE_AFTER = re.compile(rf"(?<![\w@./])({_KW})(?:\s*[:=\-\u2013\u2014]\s*|\s+)@{_H}", re.I)
_TEXT_HANDLE_ON = re.compile(rf"(?<![\w.])@{_H}\s+(?:on|at)\s+({_KW})\b", re.I)   # @name on instagram
_BARE_PROFILE_URL = re.compile(r"(?<![\w@./\-])((?:[a-z0-9\-]+\.)+[a-z]{2,}/[^\s<>\"'`,;()\[\]{}]+)", re.I)


def find_bare_profile_urls(text: Any) -> list[str]:
    """Scheme-less profile links such as `github.com/name` on KNOWN platform hosts."""
    if not isinstance(text, str):
        return []
    out = []
    for m in _BARE_PROFILE_URL.findall(text):
        if handle_from_url(m) and m not in out:
            out.append(m)
    return out


def handles_from_text(text: Any) -> list[tuple[str, str]]:
    """(platform, handle) pairs named explicitly in free text."""
    if not isinstance(text, str) or not text:
        return []
    out: list[tuple[str, str]] = []

    def add(keyword: str, handle: str) -> None:
        h = norm_handle(handle)
        pair = (_KEYWORDS[keyword.lower()], h) if h else None
        if pair and pair not in out:
            out.append(pair)

    for kw, handle in _TEXT_HANDLE_AFTER.findall(text):
        add(kw, handle)
    for handle, kw in _TEXT_HANDLE_ON.findall(text):
        add(kw, handle)
    return out


# ----------------------------------------------------------------------------- hashes
def norm_phash(value: Any) -> str | None:
    """64-bit perceptual hash as 16 lower-case hex chars; None for junk or blank images."""
    if isinstance(value, int) and not isinstance(value, bool) and 0 < value < 2**64 - 1:
        return f"{value:016x}"
    if not isinstance(value, str):
        return None
    s = value.strip().lower().removeprefix("0x")
    if len(s) != 16 or any(c not in "0123456789abcdef" for c in s):
        return None
    if s in ("0" * 16, "f" * 16):
        return None
    return s


def hamming_hex(a: str, b: str) -> int:
    return (int(a, 16) ^ int(b, 16)).bit_count()
