"""Username enumeration over the WhatsMyName dataset (own async engine).

The dataset (`sherlock_core/data/wmn-data.json`, CC BY-SA 4.0, see the notice next to it)
describes, per site, a URL to request and how an existing / missing account answers.
Only `found` rows are emitted, plus one summary row with the coverage counts.
"""
from __future__ import annotations

import asyncio
import json
from functools import lru_cache
from importlib import resources
from typing import Any
from urllib.parse import quote

import httpx

from sherlock_core.modules import register
from sherlock_core.modules.base import Module, ModuleContext, Target

DATASET = "wmn-data.json"
SITE_TIMEOUT_S = 8.0
MAX_BODY_BYTES = 400_000
NSFW_CATEGORY = "xx NSFW xx"
# Most sites in the dataset answer a browser differently from an unknown client.
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


@lru_cache(maxsize=1)
def load_sites() -> tuple[dict[str, Any], ...]:
    """Usable site entries from the bundled dataset (loaded on first use)."""
    raw = resources.files("sherlock_core.data").joinpath(DATASET).read_text(encoding="utf-8")
    sites = json.loads(raw).get("sites", [])
    return tuple(
        s for s in sites
        if isinstance(s, dict) and s.get("valid", True) is not False
        and s.get("name") and isinstance(s.get("uri_check"), str) and "e_code" in s
    )


def account_for(site: dict[str, Any], username: str) -> str:
    for ch in site.get("strip_bad_char") or "":
        username = username.replace(ch, "")
    return username


def build_request(site: dict[str, Any], username: str) -> tuple[str, str, dict[str, str], str | None]:
    """(method, url, headers, body) for one site."""
    account = account_for(site, username)
    url = site["uri_check"].replace("{account}", quote(account, safe=""))
    headers = {**BROWSER_HEADERS, **{str(k): str(v) for k, v in (site.get("headers") or {}).items()}}
    body = site.get("post_body")
    if body:
        return "POST", url, headers, str(body).replace("{account}", account)
    return "GET", url, headers, None


def classify(site: dict[str, Any], status_code: int, text: str) -> str:
    """found | not_found | unknown, from the site's exists / missing rules."""
    e_string, m_string = site.get("e_string") or "", site.get("m_string") or ""
    missing = status_code == site.get("m_code") and bool(m_string) and m_string in text
    exists = status_code == site.get("e_code") and (not e_string or e_string in text)
    if exists and not (m_string and m_string in text):
        return "found"
    if missing or status_code == site.get("m_code") != site.get("e_code"):
        return "not_found"
    if status_code in (404, 410) and status_code != site.get("e_code"):
        return "not_found"  # a plain "gone" answer, whatever the dataset expected for a missing account
    return "unknown"


@register
class WhatsMyName(Module):
    name = "whatsmyname"
    title = "Username enumeration (WhatsMyName)"
    description = "Checks a username against the ~690 sites of the WhatsMyName dataset."
    inputs = ("username",)
    queue = "identity"
    source_url = "https://github.com/WebBreacher/WhatsMyName"
    timeout_s = 600.0
    heavy = True  # measured peak ~360-410 MB of a 512 MB worker

    async def _check(self, site: dict[str, Any], username: str, http: httpx.AsyncClient) -> tuple[str, str]:
        method, url, headers, body = build_request(site, username)
        async with http.stream(
            method, url, headers=headers, content=body, timeout=SITE_TIMEOUT_S, follow_redirects=False,
        ) as r:
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) >= MAX_BODY_BYTES:
                    break
            text = bytes(buf).decode(r.encoding or "utf-8", errors="replace")
            return classify(site, r.status_code, text), url

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        username = target.value.strip().lstrip("@")
        if not username:
            return []
        sites = [
            s for s in load_sites()
            if not (target.params.get("skip_nsfw") and s.get("cat") == NSFW_CATEGORY)
            and account_for(s, username)
        ]
        total = len(sites)
        counts = {"found": 0, "not_found": 0, "unknown": 0, "error": 0}
        findings: list[dict[str, Any]] = []
        sem = asyncio.Semaphore(max(1, ctx.max_concurrency))
        done = 0
        step = max(1, total // 20)

        async def one(site: dict[str, Any]) -> None:
            nonlocal done
            async with sem:
                try:
                    # wait_for bounds the whole exchange, not only each socket read
                    verdict, check_url = await asyncio.wait_for(
                        self._check(site, username, ctx.http), SITE_TIMEOUT_S + 2,
                    )
                except (httpx.HTTPError, TimeoutError, UnicodeError, ValueError, LookupError) as e:
                    verdict, check_url = "error", ""
                    ctx.log.debug("whatsmyname %s: %s", site["name"], type(e).__name__)
            counts[verdict] += 1
            if verdict == "found":
                pretty = site.get("uri_pretty")
                account = quote(account_for(site, username), safe="")
                findings.append(ctx.finding(
                    self, target, platform=str(site["name"]),
                    url=pretty.replace("{account}", account) if pretty else check_url,
                    extra={"username": username}, meta={"category": site.get("cat")},
                ))
            done += 1
            if done % step == 0:
                await ctx.progress(min(99, done * 100 // total), f"{done}/{total} sites, {counts['found']} found")

        await asyncio.gather(*(one(s) for s in sites))
        if total and counts["error"] == total:
            raise RuntimeError("whatsmyname: every site check failed (no network?)")
        findings.sort(key=lambda f: f["platform"].lower())
        findings.append(ctx.finding(
            self, target, platform="whatsmyname", url=self.source_url,
            status="found" if counts["found"] else "not_found",
            meta={
                "summary": True, "checked": total, "found": counts["found"],
                "not_found": counts["not_found"], "inconclusive": counts["unknown"],
                "errors": counts["error"],
            },
        ))
        return findings
