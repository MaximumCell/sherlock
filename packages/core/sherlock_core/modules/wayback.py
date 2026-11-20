"""Internet Archive Wayback Machine (CDX API): capture history of a domain."""
from __future__ import annotations

from typing import Any

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import UpstreamError, clean, error_finding, json_or_none, normalize_domain
from sherlock_core.modules.base import Module, ModuleContext, Target

CDX = "https://web.archive.org/cdx/search/cdx"
MAX_SAMPLE = 50
TIMEOUT_S = 25.0


def _iso(ts: str) -> str | None:
    """CDX timestamp `YYYYMMDDhhmmss` -> ISO 8601 (UTC)."""
    if len(ts) < 8 or not ts[:14].isdigit():
        return None
    ts = ts.ljust(14, "0")
    return f"{ts[0:4]}-{ts[4:6]}-{ts[6:8]}T{ts[8:10]}:{ts[10:12]}:{ts[12:14]}Z"


async def cdx(http: httpx.AsyncClient, **params: Any) -> list[dict[str, str]]:
    """One CDX query -> list of row dicts (the JSON output is a header row followed by data rows)."""
    r = await http.get(CDX, params={"output": "json", **params}, timeout=TIMEOUT_S)
    if r.status_code != 200:
        raise UpstreamError(f"Wayback CDX answered HTTP {r.status_code}")
    rows = json_or_none(r) if r.text.strip() else []
    if not isinstance(rows, list):
        raise UpstreamError("Wayback CDX returned a non-JSON answer")
    if len(rows) < 2 or not isinstance(rows[0], list):
        return []
    header = [str(h) for h in rows[0]]
    return [dict(zip(header, map(str, row), strict=False)) for row in rows[1:] if isinstance(row, list)]


@register
class Wayback(Module):
    name = "wayback"
    title = "Web archive history"
    description = "First and last Wayback Machine capture of a domain, captures per year and a sample of archived URLs."
    inputs = ("domain",)
    queue = "infra"
    source_url = "https://archive.org/developers/wayback-cdx-server.html"
    timeout_s = 120.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            domain = normalize_domain(target.value)
        except ValueError as e:
            return [error_finding(ctx, self, target, "wayback", str(e))]
        problems: list[str] = []

        async def attempt(label: str, **params: Any) -> list[dict[str, str]] | None:
            try:
                return await cdx(ctx.http, url=domain, **params)
            except (UpstreamError, httpx.HTTPError) as e:
                problems.append(f"{label}: {str(e) or type(e).__name__}")
                return None

        # Sequential on purpose: the archive throttles parallel CDX queries from one address.
        years = await attempt(
            "per-year counts", fl="timestamp,groupcount", collapse="timestamp:4", showGroupCount="true", limit=80,
        )
        await ctx.progress(35, "capture counts fetched")
        first = years[:1] if years else await attempt("first capture", fl="timestamp,original", limit=1)
        last = await attempt("last capture", fl="timestamp,original", limit=-1)
        await ctx.progress(65, "first and last capture fetched")
        if first is None and last is None:
            raise RuntimeError(f"wayback: CDX API unavailable ({problems[0]})")
        if not first and not last:
            return []  # never archived
        sample = await attempt(
            "sample of URLs", matchType="domain", fl="original,timestamp,mimetype", collapse="urlkey",
            filter="statuscode:200", limit=MAX_SAMPLE,
        )

        by_year: dict[str, int] = {}
        for row in years or []:
            count = row.get("groupcount", "")
            if row.get("timestamp", "")[:4].isdigit() and count.isdigit():
                by_year[row["timestamp"][:4]] = int(count)
        urls = [
            {
                "url": row["original"], "captured_at": _iso(row.get("timestamp", "")),
                "mimetype": row.get("mimetype"),
                "archived_url": f"https://web.archive.org/web/{row.get('timestamp', '')}/{row['original']}",
            }
            for row in (sample or [])[:MAX_SAMPLE] if row.get("original")
        ]
        return [ctx.finding(
            self, target, platform="wayback", url=f"https://web.archive.org/web/*/{domain}",
            meta=clean({
                "first_capture": _iso(first[0].get("timestamp", "")) if first else None,
                "last_capture": _iso(last[0].get("timestamp", "")) if last else None,
                "captures_by_year": by_year,
                "total_captures": sum(by_year.values()) if by_year else None,
                "sample_urls": urls,
                "partial": "; ".join(problems)[:300] if problems else None,
            }),
        )]
