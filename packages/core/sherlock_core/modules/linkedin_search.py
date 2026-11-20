"""LinkedIn profiles through PUBLIC web-search results (never linkedin.com itself).

LinkedIn blocks automated access and its terms forbid scraping, so this module only reads
what a search engine shows anyone: the result title, snippet, URL and (SerpApi only,
sometimes) a thumbnail. linkedin.com is never requested.

Search layer (`sherlock_core.search`): SerpApi when `SERPAPI_KEY` is set, else the keyless
`ddgs` fallback; unavailable when neither is. At most 2 upstream queries per run (cached):

    username   site:linkedin.com/in "<username>"
               (second query only when nothing matched and the username has . or _:
               the same with those replaced by "-", LinkedIn's slug separator)
    name       site:linkedin.com/in "<Full Name>" <city / employer / school hints>
               (second query without the hints only when the first matched nothing)

Username scans emit `found` rows only for hits whose URL slug IS the username or contains
it as a whole "-"-separated token (`maximumcell`, `maximumcell-1a2b3c`). Name scans emit
person-module candidates (`candidate_hint`, see `person_util.person_extra`) for hits whose
title names the person. At most 5 rows. Each row carries
`extra.preview = {"source": "search-snippet", ...}` so the UI can say "from search results".

Result shapes, checked 2026-11-20 with real keyless (`ddgs` 9.16.1, Bing backend) calls for
public figures (`tests/person/fixtures/linkedin_ddgs.json`, trimmed to their own rows):
  * titles look like "Satya Nadella - Chairman and CEO at Microsoft | LinkedIn",
    "Reid Hoffman - Co-Founder, LinkedIn, Manas AI & ..." or, localised without a headline,
    "<Name> – <City>, <Region>, <Country> | Berufliches Profil";
  * snippets look like "<headline> · Experience: X · Education: Y · Location: Z · 500+
    connections on LinkedIn ..." (localised: "Sted:", "Ort:", "Lieu:", ...);
  * the Bing backend sometimes CONCATENATES the titles and snippets of the following
    results onto the first hit ("... | LinkedInR Stephen ...", "... & ...Reid Hoffman - ...").
    Such a title is cut at its first "| LinkedIn" / "..." and its snippet is ignored, since
    it describes other people.
  * `site:linkedin.com/in "Satya Nadella"` returned "No results" on both backends while the
    slug query worked: keyless results are thin and unstable.
"""
from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any
from urllib.parse import unquote, urlsplit

from sherlock_core import search as websearch
from sherlock_core.modules import register
from sherlock_core.modules._util import error_finding
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.person_util import coarse_location, hints_of, person_extra
from sherlock_core.resolve.names import match_name
from sherlock_core.search import BudgetedSearch, SearchBudgetExceeded, SearchError, SearchHit, is_denied

MAX_RESULTS = 5
MAX_QUERIES = 2
MIN_NAME_SCORE = 0.5

_SLUG = re.compile(r"^/in/([^/?#]+)/?$")
_POLLUTED = re.compile(r"(?:\|\s*LinkedIn|\.\.\.|…)\s*\S")           # text continues after an end marker
_TITLE_END = re.compile(r"\s*(?:\|\s*LinkedIn\b|\.\.\.|…).*$", re.S)
_TITLE_SPLIT = re.compile(r"\s+[-–—]\s+")
_PROFILE_SUFFIX = re.compile(r"\s*\|\s*([^|]*)$")
_FIELD = re.compile(
    r"(?:^|·)\s*(Experience|Berufserfahrung|Expérience|Experiencia|Experiência|Esperienza|Ervaring|Erfaring|"
    r"Education|Ausbildung|Formation|Educación|Formação|Formazione|Opleiding|Utdanning|"
    r"Location|Ort|Lieu|Ubicación|Localização|Località|Locatie|Sted|Plats|Lokalizacja)\s*:\s*([^·]+?)\s*(?=·|$)",
    re.I)
