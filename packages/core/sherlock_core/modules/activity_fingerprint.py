"""When is a handle publicly active? Timestamps only, never post contents.

Sources: Hacker News (Algolia search API), GitHub public events, Stack Overflow
(Stack Exchange API). Each source that has data yields one finding with an hour-of-day /
weekday histogram in UTC; a combined `platform="activity"` finding adds a rough UTC-offset
estimate with an explicit confidence.

Reddit is intentionally absent: its public JSON listings answer HTTP 403 to
unauthenticated server-side clients, so the response shape could not be verified.
"""
from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any
from urllib.parse import quote

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import UpstreamError, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.github import gh_get

MIN_SAMPLE_FOR_ESTIMATE = 30
QUIET_WINDOW_H = 6
ASSUMED_QUIET_CENTRE_LOCAL = 4  # the least active six hours are assumed to centre on 04:00 local

Source = tuple[list[datetime], str | None, dict[str, Any]]  # timestamps, profile url, extra meta


def histogram(stamps: list[datetime]) -> dict[str, Any]:
    hours, weekdays = [0] * 24, [0] * 7
    for t in stamps:
        hours[t.hour] += 1
        weekdays[t.weekday()] += 1  # Monday = 0
    return {
        "hours_utc": hours, "weekdays": weekdays, "sample_size": len(stamps),
        "first": min(stamps).isoformat() if stamps else None,
        "last": max(stamps).isoformat() if stamps else None,
    }


def estimate_utc_offset(hours_utc: list[int]) -> dict[str, Any]:
    """Guess the UTC offset from the quietest six-hour window. Heuristic, never better than medium."""
    n = sum(hours_utc)
    if n == 0:
        return {"utc_offset_estimate": None, "confidence": "none"}
    quiet = [sum(hours_utc[(s + i) % 24] for i in range(QUIET_WINDOW_H)) for s in range(24)]
    start = min(range(24), key=lambda s: (quiet[s], s))
    centre_utc = (start + QUIET_WINDOW_H / 2) % 24
    offset = round(ASSUMED_QUIET_CENTRE_LOCAL - centre_utc)
    offset = (offset + 12) % 24 - 12
    quiet_share = quiet[start] / n
    ambiguous = sum(1 for q in quiet if q == quiet[start]) > 3
    if n < MIN_SAMPLE_FOR_ESTIMATE or ambiguous:
        confidence = "low"
    elif n >= 100 and quiet_share <= 0.05:
        confidence = "medium"
    else:
        confidence = "low"
    return {
        "utc_offset_estimate": offset,
        "utc_offset_label": f"UTC{offset:+d}",
        "confidence": confidence,
        "quiet_window_utc": [start, (start + QUIET_WINDOW_H) % 24],
        "quiet_window_share": round(quiet_share, 3),
        "method": (
            f"least active {QUIET_WINDOW_H} h window assumed to centre on "
            f"{ASSUMED_QUIET_CENTRE_LOCAL:02d}:00 local time; +/- 2 h at best, wrong for night workers and bots"
        ),
    }


def _from_epoch(values: list[Any]) -> list[datetime]:
    out = []
    for v in values:
        try:
            out.append(datetime.fromtimestamp(int(v), UTC))
        except (TypeError, ValueError, OverflowError, OSError):
            continue
    return out


async def hackernews(http: httpx.AsyncClient, username: str) -> Source:
    r = await http.get(
        "https://hn.algolia.com/api/v1/search_by_date",
        params={
            "tags": f"author_{username}", "hitsPerPage": 1000,
            "attributesToRetrieve": "created_at_i", "attributesToHighlight": "[]",
        },
        timeout=15.0,
    )
    if r.status_code != 200:
        raise UpstreamError(f"Hacker News search: HTTP {r.status_code}")
    hits = (json_or_none(r) or {}).get("hits") or []
    stamps = _from_epoch([h.get("created_at_i") for h in hits if isinstance(h, dict)])
    return stamps, f"https://news.ycombinator.com/user?id={quote(username)}", {}


