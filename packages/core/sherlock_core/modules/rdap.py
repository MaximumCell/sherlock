"""Registration data for a domain or IP address via the rdap.org bootstrap redirector.

Only registry / registrar / organisation-level fields are kept. Contact vCards of people
(names, emails, phones, postal addresses) are never parsed into the finding.
"""
from __future__ import annotations

from typing import Any

from sherlock_core.modules import register
from sherlock_core.modules._util import (
    clean,
    describe_http_error,
    error_finding,
    json_or_none,
    normalize_domain,
    normalize_ip,
)
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://rdap.org"
_EVENTS = {
    "registration": "created_at", "expiration": "expires_at", "last changed": "updated_at",
    "transfer": "transferred_at",
}


def _vcard(entity: dict[str, Any], field: str) -> str | None:
    card = entity.get("vcardArray")
    if not (isinstance(card, list) and len(card) > 1 and isinstance(card[1], list)):
        return None
    for item in card[1]:
        if isinstance(item, list) and len(item) >= 4 and item[0] == field and isinstance(item[3], str):
            return item[3].strip() or None
    return None


def _entities_with_role(doc: dict[str, Any], role: str) -> list[dict[str, Any]]:
    return [
        e for e in doc.get("entities") or []
        if isinstance(e, dict) and role in (e.get("roles") or [])
    ]


def _events(doc: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for ev in doc.get("events") or []:
        if isinstance(ev, dict) and ev.get("eventAction") in _EVENTS and ev.get("eventDate"):
            out[_EVENTS[ev["eventAction"]]] = ev["eventDate"]
    return out


def parse_domain(doc: dict[str, Any]) -> dict[str, Any]:
    registrar = (_entities_with_role(doc, "registrar") or [{}])[0]
    iana_id = next(
        (p.get("identifier") for p in registrar.get("publicIds") or []
         if isinstance(p, dict) and "IANA" in str(p.get("type", ""))),
        None,
    )
    return clean({
        "domain": str(doc.get("ldhName") or "").lower(),
        "handle": doc.get("handle"),
        "registrar": _vcard(registrar, "fn"),
        "registrar_iana_id": iana_id,
        **_events(doc),
        "nameservers": sorted({
            str(n.get("ldhName")).lower().rstrip(".") for n in doc.get("nameservers") or []
            if isinstance(n, dict) and n.get("ldhName")
        }),
        "status": doc.get("status") or [],
        "dnssec": (doc.get("secureDNS") or {}).get("delegationSigned"),
    })


def parse_ip(doc: dict[str, Any]) -> dict[str, Any]:
    cidrs = [
        f"{c.get('v4prefix') or c.get('v6prefix')}/{c.get('length')}"
        for c in doc.get("cidr0_cidrs") or []
        if isinstance(c, dict) and (c.get("v4prefix") or c.get("v6prefix"))
    ]
    # organisations only: an entity whose vCard says kind=org; individuals are skipped
    orgs = [
        name for e in _entities_with_role(doc, "registrant")
        if (_vcard(e, "kind") or "").lower() == "org" and (name := _vcard(e, "fn"))
    ]
    return clean({
        "network_name": doc.get("name"),
        "handle": doc.get("handle"),
        "network_type": doc.get("type"),
        "country": doc.get("country"),
        "start_address": doc.get("startAddress"),
        "end_address": doc.get("endAddress"),
        "cidr": cidrs,
        "organization": orgs[0] if orgs else None,
        **_events(doc),
        "status": doc.get("status") or [],
    })


@register
class Rdap(Module):
    name = "rdap"
    title = "Registration data (RDAP)"
    description = "Registrar, registration dates, nameservers and status of a domain; network and organisation of an IP."
    inputs = ("domain", "ip")
    queue = "infra"
    source_url = "https://about.rdap.org/"
    timeout_s = 45.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            if target.type == "ip":
                path, parse = f"ip/{normalize_ip(target.value)}", parse_ip
            else:
                path, parse = f"domain/{normalize_domain(target.value)}", parse_domain
        except ValueError as e:
            return [error_finding(ctx, self, target, "rdap", str(e))]
        r = await ctx.http.get(
            f"{API}/{path}", headers={"Accept": "application/rdap+json, application/json"},
            timeout=20.0, follow_redirects=True,
        )
        if r.status_code in (400, 404):  # not registered, or a TLD without an RDAP service
            return []
        if r.status_code in (403, 429):
            return [error_finding(ctx, self, target, "rdap", describe_http_error(r))]
        r.raise_for_status()
        doc = json_or_none(r)
        if not isinstance(doc, dict):
            return [error_finding(ctx, self, target, "rdap", "unexpected response format")]
        meta = parse(doc)
        if not meta:
            return []
        self_link = next(
            (ln.get("href") for ln in doc.get("links") or [] if isinstance(ln, dict) and ln.get("rel") == "self"),
            None,
        )
        return [ctx.finding(self, target, platform="rdap", url=self_link or str(r.url), meta=meta)]
