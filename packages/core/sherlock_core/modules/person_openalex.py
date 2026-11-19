"""OpenAlex author records for a personal name (public scholarly record).

Verified 2026-11-20 with a real request for "Tim Berners-Lee" (trimmed into
tests/person/fixtures/openalex_authors.json):
  GET https://api.openalex.org/authors?search=<name>&per-page=5
      -> results[]: id, display_name (may contain U+2010 hyphens), display_name_alternatives,
         orcid, works_count, cited_by_count, summary_stats.h_index,
         last_known_institutions[]{display_name, country_code}, affiliations[]{institution, years},
         topics[]{display_name}
Quota: keyless requests share a free daily budget of $0.10 per IP address (one author search
is billed $0.001, reported in `meta.cost_usd`). A free `OPENALEX_API_KEY` (optional) has its
own $1 / day. One request per job.
Co-authors are deliberately not collected: they are other people, not this person's footprint.
"""
from __future__ import annotations

import os
from typing import Any

from sherlock_core.modules import register
from sherlock_core.modules._util import clean, describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.person_util import MIN_NAME_SCORE, name_gate, person_extra
from sherlock_core.resolve.names import match_name

API = "https://api.openalex.org"
MAX_AUTHORS = 3


def _params(**kw: Any) -> dict[str, Any]:
    key = os.getenv("OPENALEX_API_KEY", "").strip()
    return {**kw, "api_key": key} if key else kw


def _short_id(url: Any) -> str:
    return str(url or "").rstrip("/").rsplit("/", 1)[-1]


@register
class PersonOpenAlex(Module):
    name = "person_openalex"
    title = "Scholarly record (OpenAlex)"
    description = (
        "Researchers with this name in the OpenAlex index: publication count, institutions, ORCID "
        "and research topics."
    )
    inputs = ("name",)
    queue = "identity"
    source_url = "https://docs.openalex.org/api-entities/authors"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        r = await ctx.http.get(f"{API}/authors", params=_params(search=target.value, **{"per-page": 5}),
                               timeout=20.0)
        if r.status_code != 200:
            return [error_finding(ctx, self, target, "openalex", describe_http_error(r))]
        data = json_or_none(r)
        authors = [a for a in (data or {}).get("results") or [] if isinstance(a, dict) and a.get("id")]
        kept = []
        for a in authors:
            names = [a.get("display_name"), *(a.get("display_name_alternatives") or [])]
            match, _ = name_gate(target.value, names)
            if match.score >= MIN_NAME_SCORE:
                kept.append(a)
        kept = kept[:MAX_AUTHORS]
        await ctx.progress(50, f"{len(kept)} author record(s)")

        return [self._finding(a, target, ctx) for a in kept]

    def _finding(self, a: dict[str, Any], target: Target, ctx: ModuleContext) -> dict[str, Any]:
        aid = _short_id(a["id"])
        orcid = _short_id(a.get("orcid")) if a.get("orcid") else None
        affiliations = sorted(
            (x for x in a.get("affiliations") or [] if isinstance(x, dict) and x.get("institution")),
            key=lambda x: max(x.get("years") or [0]), reverse=True)
        last = [i for i in a.get("last_known_institutions") or [] if isinstance(i, dict)]
        employers = [i.get("display_name") for i in last] + [x["institution"].get("display_name") for x in affiliations]
        countries = [i.get("country_code") for i in last if i.get("country_code")]
        topics = [t.get("display_name") for t in a.get("topics") or [] if isinstance(t, dict)][:6]
        # spellings that are real variants of this person's name, not catalogue noise
        aliases = [n for n in a.get("display_name_alternatives") or []
                   if isinstance(n, str) and match_name(a.get("display_name") or "", n).score >= 0.8]
        extra = person_extra(
            fullname=a.get("display_name") or target.value,
            aliases=aliases,
            ids={"openalex": aid, "orcid": orcid},
            employers=employers[:6],
            locations=countries[:2],
            topics=topics,
            links=[f"https://orcid.org/{orcid}"] if orcid else [],
            works_count=a.get("works_count"),
            cited_by_count=a.get("cited_by_count"),
            h_index=(a.get("summary_stats") or {}).get("h_index"),
            orcid=orcid,
            research_topics=", ".join(topics) or None,
        )
        return ctx.finding(self, target, platform="openalex", url=f"https://openalex.org/{aid}",
                           extra=clean(extra), discriminator=aid)
