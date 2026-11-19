"""LeakCheck public API: names and dates of breaches an email / username appears in.

Keyless endpoint. It returns breach source names, their dates and the list of field
*names* exposed across all sources. No records, passwords or hashes are returned by
the endpoint and none are stored.
"""
from __future__ import annotations

from typing import Any

from sherlock_core.modules import register
from sherlock_core.modules._util import describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://leakcheck.io/api/public"
MAX_BREACHES = 150


@register
class LeakCheckPublic(Module):
    name = "leakcheck_public"
    title = "Breach exposure (LeakCheck)"
    description = "Lists the breaches (name and date only) in which an email or username appears."
    inputs = ("email", "username")
    queue = "identity"
    source_url = "https://wiki.leakcheck.io/en/api/public"
    timeout_s = 30.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        value = target.value.strip()
        if len(value) < 3:  # upstream rejects shorter queries
            return []
        r = await ctx.http.get(API, params={"check": value}, timeout=15.0)
        if r.status_code in (403, 429):
            return [error_finding(ctx, self, target, "leakcheck", describe_http_error(r))]
        body = json_or_none(r)
        if not isinstance(body, dict):
            r.raise_for_status()
            return [error_finding(ctx, self, target, "leakcheck", "unexpected response format")]
        if not body.get("success"):
            reason = str(body.get("error") or "")
            if reason.lower() == "not found":
                return []
            return [error_finding(ctx, self, target, "leakcheck", reason or describe_http_error(r))]

        sources = [s for s in body.get("sources") or [] if isinstance(s, dict) and s.get("name")]
        fields = sorted(str(f) for f in body.get("fields") or [])
        out = [ctx.finding(
            self, target, platform="leakcheck", url="https://leakcheck.io/",
            meta={
                "records_found": body.get("found"),
                "breach_count": len(sources),
                # field names seen across all sources; the API does not break them down per breach
                "exposed_fields": fields,
                "truncated": len(sources) > MAX_BREACHES,
            },
        )]
        seen: set[str] = set()
        for s in sources[:MAX_BREACHES]:
            name = str(s["name"])
            if name.lower() in seen:
                continue
            seen.add(name.lower())
            out.append(ctx.finding(
                self, target, platform="breach",
                meta={"breach_name": name, "breach_date": s.get("date") or None, "data_classes": []},
                discriminator=name,
            ))
        return out
