"""Open-web search for a personal name: public profiles, news and mentions.

Uses the search layer (`sherlock_core.search`): SerpApi when `SERPAPI_KEY` is set, otherwise
the keyless `ddgs` fallback when that package is installed; unavailable when neither is.
At most 8 upstream queries per job (`SEARCH_MAX_QUERIES_PER_JOB`):

    "Full Name" <hint terms>                 "Full Name" site:linkedin.com/in
    "Full Name" site:github.com              "Full Name" (site:x.com OR site:twitter.com)
    "Full Name" site:medium.com              "Full Name" site:scholar.google.com
    "Full Name" news                         "Full Name"            (only when hints were given)

Each hit becomes one `web` finding classified as
    profile   an account page on a known platform (platform + handle are extracted),
    news      a page on a news site or from the news query,
    mention   any other page that names the person.
Hits that do not contain the name are dropped, and so is every people-search / data-broker
site (`search.denylist`): those are never a source. Only the result title, snippet and URL
are stored; pages are not fetched.
"""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from sherlock_core import search as websearch
from sherlock_core.modules import register
from sherlock_core.modules._util import error_finding
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.person_util import coarse_location, hints_of, person_extra
from sherlock_core.resolve.names import match_name, text_mentions_name
from sherlock_core.search import BudgetedSearch, SearchBudgetExceeded, SearchError, SearchHit, is_denied

try:  # normalisation helpers of the correlation engine (same canonical platform names)
    from sherlock_core.correlation import norm as _norm
except ImportError:  # pragma: no cover - correlation always ships with core
    _norm = None  # type: ignore[assignment]

MAX_FINDINGS = 40
NEWS_HOSTS = frozenset({
    "bbc.com", "bbc.co.uk", "nytimes.com", "theguardian.com", "reuters.com", "apnews.com", "bloomberg.com",
    "wsj.com", "ft.com", "washingtonpost.com", "cnn.com", "forbes.com", "techcrunch.com", "wired.com",
    "theverge.com", "arstechnica.com", "economist.com", "npr.org", "aljazeera.com", "cnbc.com", "time.com",
    "independent.co.uk", "telegraph.co.uk", "politico.com", "axios.com", "theregister.com", "zdnet.com",
    "news.ycombinator.com", "businessinsider.com", "latimes.com", "usatoday.com", "dw.com", "france24.com",
    "news.google.com", "thetimes.co.uk", "dawn.com", "thehindu.com", "scmp.com", "abc.net.au", "cbc.ca",
})
_NEWS_PATH = re.compile(r"/(news|article|articles|story|stories|press|press-release)s?/|/20\d\d/\d\d/", re.I)
_TITLE_SPLIT = re.compile(r"\s+[-–—|·•:]\s+|\s*\|\s*")
_SNIPPET_FIELD = re.compile(r"\b(Experience|Education|Location):\s*([^·|\n]+?)\s*(?:·|\||$)", re.I)
_AT_EMPLOYER = re.compile(r"\b(?:at|@)\s+([A-Z][\w&.,'\- ]{1,60})$")


def build_queries(name: str, hints: dict[str, Any]) -> list[tuple[str, str]]:
    """(label, query) pairs, most valuable first; the budget may cut the tail."""
    quoted = '"' + " ".join(name.replace('"', " ").split()) + '"'
    terms = [hints.get("employer"), hints.get("city"), hints.get("school"), *(hints.get("keywords") or [])]
    terms = [f'"{t}"' if " " in t else t for t in terms if t][:4]
    queries = [("general", f"{quoted} {' '.join(terms)}".strip())]
    queries += [
        ("linkedin", f"{quoted} site:linkedin.com/in"),
        ("github", f"{quoted} site:github.com"),
        ("twitter", f"{quoted} (site:x.com OR site:twitter.com)"),
        ("news", f"{quoted} news"),
        ("scholar", f"{quoted} site:scholar.google.com"),
        ("medium", f"{quoted} site:medium.com"),
    ]
    if terms:
        queries.append(("plain", quoted))
    return queries


