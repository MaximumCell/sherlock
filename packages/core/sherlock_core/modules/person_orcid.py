"""ORCID public records for a personal name (self-published researcher profiles).

Verified 2026-11-19 and 2026-11-20 with real requests for "Tim Berners-Lee" (keyless public API;
trimmed into tests/person/fixtures/orcid_*.json):
  GET https://pub.orcid.org/v3.0/expanded-search/?q=<lucene>&rows=5      Accept: application/json
      -> {"expanded-result": [{orcid-id, given-names, family-names, credit-name, other-name[],
          institution-name[]}], "num-found": n}
      A quoted hyphenated family name with an exact given name finds nothing when the record
      says "Timothy", so the query is `family-name:"Berners-Lee" AND given-names:Tim*`
      (plus credit-name / other-names phrases).
  GET https://pub.orcid.org/v3.0/<orcid>/record
      -> person.name, person.other-names, person.researcher-urls, person.keywords,
         person.addresses (country only), activities-summary.employments / educations
         (affiliation-group[].summaries[].employment-summary.organization{name, address{city, country}})
Quota: public API, no key; ORCID asks for at most 24 requests / second per IP.
Only fields the record owner (or their institution) made public are returned by this API.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from sherlock_core.modules import register
from sherlock_core.modules._util import describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.person_util import MIN_NAME_SCORE, join_place, name_gate, person_extra
from sherlock_core.resolve.names import fold

API = "https://pub.orcid.org/v3.0"
HEADERS = {"Accept": "application/json"}
MAX_RECORDS = 3
_LUCENE_UNSAFE = re.compile(r'[+\-&|!(){}\[\]^"~*?:\\/]')


def _term(text: str) -> str:
    return " ".join(_LUCENE_UNSAFE.sub(" ", text).split())


def build_query(name: str) -> str:
    """Lucene query for a full name: family name exact, given name as a prefix, or a credit-name phrase."""
    words = [w for w in re.split(r"[\s,]+", name.strip()) if w]
    phrase = _term(name)
    if len(words) < 2:
        return f'family-name:"{phrase}" OR given-names:"{phrase}" OR credit-name:"{phrase}"'
    given, family = _term(words[0]), _term(words[-1])
    given_prefix = fold(given).split(" ")[0]
    clauses = [f'(family-name:"{family}" AND given-names:{given_prefix}*)',
               f'credit-name:"{phrase}"', f'other-names:"{phrase}"']
    return " OR ".join(clauses)


def _val(node: Any) -> str:
    return str(node.get("value") or "").strip() if isinstance(node, dict) else ""


def _year(node: Any) -> str:
    return _val((node or {}).get("year")) if isinstance(node, dict) else ""


def _affiliations(section: Any, key: str) -> list[dict[str, str]]:
    out = []
    for group in (section or {}).get("affiliation-group") or []:
        for s in (group or {}).get("summaries") or []:
            item = (s or {}).get(key) or {}
            org = item.get("organization") or {}
            if not org.get("name"):
                continue
            addr = org.get("address") or {}
            out.append({
                "organization": str(org["name"]), "role": str(item.get("role-title") or ""),
                "department": str(item.get("department-name") or ""),
                "start": _year(item.get("start-date")), "end": _year(item.get("end-date")),
                "place": join_place(addr.get("city"), addr.get("country")) or "",
            })
    return out


def _line(a: dict[str, str]) -> str:
    years = f"{a['start'] or '?'}-{a['end'] or 'present'}" if a["start"] or a["end"] else ""
    bits = [a["role"], a["organization"], years]
    return ", ".join(b for b in bits if b)


@register
class PersonOrcid(Module):
    name = "person_orcid"
    title = "ORCID researcher profiles"
    description = (
        "Public ORCID records with this name: the employments, education, websites and keywords "
        "the researcher (or their institution) published."
    )
    inputs = ("name",)
    queue = "identity"
    source_url = "https://info.orcid.org/documentation/api-tutorials/api-tutorial-searching-the-orcid-registry/"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        r = await ctx.http.get(f"{API}/expanded-search/", params={"q": build_query(target.value), "rows": 8},
                               headers=HEADERS, timeout=20.0)
        if r.status_code != 200:
            return [error_finding(ctx, self, target, "orcid", describe_http_error(r))]
        hits = []
        for h in (json_or_none(r) or {}).get("expanded-result") or []:
            if not isinstance(h, dict) or not h.get("orcid-id"):
                continue
            names = [f"{h.get('given-names') or ''} {h.get('family-names') or ''}", h.get("credit-name"),
                     *(h.get("other-name") or [])]
            match, _ = name_gate(target.value, names)
            if match.score >= MIN_NAME_SCORE:
                hits.append((match.score, h))
        hits = [h for _, h in sorted(hits, key=lambda x: -x[0])][:MAX_RECORDS]
        await ctx.progress(40, f"{len(hits)} ORCID record(s)")
        sem = asyncio.Semaphore(min(ctx.max_concurrency, 3))

        async def one(h: dict[str, Any]) -> dict[str, Any]:
            async with sem:
                try:
                    rec = await ctx.http.get(f"{API}/{h['orcid-id']}/record", headers=HEADERS, timeout=20.0)
                    record = json_or_none(rec) if rec.status_code == 200 else None
                except Exception as e:
                    ctx.log.info("orcid record %s skipped: %s", h["orcid-id"], e)
                    record = None
            return self._finding(h, record if isinstance(record, dict) else {}, target, ctx)

        return list(await asyncio.gather(*(one(h) for h in hits)))

    def _finding(self, hit: dict[str, Any], record: dict[str, Any], target: Target, ctx: ModuleContext) -> dict[str, Any]:
        oid = hit["orcid-id"]
        person = record.get("person") or {}
        name = person.get("name") or {}
        given = _val(name.get("given-names")) or str(hit.get("given-names") or "")
        family = _val(name.get("family-name")) or str(hit.get("family-names") or "")
        credit = _val(name.get("credit-name")) or str(hit.get("credit-name") or "")
        others = [_val(o.get("content")) or str(o.get("content") or "")
                  for o in (person.get("other-names") or {}).get("other-name") or [] if isinstance(o, dict)]
        acts = record.get("activities-summary") or {}
        jobs = _affiliations(acts.get("employments"), "employment-summary")
        schools = _affiliations(acts.get("educations"), "education-summary")
        employers = [j["organization"] for j in jobs] or [str(n) for n in hit.get("institution-name") or []]
        links = [_val(u.get("url")) for u in (person.get("researcher-urls") or {}).get("researcher-url") or []
                 if isinstance(u, dict)]
        keywords = [str(k.get("content") or "") for k in (person.get("keywords") or {}).get("keyword") or []
                    if isinstance(k, dict)]
        countries = [_val(a.get("country")) for a in (person.get("addresses") or {}).get("address") or []
                     if isinstance(a, dict)]
        emails = [str(e.get("email") or "") for e in (person.get("emails") or {}).get("email") or []
                  if isinstance(e, dict)]
        current = [j["place"] for j in jobs if not j["end"] and j["place"]]
        extra = person_extra(
            fullname=" ".join(p for p in (given, family) if p) or credit or target.value,
            aliases=[credit, *others],
            ids={"orcid": oid},
            employers=employers,
            education=[s["organization"] for s in schools],
            locations=[*countries, *current],
            links=links,
            topics=keywords,
            emails=emails,
            description=_val((person.get("biography") or {}).get("content"))[:500] or None,
            orcid=oid,
            employments=[_line(j) for j in jobs][:8],
            educations=[_line(s) for s in schools][:6],
        )
        return ctx.finding(self, target, platform="orcid", url=f"https://orcid.org/{oid}", extra=extra,
                           discriminator=oid)
