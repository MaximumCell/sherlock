"""DNS records of a domain over DNS-over-HTTPS (Google Public DNS JSON API)."""
from __future__ import annotations

import asyncio
from typing import Any

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import UpstreamError, clean, error_finding, json_or_none, normalize_domain
from sherlock_core.modules.base import Module, ModuleContext, Target

DOH = "https://dns.google/resolve"
RECORD_TYPES = {"A": 1, "AAAA": 28, "MX": 15, "NS": 2, "TXT": 16, "CNAME": 5}
MAX_PER_TYPE = 50
NXDOMAIN = 3


async def resolve(http: httpx.AsyncClient, name: str, rtype: str) -> tuple[int, list[str]]:
    """(DNS status code, record data of that type) for one question."""
    r = await http.get(DOH, params={"name": name, "type": rtype}, timeout=10.0)
    if r.status_code != 200:
        raise UpstreamError(f"DNS-over-HTTPS resolver answered HTTP {r.status_code}")
    body = json_or_none(r)
    if not isinstance(body, dict):
        raise UpstreamError("DNS-over-HTTPS resolver returned a non-JSON answer")
    want = RECORD_TYPES[rtype]
    data = []
    for a in body.get("Answer") or []:  # an A question also returns the CNAME chain: keep only `want`
        if isinstance(a, dict) and a.get("type") == want and isinstance(a.get("data"), str):
            value = a["data"].strip()
            if rtype == "TXT":
                value = value.replace('" "', "").strip('"')
            elif rtype in ("NS", "CNAME"):
                value = value.rstrip(".").lower()
            elif rtype == "MX":  # "10 mail.example.com." ; "0 ." is the null MX (accepts no mail)
                prio, _, host = value.partition(" ")
                value = f"{prio} {host.rstrip('.').lower() or '.'}"
            data.append(value)
    return int(body.get("Status", -1)), list(dict.fromkeys(data))[:MAX_PER_TYPE]


@register
class DnsRecords(Module):
    name = "dns_records"
    title = "DNS records"
    description = "A, AAAA, MX, NS, TXT and CNAME records of a domain, with SPF and DMARC presence."
    inputs = ("domain",)
    queue = "infra"
    source_url = "https://developers.google.com/speed/public-dns/docs/doh/json"
    timeout_s = 45.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            domain = normalize_domain(target.value)
        except ValueError as e:
            return [error_finding(ctx, self, target, "dns", str(e))]
        sem = asyncio.Semaphore(min(ctx.max_concurrency, 4))

        async def ask(name: str, rtype: str) -> tuple[int, list[str]] | Exception:
            async with sem:
                try:
                    return await resolve(ctx.http, name, rtype)
                except (UpstreamError, httpx.HTTPError) as e:
                    ctx.log.info("dns_records %s %s failed: %s", name, rtype, e)
                    return e

        questions = [(domain, t) for t in RECORD_TYPES] + [(f"_dmarc.{domain}", "TXT")]
        answers = await asyncio.gather(*(ask(n, t) for n, t in questions))
        failures = [a for a in answers if isinstance(a, Exception)]
        if len(failures) == len(answers):
            raise RuntimeError(f"dns_records: resolver unreachable ({failures[0]})")

        records: dict[str, list[str]] = {}
        nxdomain = False
        for (name, rtype), ans in zip(questions[:-1], answers[:-1], strict=True):
            if isinstance(ans, Exception):
                continue
            status, data = ans
            nxdomain = nxdomain or (status == NXDOMAIN and name == domain)
            if data:
                records[rtype] = data
        dmarc_ans = answers[-1]
        dmarc = [] if isinstance(dmarc_ans, Exception) else [t for t in dmarc_ans[1] if t.lower().startswith("v=dmarc1")]
        spf = [t for t in records.get("TXT", []) if t.lower().startswith("v=spf1")]
        if not records and not dmarc:
            return []  # NXDOMAIN or an empty zone
        return [ctx.finding(
            self, target, platform="dns", url=f"https://dns.google/query?name={domain}",
            meta=clean({
                "records": records,
                "has_spf": bool(spf),
                "has_dmarc": bool(dmarc),
                "spf_record": spf[0] if spf else None,
                "dmarc_record": dmarc[0] if dmarc else None,
                "failed_lookups": len(failures),
            }),
        )]
