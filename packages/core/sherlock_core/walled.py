"""Three-state existence checks: found, not_found and unknown ("could not be checked").

An `unknown` result is stored as a finding row with `status = "error"` and top-level meta
`reason` in `UNKNOWN_REASONS` (plus `unknown: true`), so the schema's status CHECK stays
as it is. `detail` keeps the source's own words. Unknown rows are never correlation,
scoring or account input (those use `status == "found"` only); summaries count them
separately.

Walled platforms
----------------
`WALLED` lists platforms whose public profile page cannot tell an existing account from
a made-up one for an anonymous visitor. Verified 2026-11-22 from a home connection: one
logged-out GET (httpx, Chrome desktop User-Agent, browser Accept headers, no cookies,
redirects followed) of a well-known existing account and of the made-up name
`zq7xk2vw9pl0mh3`, comparing status, final URL, size and title:

    instagram  /nasa/ and the made-up name: both 200, same ~540 KB login shell titled
               "Instagram", no og:title                                   -> walled
    facebook   /nasa and the made-up name: both HTTP 400, identical 1.5 KB "Error" page
                                                                          -> walled
    tiktok     /@nasa and the made-up name: both 200, identical 1,462-byte shell, BUT
               the public oEmbed endpoint (WhatsMyName's TikTok rule) still tells them
               apart (rule health: ok)                                    -> NOT walled
    threads    /@nasa and the made-up name: both 200, same ~286 KB shell titled "Threads"
                                                                          -> walled
    linkedin   /in/williamhgates 200 with the real name in the title, made-up name
               HTTP 999                                                   -> NOT walled
    snapchat   /add/nasa -> /@nasa 200 "NASA (@nasa) | Snapchat ...", made-up name 404
                                                                          -> NOT walled

A plain page fetch (WhatsMyName's rules, the profile preview) therefore says nothing about
these three (the rule health check agrees: the Instagram, Facebook and Threads rules come
out `indistinguishable`, see `data/rule_health.json`). The user-scanner library has its own working checks for them (browser
impersonation and the platforms' public sign-up availability answers, no login), so a
username search asks user-scanner (`modules/user_scanner.py`) and WhatsMyName stays out of
it. Only when no working check is available (user-scanner not installed or not part of the
run) does a username search emit one `unknown` row per walled platform with
`reason = "login_wall"` and the exact profile URL, instead of a misleading verdict.
"""
from __future__ import annotations

from typing import Any

UNKNOWN_REASONS: tuple[str, ...] = ("login_wall", "blocked", "rate_limited", "ambiguous", "rule_disabled")
VERIFIED_ON = "2026-11-22"

# canonical platform key -> (label, profile URL template, plain-words reason)
WALLED: dict[str, dict[str, str]] = {
    "instagram": {"label": "Instagram", "url": "https://www.instagram.com/{account}/",
                  "note": "Instagram only shows profiles to signed-in users"},
    "facebook": {"label": "Facebook", "url": "https://www.facebook.com/{account}",
                 "note": "Facebook only shows profiles to signed-in users"},
    "threads": {"label": "Threads", "url": "https://www.threads.com/@{account}",
                "note": "Threads only shows profiles to signed-in users"},
}


def walled_url(platform_key: str, account: str) -> str:
    from urllib.parse import quote
    return WALLED[platform_key]["url"].replace("{account}", quote(account, safe="._-"))


def is_unknown(finding: dict[str, Any]) -> bool:
    """True for an "could not be checked" row (status error + a known reason)."""
    meta = finding.get("extra_metadata") if isinstance(finding, dict) else None
    return (isinstance(meta, dict) and finding.get("status") == "error"
            and (meta.get("unknown") is True or meta.get("reason") in UNKNOWN_REASONS)
            and not meta.get("summary"))


def unknown_meta(reason: str, detail: str = "", **more: Any) -> dict[str, Any]:
    if reason not in UNKNOWN_REASONS:
        raise ValueError(f"unknown reason {reason!r}")
    meta: dict[str, Any] = {"reason": reason, "unknown": True, **more}
    if detail:
        meta["detail"] = str(detail)[:300]
    return meta


def reason_from_text(text: Any) -> str:
    """Map a source's free-text error to an unknown reason."""
    t = str(text or "").lower()
    if "429" in t or "rate limit" in t or "too many" in t or "slow down" in t:
        return "rate_limited"
    if "no verdict" in t or "looks the same" in t or "ambiguous" in t:
        return "ambiguous"
    if "login" in t or "sign in" in t or "signin" in t or "log in" in t:
        return "login_wall"
    return "blocked"


def walled_rows(ctx: Any, module: Any, target: Any, account: str, *, skip: set[str] | frozenset[str] = frozenset()
                ) -> list[dict[str, Any]]:
    """One unknown (login_wall) row per walled platform not in `skip`."""
    return [
        ctx.finding(module, target, platform=info["label"], status="error", url=walled_url(key, account),
                    meta=unknown_meta("login_wall", info["note"]), discriminator="walled")
        for key, info in WALLED.items() if key not in skip
    ]
