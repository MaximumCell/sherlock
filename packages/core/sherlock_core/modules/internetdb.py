"""Shodan InternetDB (keyless): open ports, hostnames, CPEs, known CVE ids and tags of an IP.

For a domain the A records are resolved first (DNS-over-HTTPS) and each address is looked up.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import (
    UpstreamError,
    describe_http_error,
    error_finding,
    is_public_ip,
    json_or_none,
    normalize_domain,
    normalize_ip,
)
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.dns_records import resolve

API = "https://internetdb.shodan.io/{ip}"
MAX_IPS = 5
CAP = 100


@register
class InternetDb(Module):
    name = "internetdb"
    title = "Exposed services (Shodan InternetDB)"
    description = "Open ports, hostnames, software (CPE), known vulnerabilities and tags Shodan has seen on an IP."
    inputs = ("ip", "domain")
    queue = "infra"
    source_url = "https://internetdb.shodan.io/"
    timeout_s = 45.0

    async def _lookup(self, ip: str, target: Target, ctx: ModuleContext) -> dict[str, Any] | None:
        r = await ctx.http.get(API.format(ip=ip), timeout=10.0)
        if r.status_code == 404:  # {"detail": "No information available"}
            return None
        if r.status_code != 200:
            return error_finding(ctx, self, target, "internetdb", describe_http_error(r), discriminator=ip)
        body = json_or_none(r)
        if not isinstance(body, dict):
            return error_finding(ctx, self, target, "internetdb", "unexpected response format", discriminator=ip)

        def items(key: str) -> list[Any]:
            v = body.get(key)
            return v[:CAP] if isinstance(v, list) else []

        return ctx.finding(
            self, target, platform="internetdb", url=f"https://www.shodan.io/host/{ip}",
            meta={
                "ip": ip, "ports": items("ports"), "hostnames": items("hostnames"),
                "cpes": items("cpes"), "vulns": items("vulns"), "tags": items("tags"),
            },
            discriminator=ip,
        )

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            if target.type == "ip":
                ips = [normalize_ip(target.value)]
            else:
                domain = normalize_domain(target.value)
                try:
                    _, ips = await resolve(ctx.http, domain, "A")
                except UpstreamError as e:
                    return [error_finding(ctx, self, target, "internetdb", f"could not resolve {domain}: {e}")]
        except ValueError as e:
            return [error_finding(ctx, self, target, "internetdb", str(e))]
        ips = [ip for ip in ips if is_public_ip(ip)][:MAX_IPS]
        if not ips:
            return []
        sem = asyncio.Semaphore(min(ctx.max_concurrency, MAX_IPS))

        async def one(ip: str) -> dict[str, Any] | None:
            async with sem:
                try:
                    return await self._lookup(ip, target, ctx)
                except httpx.HTTPError as e:
                    return error_finding(ctx, self, target, "internetdb", type(e).__name__, discriminator=ip)

        return [r for r in await asyncio.gather(*(one(ip) for ip in ips)) if r]
