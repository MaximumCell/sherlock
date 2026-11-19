"""Subdomains seen in certificate transparency logs (crt.sh JSON output).

crt.sh is slow and often answers 502/503, so the request gets 30 s and one retry. The
response for a very large domain can be tens of megabytes; it is read through a hard cap.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import UpstreamError, error_finding, fetch_capped, normalize_domain
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://crt.sh/?q=%25.{domain}&output=json"
MAX_SUBDOMAINS = 500
MAX_BYTES = 6_000_000
TIMEOUT_S = 30.0


def parse_names(rows: list[Any], domain: str) -> tuple[list[str], bool]:
    """Hostnames under `domain` from crt.sh rows -> (sorted unique names, any wildcard cert seen)."""
    names: set[str] = set()
    wildcard = False
    suffix = f".{domain}"
    for row in rows:
        if not isinstance(row, dict):
            continue
        for raw in f"{row.get('name_value', '')}\n{row.get('common_name', '')}".split("\n"):
            name = raw.strip().lower().rstrip(".")
            if name.startswith("*."):
                wildcard = True
                name = name[2:]
            if not name or "@" in name or " " in name:  # SAN entries can be email addresses
                continue
            if name == domain or name.endswith(suffix):
                names.add(name)
    return sorted(names, key=lambda n: (n.count("."), n)), wildcard


@register
class CrtSh(Module):
    name = "crtsh"
    title = "Certificate transparency"
    description = "Subdomains found in public TLS certificate transparency logs (crt.sh)."
    inputs = ("domain",)
    queue = "infra"
    source_url = "https://crt.sh/"
    timeout_s = 90.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            domain = normalize_domain(target.value)
        except ValueError as e:
            return [error_finding(ctx, self, target, "crt.sh", str(e))]
        url = API.format(domain=domain)
        body, last_error = None, "no answer"
        for attempt in (1, 2):
            try:
                body, _ = await fetch_capped(
                    ctx.http, url, max_bytes=MAX_BYTES, timeout=TIMEOUT_S, content_prefix=None,
                )
                break
            except UpstreamError as e:
                last_error = str(e)
                if "larger than" in last_error:
                    return [error_finding(
                        ctx, self, target, "crt.sh", "too many certificates to process for this domain", url=url,
                    )]
            except httpx.HTTPError as e:
                last_error = type(e).__name__
            if attempt == 1:
                await ctx.progress(40, "crt.sh did not answer, retrying")
                await asyncio.sleep(2)
        if body is None:
            raise RuntimeError(f"crt.sh unavailable: {last_error}")
        try:
            rows = json.loads(body) if body.strip() else []
        except ValueError:
            raise RuntimeError("crt.sh returned a non-JSON answer") from None
        if not isinstance(rows, list) or not rows:
            return []
        names, wildcard = parse_names(rows, domain)
        if not names:
            return []
        return [ctx.finding(
            self, target, platform="crt.sh", url=f"https://crt.sh/?q=%25.{domain}",
            meta={
                "subdomains": names[:MAX_SUBDOMAINS],
                "subdomain_count": len(names),
                "truncated": len(names) > MAX_SUBDOMAINS,
                "certificates": len(rows),
                "wildcard_certificate": wildcard,
            },
        )]
