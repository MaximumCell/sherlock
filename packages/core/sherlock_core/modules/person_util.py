"""Helpers shared by the name-search (`person_*`) modules. Not a module itself.

Boundaries enforced here (docs/CONTRACTS.md): locations are reduced to city / country level,
and the only fields a person module may publish are the ones `person_extra` assembles.
"""
from __future__ import annotations

import re
from typing import Any

from sherlock_core.modules._util import clean
from sherlock_core.modules.base import Target
from sherlock_core.resolve.names import NameMatch, best_match

# A source record is kept when its name matches the searched name at least this well.
MIN_NAME_SCORE = 0.5
MAX_CANDIDATES_PER_SOURCE = 5

_STREETISH = re.compile(
    r"\b(street|st\.|road|rd\.|avenue|ave\.?|lane|ln\.|drive|dr\.|boulevard|blvd|apt|apartment|suite|"
    r"floor|flat|unit|p\.?o\.? box|strasse|straße|rue|via|calle)\b", re.I)


def hints_of(target: Target) -> dict[str, Any]:
    """Optional disambiguation hints of a name search: {city?, employer?, school?, keywords?}."""
    p = target.params or {}
    out: dict[str, Any] = {}
    for key in ("city", "employer", "school"):
        v = p.get(key)
        if isinstance(v, str) and v.strip():
            out[key] = " ".join(v.split())[:120]
    kw = p.get("keywords")
    if isinstance(kw, str):
        kw = re.split(r"[,;]", kw)
    if isinstance(kw, list | tuple):
        words = [" ".join(str(k).split())[:60] for k in kw if str(k).strip()]
        if words:
            out["keywords"] = list(dict.fromkeys(words))[:8]
    return out


def coarse_location(value: Any) -> str | None:
    """A published location reduced to city / region / country level, or None.

    Anything that looks like a street address (house numbers, postcodes, street words) is
    dropped rather than trimmed: Sherlock never stores home or street addresses.
    """
    if not isinstance(value, str):
        return None
    s = " ".join(value.split()).strip(" ,;")
    if not s or len(s) > 80 or any(ch.isdigit() for ch in s) or _STREETISH.search(s) or "@" in s:
        return None
    parts = [p.strip() for p in s.split(",") if p.strip()]
    return ", ".join(parts[:3]) or None


def join_place(*parts: Any) -> str | None:
    """'Oxford, GB' from (city, country); street-level input never reaches this function."""
    return coarse_location(", ".join(str(p).strip() for p in parts if p and str(p).strip()))


def uniq(values: Any, limit: int = 12) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for v in values or []:
        s = " ".join(str(v).split()) if v else ""
        if s and s.casefold() not in seen:
            seen.add(s.casefold())
            out.append(s)
    return out[:limit]


def name_gate(query: str, names: list[str]) -> tuple[NameMatch, str]:
    """Best match of the searched name against a record's name spellings."""
    return best_match(query, [n for n in names if isinstance(n, str) and n.strip()])


def person_extra(
    *,
    fullname: str,
    kind: str = "record",
    aliases: list[str] | None = None,
    ids: dict[str, str] | None = None,
    employers: list[str] | None = None,
    education: list[str] | None = None,
    locations: list[str] | None = None,
    links: list[str] | None = None,
    topics: list[str] | None = None,
    description: str | None = None,
    emails: list[str] | None = None,
    handles: dict[str, str] | None = None,
    **more: Any,
) -> dict[str, Any]:
    """The `extra` dict of a person finding, in the contract's field names.

    kind: record (official / self-published record), profile (an account page),
    news, mention. `ids` are identity claims the source makes about this person
    ({"orcid": ..., "github": handle, "wikidata": "Q80"}); `handles` are the subset that
    are account handles and are also written as top-level handle keys (`github`, `twitter`).
    """
    employers, education = uniq(employers), uniq(education)
    locations = uniq([loc for loc in (coarse_location(x) for x in locations or []) if loc], 6)
    links, emails = uniq(links, 15), uniq(emails, 5)
    ids = {k: str(v) for k, v in (ids or {}).items() if v}
    handles = {k: str(v) for k, v in (handles or {}).items() if v}
    hint = clean({
        "kind": kind, "name": fullname, "aliases": uniq(aliases, 10), "ids": {**ids, **handles},
        "employers": employers, "education": education, "locations": locations, "links": links,
        "topics": uniq(topics, 10), "description": description,
        "emails": emails,
    })
    return clean({
        "fullname": fullname,
        "bio": description,
        "location": locations[0] if locations else None,
        "employer": "; ".join(employers[:5]) or None,
        "education": "; ".join(education[:5]) or None,
        "links": ", ".join(links) or None,
        "email": emails[0] if emails else None,
        "emails": ", ".join(emails) if len(emails) > 1 else None,
        **handles,
        **more,
        "candidate_hint": hint,
    })