_EXPERIENCE = {"experience", "berufserfahrung", "expérience", "experiencia", "experiência", "esperienza",
               "ervaring", "erfaring"}
_EDUCATION = {"education", "ausbildung", "formation", "educación", "formação", "formazione", "opleiding",
              "utdanning"}
_AT_EMPLOYER = re.compile(r"\s(?:at|@|bei|chez|en|na|presso|bij|hos)\s+([^|,·]{2,80})$", re.I)
_CONNECTIONS = re.compile(r"\b\d[\d,.]*\+?\s+(?:connections|followers|Kontakte|relations|contactos|forbindelser)\b"
                          r"|\bView .{1,80}?(?:’|')s profile on LinkedIn.*$", re.I)


# ----------------------------------------------------------------------------- parsing
def slug_of(url: str) -> str:
    """'https://uk.linkedin.com/in/ada-lovelace-1a2b3c/' -> 'ada-lovelace-1a2b3c' ('' when not a profile)."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return ""
    host = (parts.hostname or "").lower()
    if not (host == "linkedin.com" or host.endswith(".linkedin.com")):
        return ""
    m = _SLUG.match(parts.path or "")
    return unquote(m.group(1)).strip().lower() if m else ""


def slug_matches(slug: str, username: str) -> bool:
    """The slug is the username, or contains it as a whole '-'-separated token."""
    s, u = slug.lower(), username.lower().lstrip("@")
    if not s or not u:
        return False
    forms = {u, re.sub(r"[._]+", "-", u)}                     # LinkedIn slugs use "-" where handles use . or _
    return any(s == f or s.startswith(f + "-") or s.endswith("-" + f) or f"-{f}-" in s for f in forms)


def parse_hit(hit: SearchHit) -> dict[str, Any]:
    """{name, headline, employer, education, location, polluted} from one result (missing parts absent)."""
    raw_title = " ".join((hit.title or "").split())
    polluted = bool(_POLLUTED.search(raw_title))
    suffix_m = _PROFILE_SUFFIX.search(_TITLE_END.sub("", raw_title) if polluted else raw_title)
    suffix = (suffix_m.group(1) if suffix_m else "").strip()
    title = _TITLE_END.sub("", raw_title)
    title = _PROFILE_SUFFIX.sub("", title).strip(" &,-–—|")
    parts = [p.strip(" &,") for p in _TITLE_SPLIT.split(title) if p.strip(" &,")]
    out: dict[str, Any] = {"polluted": polluted}
    if not parts:
        return out
    out["name"] = parts[0]
    location_title = bool(suffix) and suffix.lower() != "linkedin" and "profil" in suffix.lower()
    if len(parts) > 1:
        if location_title:                                   # "<Name> – Thalwil, Zürich, Schweiz | Berufliches Profil"
            if loc := coarse_location(parts[1]):
                out["location"] = loc
        else:
            out["headline"] = parts[1]
    if len(parts) > 2 and not location_title:
        out["employer"] = parts[2]
    if not polluted:                                         # a polluted snippet describes other people too
        for key, value in _FIELD.findall(hit.snippet or ""):
            value = _CONNECTIONS.sub("", value).strip(" .")
            k = key.lower()
            if not value:
                continue
            if k in _EXPERIENCE:
                out.setdefault("employer", value)
            elif k in _EDUCATION:
                out.setdefault("education", value)
            elif loc := coarse_location(value):
                out.setdefault("location", loc)
    if "employer" not in out and (m := _AT_EMPLOYER.search(out.get("headline", ""))):
        out["employer"] = m.group(1).strip(" .")
    return out


def _snippet(hit: SearchHit, polluted: bool) -> str:
    if polluted:
        return ""
    s = _CONNECTIONS.sub("", " ".join((hit.snippet or "").split())).strip(" ·.")
    return s[:400]


# ----------------------------------------------------------------------------- module
@register
class LinkedInSearch(Module):
    name = "linkedin_search"
    title = "LinkedIn (via public search results)"
    description = (
        "Finds LinkedIn profiles for a username or a name through public web-search results "
        "(title, snippet and URL only; linkedin.com itself is never fetched)."
    )
    inputs = ("username", "name")
    queue = "identity"
    source_url = "https://www.linkedin.com/"
    timeout_s = 90.0

    def available(self) -> bool:
        return websearch.provider_available()

    def queries(self, target: Target) -> list[str]:
        if target.type == "username":
            u = target.value.strip().lstrip("@").replace('"', "")
            qs = [f'site:linkedin.com/in "{u}"']
            if re.search(r"[._]", u):
                qs.append(f'site:linkedin.com/in "{re.sub(r"[._]+", "-", u)}"')
            return qs
        name = " ".join(target.value.replace('"', " ").split())
        hints = hints_of(target)
        terms = [hints.get("city"), hints.get("employer"), hints.get("school")]
        terms = [f'"{t}"' if " " in t else t for t in terms if t]
        qs = [f'site:linkedin.com/in "{name}" {" ".join(terms)}'.strip()]
        if terms:
            qs.append(f'site:linkedin.com/in "{name}"')
        return qs

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        provider = websearch.get_provider(ctx.http)
        if provider is None:
            return [error_finding(ctx, self, target, "linkedin", "no web search provider is configured")]
        search = BudgetedSearch(provider, max_queries=MAX_QUERIES)
        rows: dict[str, dict[str, Any]] = {}
        errors: list[str] = []
        for i, query in enumerate(self.queries(target)[:MAX_QUERIES]):
            if rows:
                break                                        # the second query is only a fallback
            try:
                hits = await search.search(query, num=10)
            except SearchBudgetExceeded:
                break
            except SearchError as e:
                errors.append(str(e))
                continue
            await ctx.progress(50 * (i + 1), f"{len(hits)} search result(s)")
            for hit in hits:
                row = self._finding(hit, query, target, ctx)
                if row and row["finding_key"] not in rows and len(rows) < MAX_RESULTS:
                    rows[row["finding_key"]] = row
        if not rows and errors:
            return [error_finding(ctx, self, target, "linkedin", errors[0])]
        return list(rows.values())

    def _finding(self, hit: SearchHit, query: str, target: Target, ctx: ModuleContext) -> dict[str, Any] | None:
        if is_denied(hit.url):
            return None
        slug = slug_of(hit.url)
        if not slug:
            return None
        fields = parse_hit(hit)
        name = fields.get("name") or ""
        if target.type == "username":
            if not slug_matches(slug, target.value):
                return None
        elif not name or match_name(target.value, name).score < MIN_NAME_SCORE:
            return None                                       # someone else's profile that mentions the name
        url = f"https://www.linkedin.com/in/{slug}"
        thumb = hit.thumbnail if hit.thumbnail.lower().startswith(("https://", "http://")) else ""
        preview = {
            "source": "search-snippet", "provider": hit.source, "query": query,
            "fetched_at": datetime.now(UTC).isoformat(), "title": hit.title[:200],
        }
        extra = person_extra(
            fullname=name[:120] if name else "", kind="profile", handles={"linkedin": slug},
            employers=[fields["employer"]] if fields.get("employer") else None,
            education=[fields["education"]] if fields.get("education") else None,
            locations=[fields["location"]] if fields.get("location") else None,
            description=fields.get("headline") or None,
            headline=fields.get("headline"), avatar_url=thumb or None, handle=slug,
            snippet=_snippet(hit, fields["polluted"]) or None, profile_platform="linkedin",
            result_kind="profile", preview=preview,
        )
        if not extra.get("fullname"):
            extra.pop("candidate_hint", None)
        return ctx.finding(
            self, target, platform="linkedin", url=url, extra=extra,
            meta={"result_kind": "profile", "search_provider": hit.source}, discriminator=slug,
        )
