"""XposedOrNot free breach-exposure check: breach names for an email, never records.

The endpoint sits behind a bot wall that often rejects datacenter IPs (HTTP 403) and is
limited to 2 requests/second, 25/hour, 100/day per IP; both become an error finding.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

from sherlock_core.modules import register
from sherlock_core.modules._util import describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://api.xposedornot.com/v1/check-email/{email}"
MAX_BREACHES = 200


def parse_breach_names(body: Any) -> list[str]:
    """`{"breaches": [["Adobe", "LinkedIn"]], "status": "success"}` -> ["Adobe", "LinkedIn"]."""
    if not isinstance(body, dict):
        return []
    names: list[str] = []
    for group in body.get("breaches") or []:
        for name in group if isinstance(group, list) else [group]:
            if isinstance(name, str) and name and name not in names:
                names.append(name)
    return names


@register
class XposedOrNot(Module):
    name = "xposedornot"
    title = "Breach exposure (XposedOrNot)"
    description = "Lists the names of known data breaches that include an email address."
    inputs = ("email",)
    queue = "identity"
    source_url = "https://xposedornot.com/api_doc"
    timeout_s = 30.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        email = target.value.strip().lower()
        r = await ctx.http.get(
            API.format(email=quote(email, safe="@")), headers={"Accept": "application/json"}, timeout=15.0,
        )
        if r.status_code == 404:  # documented "not found" answer
            return []
        if r.status_code in (403, 429):
            return [error_finding(ctx, self, target, "breach", describe_http_error(r))]
        r.raise_for_status()
        body = json_or_none(r)
        if not isinstance(body, dict):
            return [error_finding(ctx, self, target, "breach", "unexpected response format")]
        return [
            ctx.finding(
                self, target, platform="breach", url="https://xposedornot.com/",
                meta={"breach_name": name, "breach_date": None, "data_classes": []},
                discriminator=name,
            )
            for name in parse_breach_names(body)[:MAX_BREACHES]
        ]
