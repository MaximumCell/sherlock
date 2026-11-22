"""Username enumeration over the WhatsMyName dataset (own async engine).

The dataset (`sherlock_core/data/wmn-data.json`, CC BY-SA 4.0, see the notice next to it)
describes, per site, a URL to request and how an existing / missing account answers.
Only `found` rows are emitted, plus one summary row with the coverage counts.

The dataset is no longer maintained (archived 2026-11-09) and rules rot: a site changes
its pages and a rule starts answering "missing" (or "exists") for everyone. So:

- `data/rule_health.json` (written by `python -m sherlock_core.data.rule_health`) marks
  each rule ok / false_negative / false_positive / indistinguishable / error. Rules not
  marked `ok` are skipped and counted as `disabled` in the summary row. A site missing
  from the file runs; without the file every rule runs.
- Platforms another module checks properly (`user_scanner.covered_platforms`, when that
  module is available) are skipped here (`covered`), so one platform never gets two
  verdicts. Walled platforms (`sherlock_core.walled`) are never judged by a rule: without
  a working check they get one `unknown` row (`reason = "login_wall"`) with the profile URL.
"""
from __future__ import annotations

import asyncio
import json
from functools import lru_cache
from importlib import resources
from typing import Any
from urllib.parse import quote

import httpx

from sherlock_core.modules import get_module, register
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.walled import WALLED, walled_rows

DATASET = "wmn-data.json"
HEALTH_FILE = "rule_health.json"
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


@lru_cache(maxsize=1)
def load_health() -> dict[str, dict[str, Any]]:
    """Site name -> {status, checked_at, detail} from the rule health file; {} when it is missing."""
    try:
        raw = resources.files("sherlock_core.data").joinpath(HEALTH_FILE).read_text(encoding="utf-8")
        sites = json.loads(raw).get("sites", {})
    except (FileNotFoundError, OSError, ValueError, AttributeError):
        return {}
    return {str(k): v for k, v in sites.items() if isinstance(v, dict)} if isinstance(sites, dict) else {}


def rule_enabled(site: dict[str, Any], health: dict[str, dict[str, Any]] | None = None) -> bool:
    entry = (load_health() if health is None else health).get(str(site.get("name")))
    return entry is None or entry.get("status") == "ok"


def health_counts() -> dict[str, int]:
    """How many rules the health file put in each class (for the UI and the docs)."""
    out: dict[str, int] = {}
    for entry in load_health().values():
        st = str(entry.get("status"))
        out[st] = out.get(st, 0) + 1
    return out


def site_platform(site: dict[str, Any]) -> str:
    from sherlock_core.platforms import platform_info
    return platform_info(str(site.get("name") or ""), url=site.get("uri_pretty") or None)["key"]


def covered_elsewhere() -> frozenset[str]:
    """Platforms a working username check of another module covers (empty when it is not available)."""
    other = get_module("user_scanner")
    covers = getattr(other, "covers", None)
    if other is None or "username" not in other.inputs or not other.available() or not callable(covers):
        return frozenset()
    return frozenset(covers())


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


async def check_site(site: dict[str, Any], username: str, http: httpx.AsyncClient) -> tuple[str, str]:
    """(verdict, url) of one site for one username: the request and matching every caller uses."""
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
        return await check_site(site, username, http)

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        username = target.value.strip().lstrip("@")
        if not username:
            return []
        candidates = [
            s for s in load_sites()
            if not (target.params.get("skip_nsfw") and s.get("cat") == NSFW_CATEGORY)
            and account_for(s, username)
        ]
        covered = covered_elsewhere()
        health = load_health()
        sites, skipped_covered, disabled = [], 0, 0
        for s in candidates:
            platform = site_platform(s)
            if platform in WALLED or platform in covered:
                skipped_covered += 1           # never judged by a page rule; see the module docstring
            elif not rule_enabled(s, health):
                disabled += 1
            else:
                sites.append(s)
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
        walled = walled_rows(ctx, self, target, username, skip=covered)
        findings.extend(walled)
        findings.append(ctx.finding(
            self, target, platform="whatsmyname", url=self.source_url,
            status="found" if counts["found"] else "not_found",
            meta={
                "summary": True, "checked": total, "found": counts["found"],
                "not_found": counts["not_found"], "inconclusive": counts["unknown"],
                "errors": counts["error"], "unknown": counts["unknown"] + counts["error"] + len(walled),
                "disabled": disabled, "covered": skipped_covered, "walled": len(walled),
            },
        ))
        return findings