async def github_events(http: httpx.AsyncClient, username: str) -> Source:
    pages = 3 if os.getenv("GITHUB_TOKEN") else 1
    stamps: list[datetime] = []
    for page in range(1, pages + 1):
        events = await gh_get(http, f"/users/{quote(username, safe='')}/events/public", per_page=100, page=page)
        if not isinstance(events, list) or not events:
            break
        for ev in events:
            try:
                stamps.append(datetime.fromisoformat(ev["created_at"].replace("Z", "+00:00")).astimezone(UTC))
            except (KeyError, TypeError, ValueError, AttributeError):
                continue
        if len(events) < 100:
            break
    return stamps, f"https://github.com/{quote(username)}", {}


async def stackoverflow(http: httpx.AsyncClient, username: str) -> Source:
    """Stack Overflow has display names, not handles: only one exact, unambiguous match is used."""
    base = "https://api.stackexchange.com/2.3"
    r = await http.get(
        f"{base}/users",
        params={"inname": username, "site": "stackoverflow", "pagesize": 30, "order": "desc", "sort": "reputation"},
        timeout=15.0,
    )
    if r.status_code != 200:
        raise UpstreamError(f"Stack Exchange users: HTTP {r.status_code}")
    users = [
        u for u in (json_or_none(r) or {}).get("items") or []
        if isinstance(u, dict) and str(u.get("display_name", "")).lower() == username.lower() and u.get("user_id")
    ]
    if len(users) != 1:
        return [], None, {}
    user = users[0]
    r = await http.get(
        f"{base}/users/{int(user['user_id'])}/posts",
        params={"site": "stackoverflow", "pagesize": 100, "order": "desc", "sort": "creation"},
        timeout=15.0,
    )
    if r.status_code != 200:
        raise UpstreamError(f"Stack Exchange posts: HTTP {r.status_code}")
    items = (json_or_none(r) or {}).get("items") or []
    stamps = _from_epoch([p.get("creation_date") for p in items if isinstance(p, dict)])
    return stamps, user.get("link"), {"identity_match": "display name (not a unique handle)"}


SOURCES: dict[str, Callable[[httpx.AsyncClient, str], Awaitable[Source]]] = {
    "hackernews": hackernews,
    "github": github_events,
    "stackoverflow": stackoverflow,
}
# Sources whose handle is unique, so their timestamps can be pooled for the combined estimate.
HANDLE_SOURCES = ("hackernews", "github")


@register
class ActivityFingerprint(Module):
    name = "activity_fingerprint"
    title = "Activity time fingerprint"
    description = (
        "Hour-of-day and weekday pattern of a handle's public posts (timestamps only) on Hacker News, "
        "GitHub and Stack Overflow, with a rough time-zone estimate."
    )
    inputs = ("username",)
    queue = "identity"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        username = target.value.strip().lstrip("@")
        if not username:
            return []
        names = list(SOURCES)
        results = await asyncio.gather(*(SOURCES[n](ctx.http, username) for n in names), return_exceptions=True)
        await ctx.progress(80, "timestamps collected")

        findings: list[dict[str, Any]] = []
        pooled: list[datetime] = []
        used: list[str] = []
        failed: dict[str, str] = {}
        for name, res in zip(names, results, strict=True):
            if isinstance(res, BaseException):
                if not isinstance(res, UpstreamError | httpx.HTTPError):
                    raise res
                failed[name] = str(res) or type(res).__name__
                ctx.log.info("activity_fingerprint %s skipped: %s", name, failed[name])
                continue
            stamps, url, extra_meta = res
            if not stamps:
                continue
            findings.append(ctx.finding(
                self, target, platform=name, url=url, extra={"username": username},
                meta={"activity": histogram(stamps), **extra_meta}, discriminator="activity",
            ))
            if name in HANDLE_SOURCES:
                pooled.extend(stamps)
                used.append(name)

        if not findings:
            if len(failed) == len(names):
                return [error_finding(ctx, self, target, "activity", "; ".join(f"{k}: {v}" for k, v in failed.items()))]
            return []
        if pooled:
            activity = histogram(pooled)
            findings.append(ctx.finding(
                self, target, platform="activity", extra={"username": username},
                meta={
                    "activity": activity, "sources": used, **estimate_utc_offset(activity["hours_utc"]),
                    **({"failed_sources": failed} if failed else {}),
                },
            ))
        return findings
