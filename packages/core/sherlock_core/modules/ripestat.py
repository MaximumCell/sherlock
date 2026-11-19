"""RIPEstat data API: which network announces an IP (ASN, holder, prefix, registry country)."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import UpstreamError, clean, error_finding, json_or_none, normalize_ip
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://stat.ripe.net/data/{call}/data.json"
SOURCE_APP = "sherlock-osint"  # RIPEstat asks clients to identify themselves


async def data_call(http: httpx.AsyncClient, call: str, resource: str) -> dict[str, Any]:
    r = await http.get(API.format(call=call), params={"resource": resource, "sourceapp": SOURCE_APP}, timeout=15.0)
    if r.status_code != 200:
        raise UpstreamError(f"RIPEstat {call}: HTTP {r.status_code}")
    body = json_or_none(r)
    if not isinstance(body, dict) or body.get("status") != "ok" or not isinstance(body.get("data"), dict):
        raise UpstreamError(f"RIPEstat {call}: unexpected answer")
    return body["data"]


@register
class RipeStat(Module):
    name = "ripestat"
    title = "Network ownership (RIPEstat)"
    description = "Autonomous system, holder, announced prefix and registry country of an IP address."
    inputs = ("ip",)
    queue = "infra"
    source_url = "https://stat.ripe.net/docs/data-api/"
    timeout_s = 45.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            ip = normalize_ip(target.value)
        except ValueError as e:
            return [error_finding(ctx, self, target, "ripestat", str(e))]
        overview, geo = await asyncio.gather(
            data_call(ctx.http, "prefix-overview", ip), data_call(ctx.http, "rir-geo", ip),
            return_exceptions=True,
        )
        for res in (overview, geo):
            if isinstance(res, BaseException) and not isinstance(res, UpstreamError | httpx.HTTPError):
                raise res
        if isinstance(overview, BaseException):
            if isinstance(geo, BaseException):
                raise RuntimeError(f"ripestat unavailable: {overview}")
            overview = {}
        asns = [a for a in overview.get("asns") or [] if isinstance(a, dict) and a.get("asn") is not None]
        located = [] if isinstance(geo, BaseException) else geo.get("located_resources") or []
        country = next((x.get("location") for x in located if isinstance(x, dict) and x.get("location")), None)
        block = overview.get("block")
        block = block if isinstance(block, dict) else {}
        meta = clean({
            "asn": asns[0]["asn"] if asns else None,
            "holder": asns[0].get("holder") if asns else None,
            "asns": [{"asn": a["asn"], "holder": a.get("holder")} for a in asns[:10]] if len(asns) > 1 else None,
            "prefix": overview.get("resource") if overview.get("type") == "prefix" else None,
            "announced": overview.get("announced"),
            "country": country,
            "registry_block": block.get("desc"),
        })
        if not asns and not country:
            return []
        return [ctx.finding(
            self, target, platform="ripestat",
            url=f"https://stat.ripe.net/resource/{ip}", meta=meta,
        )]
