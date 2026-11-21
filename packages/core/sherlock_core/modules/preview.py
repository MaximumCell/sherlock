"""Profile previews for found accounts (helper, not a registered module).

`enrich_previews` fetches the PUBLIC profile page of each found account that carries no
profile data yet and reads what the page itself publishes for link previews: Open Graph /
Twitter-card meta, `<title>`, `<link rel="canonical">`, `rel="me"` cross-links and JSON-LD
`Person` / `ProfilePage` blocks. Nothing behind a login is touched: no cookies, no
logged-in sessions, no mobile APIs, no third-party "viewer" sites. A page that answers
anonymous visitors with a login wall, an interstitial or a generic landing page gives no
preview; when in doubt the finding is left untouched.

Called by the worker after identity scans (`jobs._enrich`), before avatar hashing, so a
fetched picture also gets a perceptual hash.

Real-world outcome per platform, checked 2026-11-20 with one anonymous GET of a public
organisational / brand account (browser Accept headers, project UA, no cookies) from the
build machine's connection. Trimmed real responses are test fixtures
(`tests/modules/fixtures/previews/`). Legend: ok = picture + name and/or bio usable;
wall = login / sign-up wall or interstitial, detected and discarded; blocked = HTTP 403/404
for an existing account, a bot challenge or a refused connection; js-only = the HTML has no
profile meta (rendered by JavaScript), so no preview.

    ok       YouTube (meta after ~900 KB, see HOST_MAX_BYTES), Twitch, SoundCloud, Medium
             (redirects to <handle>.medium.com), Instagram, X/Twitter, Facebook (pages),
             Threads (threads.net -> threads.com), Snapchat (/add/<h> -> /@<h>), Spotify,
             Vimeo, Dribbble, Patreon (-> /cw/<h>), About.me, Kaggle, Letterboxd, Goodreads,
             GitHub, GitLab, DEV, Mastodon, Bluesky
    ok, name only   Steam (og:image is the site share image, dropped), Flickr (no og:image)
    wall     Replit (302 to /login), Strava ("Signup for free to see more"),
             Last.fm ("Client Challenge" interstitial)
    blocked  Behance 403, Linktree 403, Tumblr 403, Product Hunt 403, TikTok (WAF page,
             no meta), Reddit (bot page titled "Reddit", no meta);
             Telegram t.me and DeviantArt: TLS timeout / connection reset from this network,
             so not verified either way
    js-only  Pinterest (only og:site_name)
Instagram / X / Facebook answered with real profile meta on this date; they change this
often, which is what the wall gates are for. `PLATFORM_OUTCOMES` holds the same table.
"""
from __future__ import annotations

import asyncio
import contextlib
import copy
import html
import json
import logging
import re
import time
from datetime import UTC, datetime
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import httpx

from sherlock_core.correlation.norm import NON_SOCIAL_PLATFORMS, canonical_platform  # import only
from sherlock_core.modules._util import is_public_http_url
from sherlock_core.modules.base import DEFAULT_UA
from sherlock_core.modules.person_util import coarse_location

log = logging.getLogger(__name__)

# The 2026-11-20 research run (see the module docstring): canonical platform -> outcome.
PLATFORM_OUTCOMES: dict[str, str] = {
    **dict.fromkeys(("youtube", "twitch", "soundcloud", "medium", "instagram", "twitter", "facebook", "threads",
                     "snapchat", "spotify", "vimeo", "dribbble", "patreon", "aboutme", "kaggle", "letterboxd",
                     "goodreads", "github", "gitlab", "devto", "mastodon", "bluesky"), "ok"),
    "steam": "ok (name only)", "flickr": "ok (name only)",
    "replit": "wall", "strava": "wall", "lastfm": "wall",
    **dict.fromkeys(("behance", "linktree", "tumblr", "producthunt", "tiktok", "reddit"), "blocked"),
    "telegram": "unverified (connection failed)", "deviantart": "unverified (connection failed)",
    "pinterest": "js-only",
}

