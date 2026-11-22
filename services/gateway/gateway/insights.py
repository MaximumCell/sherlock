"""Misuse signals and chart series for the operator panel. Pure functions: no store, no clock.

Each flag is a plain-English reason a session may deserve a look. They are hints for a human,
never automatic decisions: nothing here blocks anyone.
"""
from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime, timedelta
from typing import Any, Literal

from sherlock_core.store import is_upload_placeholder

Row = dict[str, Any]
Severity = Literal["high", "medium", "low"]

# Thresholds (within the window of search rows passed in, normally the last FLAG_WINDOW_DAYS days).
FLAG_WINDOW_DAYS = 7
BURST_WINDOW_S = 10 * 60          # "many searches in a short burst" ...
BURST_SEARCHES = 8                # ... this many search attempts within BURST_WINDOW_S
RATE_LIMIT_HITS = 3               # refused by a daily rate limit this many times
BURST_LIMIT_HITS = 1              # refused by a 10-minute burst limit (session or origin) this many times
DISTINCT_TARGETS = 12             # this many different targets looks like harvesting, not a self-check
REFUSED_NAME_SEARCHES = 2         # name searches refused (anonymous session) this many times
SHARED_TARGET_SESSIONS = 3        # one of its targets was searched from this many sessions (itself included)
SHARED_ORIGIN_SESSIONS = 3        # this many sessions share one ip_hash (itself included)

SEVERITY_ORDER: dict[str, int] = {"high": 0, "medium": 1, "low": 2}
OUTCOMES = ("accepted", "rate_limited", "blocked", "paused", "forbidden", "invalid",
            "burst_limited", "active_search", "busy", "sign_in_required")


def flag(key: str, label: str, severity: Severity) -> Row:
    return {"key": key, "label": label, "severity": severity}


def _ts(value: Any) -> float:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()


def max_burst(times: Iterable[float], window_s: float = BURST_WINDOW_S) -> int:
    """Largest number of events inside any sliding window of `window_s` seconds."""
    ordered = sorted(times)
    best = start = 0
    for end, t in enumerate(ordered):
        while t - ordered[start] > window_s:
            start += 1
        best = max(best, end - start + 1)
    return best


def _plural(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {plural or word + 's'}"


def session_flags(searches: list[Row], *, ip_hash: str | None,
                  target_sessions: dict[tuple[str, str], int], origin_sessions: dict[str, int]) -> list[Row]:
    """Misuse flags for one session from its own search rows plus two cross-session counts:
    `target_sessions[(type, value)]` = distinct sessions that searched that target, and
    `origin_sessions[ip_hash]` = distinct sessions seen from that origin. Most severe first."""
    out: list[Row] = []
    burst = max_burst(_ts(r["created_at"]) for r in searches)
    if burst >= BURST_SEARCHES:
        out.append(flag("burst", f"{burst} searches within {BURST_WINDOW_S // 60} minutes", "medium"))

    limited = sum(1 for r in searches if r["outcome"] == "rate_limited")
    if limited >= RATE_LIMIT_HITS:
        out.append(flag("rate_limited", f"Hit the daily limit {_plural(limited, 'time')}", "medium"))

    burst_hits = sum(1 for r in searches if r["outcome"] == "burst_limited")
    if burst_hits >= BURST_LIMIT_HITS:
        out.append(flag("burst_limit", f"Hit the burst limit {_plural(burst_hits, 'time')}", "medium"))

    distinct = {(r["target_type"], r["target_value"]) for r in searches}
    if len(distinct) >= DISTINCT_TARGETS:
        out.append(flag("many_targets", f"Searched {len(distinct)} different targets, more like harvesting "
                                        "than a self-check", "high"))

    names = sum(1 for r in searches if r["target_type"] == "name" and r["outcome"] == "forbidden")
    if names >= REFUSED_NAME_SEARCHES:
        out.append(flag("refused_names", f"Tried {_plural(names, 'name search', 'name searches')} without signing in", "medium"))

    shared = max((target_sessions.get(t, 0) for t in distinct), default=0)
    if shared >= SHARED_TARGET_SESSIONS:
        out.append(flag("shared_target", f"Searched a target that {shared - 1} other "
                                         f"{'session' if shared == 2 else 'sessions'} also searched", "low"))

    same_origin = origin_sessions.get(ip_hash, 0) if ip_hash else 0
    if same_origin >= SHARED_ORIGIN_SESSIONS:
        out.append(flag("shared_origin", f"Shares an origin with {_plural(same_origin - 1, 'other session')}",
                        "low"))
    return sorted(out, key=lambda f: SEVERITY_ORDER[f["severity"]])


def target_session_counts(searches: Iterable[Row]) -> dict[tuple[str, str], int]:
    seen: dict[tuple[str, str], set[str]] = {}
    for r in searches:
        if is_upload_placeholder(r):   # every uploaded photo is logged as "uploaded photo"
            continue
        seen.setdefault((r["target_type"], r["target_value"]), set()).add(str(r["user_id"]))
    return {k: len(v) for k, v in seen.items()}


def origin_session_counts(sessions: Iterable[Row], searches: Iterable[Row] = ()) -> dict[str, int]:
    seen: dict[str, set[str]] = {}
    for r in [*sessions, *searches]:
        if r.get("ip_hash"):
            seen.setdefault(r["ip_hash"], set()).add(str(r["user_id"]))
    return {k: len(v) for k, v in seen.items()}


def day_series(by_day: dict[str, dict[str, int]], first: date, days: int) -> list[Row]:
    """One row per UTC day from `first`, every outcome present (zero-filled), oldest first."""
    out = []
    for i in range(days):
        day = (first + timedelta(days=i)).isoformat()
        counts = by_day.get(day, {})
        out.append({"day": day, **{o: int(counts.get(o, 0)) for o in OUTCOMES}})
    return out
