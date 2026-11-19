"""Hudson Rock Cavalier free OSINT endpoint: was this email / username seen in infostealer logs.

Exposure metadata only. The upstream response also carries masked passwords, masked
logins, a partial IP and a computer name; none of those are read or stored.
"""
from __future__ import annotations

from typing import Any

from sherlock_core.modules import register
from sherlock_core.modules._util import clean, describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://cavalier.hudsonrock.com/api/json/v2/osint-tools/"
MAX_HITS = 50


@register
class HudsonRock(Module):
    name = "hudson_rock"
    title = "Infostealer exposure (Hudson Rock)"
    description = "Checks whether an email or username appears in infostealer malware logs (metadata only)."
    inputs = ("username", "email")
    queue = "identity"
    source_url = "https://www.hudsonrock.com/free-tools"
    timeout_s = 30.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        kind = "email" if target.type == "email" else "username"
        r = await ctx.http.get(f"{API}search-by-{kind}", params={kind: target.value.strip()}, timeout=15.0)
        if r.status_code in (403, 429):
            return [error_finding(ctx, self, target, "hudson-rock", describe_http_error(r))]
        if r.status_code == 404:
            return []
        r.raise_for_status()
        body = json_or_none(r)
        if not isinstance(body, dict):
            return [error_finding(ctx, self, target, "hudson-rock", "unexpected response format")]
        hits = [h for h in body.get("stealers") or [] if isinstance(h, dict)][:MAX_HITS]
        # Several infected machines can share one date. Sorting makes the "#n" suffix that
        # keeps them apart stable between scans.
        hits.sort(key=lambda h: (
            str(h.get("date_compromised") or ""), str(h.get("operating_system") or ""),
            str(h.get("stealer_family") or ""), str(h.get("total_user_services") or ""),
        ))
        out: list[dict[str, Any]] = []
        per_date: dict[str, int] = {}
        for hit in hits:
            date = str(hit.get("date_compromised") or "")
            per_date[date] = per_date.get(date, 0) + 1
            out.append(ctx.finding(
                self, target, platform="hudson-rock", url=self.source_url,
                meta=clean({
                    "stealer_family": hit.get("stealer_family"),
                    "date_compromised": date,
                    "operating_system": hit.get("operating_system"),
                    "antiviruses": hit.get("antiviruses") or [],
                    "total_corporate_services": hit.get("total_corporate_services"),
                    "total_user_services": hit.get("total_user_services"),
                }),
                discriminator=date if per_date[date] == 1 else f"{date}#{per_date[date]}",
            ))
        return out
