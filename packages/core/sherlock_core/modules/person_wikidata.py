"""Wikidata / Wikipedia entries for notable people with this name.

Verified 2026-11-19 and 2026-11-20 with real requests for "Tim Berners-Lee" (keyless MediaWiki API;
trimmed into tests/person/fixtures/wikidata_*.json):
  GET https://www.wikidata.org/w/api.php?action=wbsearchentities&search=<name>&language=en&type=item
      -> search[]: id, label, description
  GET ...?action=wbgetentities&ids=Q80|...&props=labels|descriptions|aliases|claims|sitelinks&sitefilter=enwiki
      -> entities.<QID>.claims.<P>[].mainsnak.datavalue.value   ({"id": "Q.."} for items, str for ids)
  GET ...?action=wbgetentities&ids=<referenced QIDs>&props=labels     (names of employers, occupations)
Properties read: P31 instance of (must be Q5 human), P106 occupation, P108 employer,
P69 educated at, P856 official website, P496 ORCID, and account handles P2002 X/Twitter,
P2037 GitHub, P4033 Mastodon (`user@instance`, e.g. timbl@w3c.social), P2003 Instagram, P2013 Facebook, P6634 LinkedIn, P2397 YouTube channel.
NOT read on purpose: date and place of birth, residence, family relations (P22/P25/P26/P40/P3373).
Quota: no key; Wikimedia asks for a descriptive User-Agent and serial requests (3 per search here).
"""
from __future__ import annotations

import re
from typing import Any

from sherlock_core.modules import register
from sherlock_core.modules._util import describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.person_util import MIN_NAME_SCORE, name_gate, person_extra

API = "https://www.wikidata.org/w/api.php"
MAX_ENTITIES = 5
HUMAN = "Q5"
# property -> handle key written into `extra` (canonical platform names of correlation.norm)
HANDLE_PROPS = {
    "P2002": "twitter", "P2037": "github", "P4033": "mastodon", "P2003": "instagram",
    "P2013": "facebook", "P6634": "linkedin", "P2397": "youtube",
}
PROFILE_URL = {
    "twitter": "https://x.com/{}", "github": "https://github.com/{}", "instagram": "https://www.instagram.com/{}",
    "facebook": "https://www.facebook.com/{}", "linkedin": "https://www.linkedin.com/in/{}",
    "youtube": "https://www.youtube.com/channel/{}",
}


_FEDI = re.compile(r"^@?([A-Za-z0-9_.]+)@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})$")   # user@instance


def _values(entity: dict[str, Any], prop: str) -> list[Any]:
    """Current values of a property (deprecated statements skipped; preferred rank first)."""
    out: list[tuple[int, Any]] = []
    for st in (entity.get("claims") or {}).get(prop) or []:
        if not isinstance(st, dict) or st.get("rank") == "deprecated":
            continue
        snak = st.get("mainsnak") or {}
        if snak.get("snaktype") != "value":
            continue
        value = (snak.get("datavalue") or {}).get("value")
        ended = "P582" in (st.get("qualifiers") or {})          # has an end time: a former value
        out.append(((0 if st.get("rank") == "preferred" else 1) + (2 if ended else 0), value))
    return [v for _, v in sorted(out, key=lambda x: x[0])]


def _qids(entity: dict[str, Any], prop: str) -> list[str]:
    return [v["id"] for v in _values(entity, prop) if isinstance(v, dict) and v.get("id")]


def _strings(entity: dict[str, Any], prop: str) -> list[str]:
    return [v for v in _values(entity, prop) if isinstance(v, str) and v.strip()]


def _text(node: Any) -> str:
    en = (node or {}).get("en") if isinstance(node, dict) else None
    return str((en or {}).get("value") or "") if isinstance(en, dict) else ""