def profile_of(url: str) -> tuple[str, str] | None:
    """(platform, handle) when `url` is an account's own profile page on a known platform."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    host = (parts.hostname or "").lower()
    segs = [s for s in parts.path.split("/") if s]
    if host == "scholar.google.com" or host.startswith("scholar.google."):
        user = dict(parse_qsl(parts.query)).get("user")
        return ("googlescholar", user) if segs[:1] == ["citations"] and user else None
    if _norm is None:
        return None
    if host.endswith(".linkedin.com"):                     # country hosts: in.linkedin.com, uk.linkedin.com
        url = url.replace(host, "www.linkedin.com", 1)
        host = "www.linkedin.com"
    pair = _norm.handle_from_url(url)
    if not pair:
        return None
    platform = pair[0]
    depth = 2 if platform in ("linkedin", "reddit", "youtube") else 1
    return pair if len(segs) <= depth else None           # deeper paths are content, not the profile


def classify(hit: SearchHit, label: str) -> str:
    if profile_of(hit.url):
        return "profile"
    try:
        parts = urlsplit(hit.url)
    except ValueError:
        return "mention"
    host = (parts.hostname or "").lower().removeprefix("www.")
    if host in NEWS_HOSTS or any(host.endswith("." + h) for h in NEWS_HOSTS) or _NEWS_PATH.search(parts.path or ""):
        return "news"
    if label == "news" and "news" in f"{host}{parts.path}".lower():
        return "news"
    return "mention"


def name_in_title(name: str, title: str) -> str:
    """The piece of a result title that is the person's name ('' when none is)."""
    pieces = [p.strip() for p in _TITLE_SPLIT.split(title) if p.strip()]
    pieces += re.findall(r"\(([^)]+)\)", title)
    best, best_score = "", 0.0
    for p in pieces:
        s = match_name(name, p).score
        if s > best_score:
            best, best_score = p, s
    return best if best_score >= 0.5 else ""


def profile_fields(hit: SearchHit) -> dict[str, Any]:
    """Employer / education / location a profile result states about itself, when recognisable."""
    out: dict[str, list[str]] = {"employers": [], "education": [], "locations": []}
    for key, value in _SNIPPET_FIELD.findall(hit.snippet or ""):
        value = value.strip(" .")
        if key.lower() == "experience":
            out["employers"].append(value)
        elif key.lower() == "education":
            out["education"].append(value)
        elif loc := coarse_location(value):
            out["locations"].append(loc)
    pieces = [p.strip() for p in _TITLE_SPLIT.split(hit.title or "") if p.strip()]
    headline = pieces[1] if len(pieces) > 1 else ""
    if (m := _AT_EMPLOYER.search(headline)) and not out["employers"]:
        out["employers"].append(m.group(1).strip(" ."))
    return {**out, "headline": headline}


@register
class PersonWeb(Module):
    name = "person_web"
    title = "Web search (profiles, news, mentions)"
    description = (
        "Searches the open web for the name: public profile pages (LinkedIn, GitHub, X, Medium, "
        "Google Scholar), news and other mentions. People-search and data-broker sites are excluded."
    )
    inputs = ("name",)
    queue = "identity"
    source_url = "https://serpapi.com/search-api"
    timeout_s = 150.0

    def available(self) -> bool:
        return websearch.provider_available()

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        provider = websearch.get_provider(ctx.http)
        if provider is None:
            return [error_finding(ctx, self, target, "web", "no web search provider is configured")]
        search = BudgetedSearch(provider)
        name, hints = target.value, hints_of(target)
        queries = build_queries(name, hints)
        seen: dict[str, dict[str, Any]] = {}
        errors: list[str] = []
        for i, (label, query) in enumerate(queries):
            try:
                hits = await search.search(query, num=10)
            except SearchBudgetExceeded:
                break
            except SearchError as e:
                errors.append(str(e))
                if len(errors) >= 2 and not seen:       # the provider is down; stop spending time
                    break
                continue
            await ctx.progress(int(90 * (i + 1) / len(queries)), f"{label}: {len(hits)} result(s)")
            for hit in hits:
                row = self._finding(hit, label, name, target, ctx)
                if row and row["finding_key"] not in seen and len(seen) < MAX_FINDINGS:
                    seen[row["finding_key"]] = row
        if not seen and errors:
            return [error_finding(ctx, self, target, "web", errors[0])]
        return list(seen.values())

    def _finding(self, hit: SearchHit, label: str, name: str, target: Target,
                 ctx: ModuleContext) -> dict[str, Any] | None:
        if is_denied(hit.url) or not hit.url.lower().startswith(("http://", "https://")):
            return None
        if not text_mentions_name(name, f"{hit.title} {hit.snippet}"):
            return None
        kind = classify(hit, label)
        key = (_norm.norm_url(hit.url) if _norm else None) or hit.url
        title_name = name_in_title(name, hit.title)
        meta = {"result_kind": kind, "query": label, "search_provider": hit.source}
        if kind == "profile":
            platform, handle = profile_of(hit.url)  # type: ignore[misc]
            if not title_name:
                return None       # a profile page that merely mentions the name is someone else's account
            fields = profile_fields(hit)
            extra = person_extra(
                fullname=title_name, kind="profile", handles={platform: handle},
                employers=fields["employers"], education=fields["education"], locations=fields["locations"],
                description=(fields["headline"] or hit.snippet)[:300] or None,
                title=hit.title[:200], snippet=hit.snippet[:400], profile_platform=platform, result_kind=kind,
            )
        else:
            extra = person_extra(
                fullname=title_name or name, kind=kind,   # no `bio`: a snippet is about the page, not a profile
                title=hit.title[:200], snippet=hit.snippet[:400], result_kind=kind,
            )
        return ctx.finding(self, target, platform="web", url=hit.url, extra=extra, meta=meta, discriminator=key)