MAX_BYTES = 300_000
# YouTube puts its meta tags after ~900 KB of inline script; the only host allowed a longer read.
HOST_MAX_BYTES = {"youtube.com": 1_200_000}
FETCH_TIMEOUT_S = 8.0
TOTAL_BUDGET_S = 45.0
MAX_REDIRECTS = 4
NAME_MAX, BIO_MAX, TITLE_MAX, LINKS_MAX = 120, 500, 200, 15

# Well-known platforms first when there are more candidates than `limit`.
PRIORITY: tuple[str, ...] = (
    "instagram", "twitter", "facebook", "tiktok", "youtube", "github", "reddit", "twitch", "telegram",
    "threads", "pinterest", "soundcloud", "medium", "steam", "vimeo", "behance", "dribbble", "patreon",
    "linktree", "aboutme", "tumblr", "flickr", "kaggle", "replit", "producthunt", "gitlab", "devto",
    "keybase", "bluesky", "mastodon", "spotify", "lastfm", "letterboxd", "deviantart", "strava",
)

HEADERS = {
    "User-Agent": DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Paths an anonymous visitor is bounced to instead of the profile.
_WALL_PATH = re.compile(
    r"/(?:accounts/)?(?:login|log-in|signin|sign-in|signup|sign-up|register|join|auth|authwall|consent|"
    r"challenge|checkpoint|captcha|i/flow/login|session|cookie-consent)(?:[/?.]|$)", re.I)
_WALL_HOST = re.compile(r"^(?:consent|login|accounts|auth|signin)\.", re.I)
# Titles / descriptions that are a wall, an error or an interstitial, not a profile.
_WALL_TEXT = re.compile(
    r"^\s*(?:log\s?in|login|sign\s?in|sign\s?up|join\b|create an account|welcome to)\b"
    r"|\b(?:log in to (?:see|continue|view)|sign in to (?:see|continue|view)|page not found|not found|"
    r"just a moment|attention required|access denied|are you a robot|verify you are human|"
    r"something went wrong|page isn.t available|isn.t available|user not found|account suspended|"
    r"doesn.t exist|does not exist|no longer available|forbidden|too many requests|security check|"
    r"enable javascript|unsupported browser|captcha|client challenge|checking your browser)\b", re.I)
# Image URL fragments that mark a site-wide default picture rather than a profile picture.
_GENERIC_IMAGE = ("default", "placeholder", "logo", "og-image", "og_image", "ogimage", "social-share",
                  "share-image", "share_image", "opengraph", "favicon", "apple-touch-icon", "brand",
                  "/static/", "/assets/", "/rsrc.php", "fallback", "sharing", "meta-image", "card-image")
_ALWAYS_GENERIC_IMAGE = ("default_profile", "default-avatar", "default_avatar", "defaultavatar", "placeholder",
                         "no-avatar", "noavatar", "no_avatar", "blank-profile", "anonymous-user", "avatar-default")
# Per-host default images seen in the research run (substring match on the image URL).
HOST_DEFAULT_IMAGES: dict[str, tuple[str, ...]] = {
    "x.com": ("abs.twimg.com/",), "twitter.com": ("abs.twimg.com/",),
    "instagram.com": ("static.cdninstagram.com/",), "facebook.com": ("static.xx.fbcdn.net/",),
    "threads.net": ("static.cdninstagram.com/",), "threads.com": ("static.cdninstagram.com/",),
    "tiktok.com": ("/tiktok/webapp/",), "reddit.com": ("redditstatic.com/shreddit/assets/",),
    "linkedin.com": ("static.licdn.com/",), "snapchat.com": ("/web/deeplink/",),
}
# Sites whose canonical URL names the account by a stable id instead of the handle.
ID_CANONICAL: dict[str, re.Pattern[str]] = {
    "youtube.com": re.compile(r"^/channel/UC[\w-]{20,}$"),
    "steamcommunity.com": re.compile(r"^/profiles/\d{17}$"),
}
_TITLE_SEP = re.compile(r"\s+(?:\||-|–|—|•|·|/|::|»)\s+|\s*::\s*|\s*\|\s*")


# ----------------------------------------------------------------------------- parsing
class _PageMeta(HTMLParser):
    """Collects the bits of a page a link preview is made of."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ""
        self.canonical = ""
        self.rel_me: list[str] = []
        self.jsonld: list[str] = []
        self._in_title = False
        self._in_jsonld = False
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "meta":
            key = (a.get("property") or a.get("name") or a.get("itemprop") or "").strip().lower()
            content = a.get("content", "").strip()
            if key and content and key not in self.meta:
                self.meta[key] = content
        elif tag == "title" and not self.title:
            self._in_title, self._buf = True, []
        elif tag in ("link", "a"):
            rel = {r.strip().lower() for r in a.get("rel", "").split()}
            href = a.get("href", "").strip()
            if not href:
                return
            if tag == "link" and "canonical" in rel and not self.canonical:
                self.canonical = href
            if "me" in rel and len(self.rel_me) < 50:
                self.rel_me.append(href)
        elif tag == "script" and "ld+json" in a.get("type", "").lower():
            self._in_jsonld, self._buf = True, []

    def handle_data(self, data: str) -> None:
        if self._in_title or self._in_jsonld:
            self._buf.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title" and self._in_title:
            self.title, self._in_title = "".join(self._buf), False
        elif tag == "script" and self._in_jsonld:
            if len(self.jsonld) < 10:
                self.jsonld.append("".join(self._buf))
            self._in_jsonld = False


def _text(value: Any, cap: int) -> str:
    """Strip tags and entities, collapse whitespace, cap the length."""
    if not isinstance(value, str):
        return ""
    s = re.sub(r"<[^>]+>", " ", html.unescape(value))
    s = " ".join(s.split())
    return s if len(s) <= cap else s[: cap - 1].rstrip() + "…"


def _jsonld_people(blobs: list[str]) -> list[dict[str, Any]]:
    """`Person` objects from JSON-LD blocks (directly, in @graph, or as a ProfilePage mainEntity)."""
    out: list[dict[str, Any]] = []

    def walk(node: Any, depth: int = 0) -> None:
        if depth > 4 or len(out) >= 3:
            return
        if isinstance(node, list):
            for n in node[:20]:
                walk(n, depth + 1)
            return
        if not isinstance(node, dict):
            return
        types = node.get("@type")
        types = {str(t) for t in (types if isinstance(types, list) else [types])}
        if "Person" in types:
            out.append(node)
        for key in ("@graph", "mainEntity", "author", "about"):
            if key in node and ("ProfilePage" in types or key == "@graph"):
                walk(node[key], depth + 1)

    for blob in blobs:
        try:
            walk(json.loads(blob.strip()))
        except (ValueError, RecursionError):
            continue
    return out


def _first_url(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return _first_url(value.get("url") or value.get("contentUrl"))
    if isinstance(value, list) and value:
        return _first_url(value[0])
    return ""


def parse_page(text: str, page_url: str) -> dict[str, Any]:
    """Raw preview fields of one HTML page (no quality gates)."""
    p = _PageMeta()
    try:
        p.feed(text)
        p.close()
    except Exception:  # html.parser is lenient; never let a broken page cost the run
        pass
    m = p.meta
    people = _jsonld_people(p.jsonld)
    person = people[0] if people else {}
    same_as = person.get("sameAs")
    same_as = same_as if isinstance(same_as, list) else [same_as] if isinstance(same_as, str) else []
    addr = person.get("address") if isinstance(person.get("address"), dict) else {}
    country = addr.get("addressCountry")
    country = country.get("name") if isinstance(country, dict) else country
    return {
        "title": _text(p.title, TITLE_MAX),
        "og_title": _text(m.get("og:title") or m.get("twitter:title"), TITLE_MAX),
        "description": _text(m.get("og:description") or m.get("twitter:description") or m.get("description"),
                             BIO_MAX),
        "image": _text(m.get("og:image") or m.get("og:image:url") or m.get("twitter:image")
                       or m.get("twitter:image:src"), 2000),
        "site_name": _text(m.get("og:site_name"), 80),
        "og_type": _text(m.get("og:type"), 40),
        "og_url": _text(m.get("og:url"), 2000),
        "username": _text(m.get("profile:username"), 80),
        "canonical": p.canonical.strip(),
        "rel_me": p.rel_me,
        "ld_name": _text(person.get("name") or person.get("alternateName"), NAME_MAX),
        "ld_description": _text(person.get("description"), BIO_MAX),
        "ld_image": _first_url(person.get("image")),
        "ld_same_as": [s for s in same_as if isinstance(s, str)],
        "ld_location": ", ".join(str(x) for x in (addr.get("addressLocality"), country)
                                 if isinstance(x, str) and x.strip()),
        "url": page_url,
    }


# ----------------------------------------------------------------------------- cleaning and gates
def _host(url: str) -> str:
    try:
        h = (urlsplit(url).hostname or "").lower()
    except ValueError:
        return ""
    return h[4:] if h.startswith("www.") else h


def _site_words(host: str, site_name: str) -> set[str]:
    """Folded names a page uses for its own site ('instagram', 'steamcommunity', 'xformerlytwitter')."""
    labels = host.split(".")
    words = {host, labels[-2] if len(labels) >= 2 else host, site_name}
    platform = canonical_platform(host)
    if platform and "." not in platform:
        words.add(platform)
    if platform == "twitter":
        words |= {"x", "twitter"}
    return {_fold(w) for w in words if w and _fold(w)}


def _fold(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.casefold())


# "Profile of <name>" in a few languages (seen on WhatsMyName sites in the 2026-11-20 smoke run).
_NAME_PREFIX = re.compile(
    r"^(?:profile of|user profile of|личный профиль|профиль(?: пользователя)?|лоты пользователя|"
    r"блог(?: пользователя)?|pliki użytkownika|profil użytkownika|profil von|profil de|perfil de)\s+", re.I)
_NAME_SUFFIX = re.compile(
    r"[’']s\s+(?:\w+\s+)?(?:profile|page|channel|collection|portfolio|account|blog|photos|music)\s*$", re.I)
_GENERIC_PIECES = frozenset({"profile", "home", "userprofile", "overview", "about", "officialsite", "channel",
                             "photosandvideos", "stories", "community"})


def clean_title(title: str, host: str, site_name: str, handle: str) -> str:
    """'NASA (@nasa) • Instagram photos and videos' -> 'NASA'; '' when nothing personal is left."""
    if not title:
        return ""
    site = _site_words(host, site_name)
    t = title
    on_site = re.search(r"\s+on\s+(\S+(?:\s+\S+)?)\s*$", t)       # "NASA (@NASA) on X", "Tony on about.me"
    if on_site and (f := _fold(on_site.group(1))) and any(w == f or w.startswith(f) for w in site):
        t = t[: on_site.start()]
    pieces = [_NAME_PREFIX.sub("", _NAME_SUFFIX.sub("", x.strip())).lstrip("/").strip()
              for x in _TITLE_SEP.split(t) if x and x.strip()]
    name = ""
    for piece in pieces:
        f = _fold(piece)
        if f and f == _fold(handle):
            name = piece
            break
        if not f or f in site or f in _GENERIC_PIECES or any(len(w) > 3 and f.startswith(w) and
                                                             f[len(w):] in _GENERIC_PIECES | {""} for w in site):
            continue
        name = piece
        break
    if handle:  # "(@handle)" / "(handle)" next to the display name
        name = re.sub(r"\s*\(@?" + re.escape(handle) + r"\)\s*", " ", name, flags=re.I)
    name = re.sub(r"\s*\(@[\w.@\-]+\)\s*$", "", name)
    name = " ".join(name.split()).strip(" -|·•:")
    if name.startswith("@") and _fold(name) == _fold(handle):
        name = name[1:]
    if not name or (_fold(name) in site and _fold(name) != _fold(handle)) or _WALL_TEXT.search(name):
        return ""
    return name[:NAME_MAX]


# Auto-generated description text that says nothing about the person (removed, not the whole bio).
_BOILERPLATE = [re.compile(p, re.I) for p in (
    r"^\s*(?:[\d.,]+\s*[KMB]?\s+(?:followers?|following|posts?|threads|likes?|subscribers?|videos?|toots?)"
    r"\s*[,·•\-–]?\s*)+(?:[-–·•]\s*)?",
    r"\bSee Instagram photos and videos from .*$",
    r"\bSee the latest conversations with @\S+\.?\s*$",
    r"^.{0,140}?\.\s*[\d,.]+[KMB]?\s+followers\s*·\s*[\d,.]+[KMB]?\s+talking about this\.\s*",
    r"\b\S+ has \d[\d,]* repositor(?:y|ies) available\.\s*Follow their code on GitHub\.?",
    r"^Read writing from .{1,80}? on Medium\.\s*",
    r"^Get more from .{1,80}? on Patreon\.\s*",
    r"^.{1,80}? is on Snapchat!?\s*$",
    r"^(?:User|Artist|Playlist|Podcast)\s*·\s*Spotify\s*$",
)]


# Descriptions that are the site's own marketing / default text, not something the person wrote.
_GENERIC_BIO = re.compile(
    r"\b(?:just created a page|create (?:a|your) (?:free )?(?:account|page|profile|link)|link in bio|bio link|"
    r"links? to everywhere|is a (?:\w+ )?(?:platform|community|website|site|"
    r"service|network|marketplace|tool)|the world.s (?:leading|largest|most)|official (?:site|website)|"
    r"(?:user|member|developer) profile|profile (?:of|for)|view (?:the )?profile|discover the|"
    r"explore .{0,40}photos|a network for|accessible to all)\b", re.I)


def clean_bio(text: str, site: set[str]) -> str:
    """A description with the site's boilerplate removed; '' when what is left is the site talking.

    Text that names the site itself ("Explore Lungle's 63 photos on Flickr!", "AtCoder is a
    programming contest site ...") is the site describing the page, not the person's bio.
    """
    for rx in _BOILERPLATE:
        text = rx.sub(" ", text)
    text = " ".join(text.split()).lstrip(" -·•.,").rstrip(" -·•,")
    if _fold(text) in site or len(_fold(text)) < 3 or _GENERIC_BIO.search(text):
        return ""
    # the site naming itself early in a short text; a long bio may mention it ("Chief Scientist of Kaggle")
    head = text if len(text) < 120 else text[:80]
    words = re.findall(r"[a-z0-9]+", head.casefold())
    tokens = set(words) | {a + b for a, b in zip(words, words[1:], strict=False)}
    if any(len(w) >= 4 and w in tokens for w in site):
        return ""
    return text[:BIO_MAX]


def _abs_http(url: str, base: str) -> str:
    if not url:
        return ""
    u = urljoin(base, url.strip())
    return u if u.lower().startswith(("http://", "https://")) and is_public_http_url(u) else ""


def is_generic_image(image: str, host: str, handle: str) -> bool:
    """True when `image` looks like the site's own logo / placeholder rather than a profile picture."""
    low = image.lower()
    if any(s in low for s in _ALWAYS_GENERIC_IMAGE):
        return True
    varies = bool(handle) and _fold(handle) and _fold(handle) in _fold(low)
    if varies:
        return False
    for h, marks in HOST_DEFAULT_IMAGES.items():
        if (host == h or host.endswith("." + h)) and any(m in low for m in marks):
            return True
    path = urlsplit(image).path.lower()
    return any(s in path or s in low.split("?")[0] for s in _GENERIC_IMAGE)


def _subdomain_has(host: str, handle: str) -> bool:
    """'netflixtechblog.medium.com' names the account 'netflixtechblog'; 'about.me' names nobody."""
    labels = host.split(".")[:-2]
    return bool(handle) and any(_fold(lab) == _fold(handle) for lab in labels)


def _same_site(a: str, b: str) -> bool:
    ha, hb = _host(a), _host(b)
    if ha.split(".")[-2:] == hb.split(".")[-2:]:
        return True
    pa, pb = canonical_platform(ha), canonical_platform(hb)
    return bool(pa) and pa == pb and "." not in pa             # threads.net -> threads.com, twitter -> x


def _points_at_profile(url: str, profile_url: str, handle: str) -> bool:
    """Whether a canonical / og:url / final URL still names the requested profile."""
    target = urljoin(profile_url, url)
    t, p = urlsplit(target), urlsplit(profile_url)
    if _WALL_PATH.search(t.path or "") or _WALL_HOST.match(t.hostname or ""):
        return False
    if not _same_site(target, profile_url):
        return False
    if _subdomain_has(_host(target), handle):
        return True
    tpath, ppath = (t.path or "/").rstrip("/"), (p.path or "/").rstrip("/")
    if tpath == "" and ppath != "" and not _subdomain_has(_host(profile_url), handle):
        return False                                     # bounced to the site's home page
    if tpath.casefold() == ppath.casefold():
        return True
    if (rx := ID_CANONICAL.get(_host(target).removeprefix("m."))) and rx.match(tpath):
        return True
    fh = _fold(handle)
    return bool(fh) and fh in _fold(t.path)


def gate(raw: dict[str, Any], *, profile_url: str, handle: str, status: int,
         hops: list[str]) -> tuple[dict[str, Any] | None, str]:
    """Apply the quality gates. Returns (clean preview fields, '') or (None, reason)."""
    if status != 200:
        return None, f"HTTP {status}"
    for hop in hops[1:]:
        parts = urlsplit(hop)
        if _WALL_PATH.search(parts.path or "") or _WALL_HOST.match(parts.hostname or ""):
            return None, "redirected to a login / consent page"
    for ref in (raw.get("canonical"), raw.get("og_url")):
        if ref and not _points_at_profile(ref, profile_url, handle):
            return None, "canonical URL no longer points at the profile"
    final = hops[-1] if hops else profile_url
    if not _points_at_profile(final, profile_url, handle):
        return None, "redirected away from the profile"
    for text in (raw.get("title"), raw.get("og_title")):
        if text and _WALL_TEXT.search(text):
            return None, f"wall / error page: {text[:60]!r}"
    desc = raw.get("ld_description") or raw.get("description") or ""
    if desc and _WALL_TEXT.search(desc[:120]):
        return None, f"wall / error page: {desc[:60]!r}"

    host = _host(final)
    site_name = raw.get("site_name") or ""
    site = _site_words(host, site_name)
    name = ""
    for cand in (raw.get("ld_name") or "", clean_title(raw.get("og_title") or "", host, site_name, handle),
                 clean_title(raw.get("title") or "", host, site_name, handle)):
        if cand and (_fold(cand) not in site or _fold(cand) == _fold(handle)) and not _WALL_TEXT.search(cand):
            name = cand
            break
    bio = clean_bio(desc, site) if desc else ""
    image = _abs_http((raw.get("ld_image") or raw.get("image") or "").replace("&amp;", "&"), final)
    if image and is_generic_image(image, host, handle):
        image = ""
    links = []
    for href in [*raw.get("rel_me", []), *raw.get("ld_same_as", [])]:
        u = _abs_http(href, final)
        if u and _host(u) != host and u not in links:
            links.append(u)
    location = coarse_location(raw.get("ld_location")) if raw.get("ld_location") else None
    out = {k: v for k, v in {
        "fullname": name[:NAME_MAX], "bio": bio[:BIO_MAX], "avatar_url": image,
        "location": location, "links": links[:LINKS_MAX],
    }.items() if v}
    if not out:
        return None, "nothing personal on the page"
    if set(out) == {"fullname"} and _fold(name) == _fold(handle):
        return None, "nothing beyond the handle"
    # a description alone is often the site's boilerplate; demand the page names the account
    if set(out) <= {"bio", "links"} and not (_fold(handle) and _fold(handle) in _fold(bio)):
        return None, "only a generic description"
    return {**out, "title": raw.get("title") or raw.get("og_title") or "", "site_name": site_name}, ""


# ----------------------------------------------------------------------------- fetching
class _Blocked(Exception):
    """The host answered 429: skip it for the rest of the run."""


async def fetch_page(http: httpx.AsyncClient, url: str) -> tuple[int, list[str], str]:
    """(status, [url of every hop], html text). Reads at most MAX_BYTES of an HTML answer.

    Redirects are followed by hand so every hop passes `is_public_http_url`.
    """
    hops = [url]
    for _ in range(MAX_REDIRECTS + 1):
        if not is_public_http_url(url):
            return 0, hops, ""
        async with http.stream("GET", url, headers=HEADERS, timeout=FETCH_TIMEOUT_S, follow_redirects=False) as r:
            if r.status_code == 429:
                raise _Blocked(url)
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                url = str(r.url.join(r.headers["location"]))
                hops.append(url)
                continue
            ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
            if r.status_code != 200 or ctype not in ("text/html", "application/xhtml+xml"):
                return (r.status_code if r.status_code != 200 else 415), hops, ""
            cap = HOST_MAX_BYTES.get(_host(url).removeprefix("m."), MAX_BYTES)
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) >= cap:
                    break
            return 200, hops, bytes(buf[:cap]).decode(r.encoding or "utf-8", errors="replace")
    return 0, hops, ""


# ----------------------------------------------------------------------------- selection
def _platform(f: dict[str, Any]) -> str:
    return canonical_platform(f.get("platform") or "")


def _profile_url(f: dict[str, Any]) -> str:
    url = (f.get("extra_metadata") or {}).get("url")
    if not isinstance(url, str) or not url.lower().startswith(("http://", "https://")):
        return ""
    try:
        path = urlsplit(url).path
    except ValueError:
        return ""
    return url if path.strip("/") or "@" in url or (urlsplit(url).hostname or "").count(".") >= 2 else ""


def is_candidate(f: dict[str, Any]) -> bool:
    meta = f.get("extra_metadata") or {}
    extra = meta.get("extra") or {}
    if f.get("status") != "found" or meta.get("summary") or not isinstance(extra, dict):
        return False
    platform = _platform(f)
    if platform in NON_SOCIAL_PLATFORMS or platform in ("web", "dns", "crt.sh", "whois", "rdap", "wayback"):
        return False
    if f.get("identifier_type") not in ("username", "email"):
        return False
    if extra.get("avatar_url") or extra.get("fullname") or extra.get("bio") or extra.get("preview"):
        return False
    return bool(_profile_url(f))


def _handle(f: dict[str, Any]) -> str:
    extra = (f.get("extra_metadata") or {}).get("extra") or {}
    if f.get("identifier_type") == "username":
        return str(f.get("identifier_value") or "").lstrip("@")
    if isinstance(extra.get("username"), str):
        return extra["username"]
    segs = [s for s in urlsplit(_profile_url(f)).path.split("/") if s]
    return segs[-1].lstrip("@") if segs else ""


def select_candidates(findings: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Candidates in a deterministic order: priority platforms first, then by platform name."""
    cands = [f for f in findings if is_candidate(f)]

    def key(f: dict[str, Any]) -> tuple[int, str, str]:
        p = _platform(f)
        return (PRIORITY.index(p) if p in PRIORITY else len(PRIORITY), p, _profile_url(f))

    seen: set[str] = set()
    out = []
    for f in sorted(cands, key=key):
        url = _profile_url(f)
        if url in seen:
            continue
        seen.add(url)
        out.append(f)
    return out[: max(0, limit)]


# ----------------------------------------------------------------------------- entry point
def _merge(f: dict[str, Any], fields: dict[str, Any], fetched_at: str, final_url: str) -> dict[str, Any] | None:
    updated = copy.deepcopy(f)
    extra = updated["extra_metadata"].setdefault("extra", {})
    gained = False
    for key in ("avatar_url", "fullname", "bio", "location"):
        if fields.get(key) and not extra.get(key):
            extra[key] = fields[key]
            gained = True
    if fields.get("links"):
        have = [x.strip() for x in str(extra.get("links") or "").split(",") if x.strip()]
        new = [u for u in fields["links"] if u not in have]
        if new:
            extra["links"] = ", ".join([*have, *new][:LINKS_MAX + len(have)])
            gained = True
    if not gained:
        return None
    extra["preview"] = {
        "source": "page-meta", "fetched_at": fetched_at, "url": final_url,
        "title": (fields.get("title") or "")[:TITLE_MAX], "site_name": fields.get("site_name") or "",
    }
    return updated


async def enrich_previews(findings: list[dict[str, Any]], http: httpx.AsyncClient, *,
                          limit: int = 40, concurrency: int = 6,
                          budget_s: float = TOTAL_BUDGET_S,
                          report: dict[str, str] | None = None,
                          shared: asyncio.Semaphore | None = None) -> list[dict[str, Any]]:
    """Return updated copies of the found account findings that gained preview data.

    See the module docstring. Best effort: a page that fails, is walled, times out or is
    generic is skipped silently. Findings that gained nothing are not returned.
    `report`, when given, receives {profile url: reason} for every page that gave no preview.
    `shared`, when given, is the worker-wide download limiter (shared with other jobs).
    """
    todo = select_candidates(findings, limit)
    if not todo:
        return []
    started = time.monotonic()
    sem = asyncio.Semaphore(max(1, concurrency))
    host_locks: dict[str, asyncio.Lock] = {}
    blocked: set[str] = set()
    results: dict[int, tuple[dict[str, Any], str, str]] = {}
    self_report: dict[str, str] = report if report is not None else {}

    async def one(i: int, f: dict[str, Any]) -> None:
        url = _profile_url(f)
        host = _host(url)
        lock = host_locks.setdefault(host, asyncio.Lock())
        # one request per host at a time, a few hosts in parallel, within the worker-wide limit
        async with lock, sem, shared or contextlib.nullcontext():
            if host in blocked or time.monotonic() - started > budget_s:
                return
            try:
                status, hops, text = await asyncio.wait_for(fetch_page(http, url), FETCH_TIMEOUT_S + 2)
            except _Blocked:
                blocked.add(host)
                self_report[url] = "rate limited (429)"
                return
            except (httpx.HTTPError, TimeoutError, UnicodeError, ValueError, LookupError) as e:
                self_report[url] = type(e).__name__
                return
        raw = parse_page(text, hops[-1]) if text else {}
        fields, reason = gate(raw, profile_url=url, handle=_handle(f), status=status, hops=hops)
        if fields is None:
            self_report[url] = reason
            log.info("preview %s skipped: %s", url, reason)
            return
        results[i] = (fields, datetime.now(UTC).isoformat(), hops[-1])

    tasks = [asyncio.ensure_future(one(i, f)) for i, f in enumerate(todo)]
    done, pending = await asyncio.wait(tasks, timeout=budget_s)
    for t in pending:
        t.cancel()
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    for t in done:
        if t.exception() is not None:
            log.info("preview task failed: %r", t.exception())

    # an image shared by different accounts on one host is the site's default picture
    by_host: dict[tuple[str, str], set[str]] = {}
    for i, (fields, _, final) in results.items():
        if fields.get("avatar_url"):
            by_host.setdefault((_host(final), fields["avatar_url"]), set()).add(_handle(todo[i]).casefold())
    out = []
    for i in sorted(results):
        fields, fetched_at, final = results[i]
        if len(by_host.get((_host(final), fields.get("avatar_url", "")), ())) > 1:
            fields = {k: v for k, v in fields.items() if k != "avatar_url"}
        if row := _merge(todo[i], fields, fetched_at, final):
            out.append(row)
    return out