@register
class PersonWikidata(Module):
    name = "person_wikidata"
    title = "Wikidata and Wikipedia (notable people)"
    description = (
        "Notable people with this name on Wikidata: description, occupation, employer, official "
        "website and the social accounts recorded there."
    )
    inputs = ("name",)
    queue = "identity"
    source_url = "https://www.wikidata.org/wiki/Wikidata:Data_access"
    timeout_s = 60.0

    async def _api(self, ctx: ModuleContext, **params: Any) -> Any:
        r = await ctx.http.get(API, params={"format": "json", **params}, timeout=20.0)
        if r.status_code != 200:
            raise RuntimeError(describe_http_error(r))
        return json_or_none(r) or {}

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            found = await self._api(ctx, action="wbsearchentities", search=target.value, language="en",
                                    uselang="en", type="item", limit=8)
        except RuntimeError as e:
            return [error_finding(ctx, self, target, "wikidata", str(e))]
        ids = [s["id"] for s in found.get("search") or [] if isinstance(s, dict) and s.get("id")][:8]
        if not ids:
            return []
        await ctx.progress(30, "reading entries")
        try:
            data = await self._api(ctx, action="wbgetentities", ids="|".join(ids), languages="en",
                                   props="labels|descriptions|aliases|claims|sitelinks", sitefilter="enwiki")
        except RuntimeError as e:
            return [error_finding(ctx, self, target, "wikidata", str(e))]
        people = []
        for qid in ids:
            e = (data.get("entities") or {}).get(qid)
            if not isinstance(e, dict) or HUMAN not in _qids(e, "P31"):
                continue
            aliases = [str(a.get("value") or "") for a in ((e.get("aliases") or {}).get("en") or [])
                       if isinstance(a, dict)]
            match, _ = name_gate(target.value, [_text(e.get("labels")), *aliases])
            if match.score >= MIN_NAME_SCORE:
                people.append((qid, e, aliases))
        people = people[:MAX_ENTITIES]
        if not people:
            return []

        referenced: list[str] = []
        for _, e, _ in people:
            for prop in ("P106", "P108", "P69"):
                referenced.extend(_qids(e, prop)[:6])
        labels: dict[str, str] = {}
        referenced = list(dict.fromkeys(referenced))[:50]
        if referenced:
            await ctx.progress(70, "resolving labels")
            try:
                lab = await self._api(ctx, action="wbgetentities", ids="|".join(referenced), languages="en",
                                      props="labels")
                labels = {q: _text((v or {}).get("labels")) for q, v in (lab.get("entities") or {}).items()}
            except RuntimeError as e:
                ctx.log.info("wikidata label lookup skipped: %s", e)

        def named(e: dict[str, Any], prop: str) -> list[str]:
            return [labels[q] for q in _qids(e, prop)[:6] if labels.get(q)]

        out = []
        for qid, e, aliases in people:
            handles = {key: vals[0] for prop, key in HANDLE_PROPS.items() if (vals := _strings(e, prop))}
            orcid = next(iter(_strings(e, "P496")), None)
            websites = _strings(e, "P856")[:3]
            wiki = ((e.get("sitelinks") or {}).get("enwiki") or {}).get("title")
            links = [*websites]
            if wiki:
                links.append("https://en.wikipedia.org/wiki/" + str(wiki).replace(" ", "_"))
            links += [PROFILE_URL[k].format(v) for k, v in handles.items() if k in PROFILE_URL]
            if (m := _FEDI.match(handles.get("mastodon", ""))):
                links.append(f"https://{m.group(2)}/@{m.group(1)}")
            if orcid:
                links.append(f"https://orcid.org/{orcid}")
            occupations = named(e, "P106")
            extra = person_extra(
                fullname=_text(e.get("labels")) or target.value,
                aliases=aliases,
                ids={"wikidata": qid, "orcid": orcid},
                handles=handles,
                employers=named(e, "P108"),
                education=named(e, "P69"),
                links=links,
                topics=occupations,
                description=_text(e.get("descriptions")) or None,
                wikidata=qid,
                orcid=orcid,
                occupation=", ".join(occupations) or None,
                wikipedia=wiki,
            )
            out.append(ctx.finding(self, target, platform="wikidata", url=f"https://www.wikidata.org/wiki/{qid}",
                                   extra=extra, discriminator=qid))
        return out
