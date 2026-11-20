"""user-scanner library sweep: is this username / email registered on a few thousand sites.

Emits the `found` rows plus one summary row with the coverage counts (pass the target
param `include_all` to get a row per site, as the legacy collector did).

The library does its own networking (the one module allowed to bypass `ctx.http`).
Its import is at module level on purpose: when the optional dependency is missing the
registry skips this file.
"""
from __future__ import annotations

import os
from typing import Any

from user_scanner.core.engine import check_all  # optional dep: ImportError => module skipped

from sherlock_core.modules import register
from sherlock_core.modules.base import Module, ModuleContext, Target

_STATUS: dict[Any, str] = {0: "found", 1: "not_found", 2: "error"}  # 3 = skipped, dropped


def result_to_finding(module: Module, target: Target, ctx: ModuleContext, result: Any) -> dict[str, Any] | None:
    status = _STATUS.get(getattr(result.status, "value", None))
    if status is None or not result.site_name:
        return None
    extra = dict(result.extra or {})
    media = dict(result.media or {})
    avatar = media.get("avatar") or media.get("avatar_url")
    if status == "found" and avatar and "avatar_url" not in extra:
        extra["avatar_url"] = avatar
    return ctx.finding(
        module, target,
        source_tool="user-scanner",  # legacy name, kept so old and new rows share finding keys
        platform=result.site_name, status=status, url=result.url or None, extra=extra,
        meta={
            "category": result.category,
            "reason": str(result.reason) if result.reason else None,
            "media": media,
        },
    )


_USERNAME_SWEEP = os.getenv("USER_SCANNER_USERNAMES", "").strip().lower() in ("1", "true", "yes")


@register
class UserScanner(Module):
    name = "user_scanner"
    title = "Account sweep (user-scanner)"
    description = "Checks whether a username or email is registered on a few thousand public sites."
    # The username sweep covers ~2,500 sites and cannot finish on a 0.1-CPU host (measured:
    # it hits the timeout on every attempt and blocks the queue), so it is opt-in. The
    # 690-site WhatsMyName check and the profile modules cover usernames by default. The
    # email sweep (~200 sites) is small enough to stay on.
    inputs = ("username", "email") if _USERNAME_SWEEP else ("email",)
    queue = "identity"
    source_url = "https://github.com/kaifcodec/user-scanner"
    timeout_s = 420.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        await ctx.progress(5, "sweeping sites")
        results = await check_all(target.value.strip(), is_email=target.type == "email")
        await ctx.progress(95, f"{len(results)} sites answered")
        rows = [f for r in results if (f := result_to_finding(self, target, ctx, r))]
        if not rows or target.params.get("include_all"):
            return rows  # legacy behaviour: one row per site, whatever its status
        # The library covers ~2500 sites: store the hits and one coverage row, not thousands of misses.
        counts = {s: sum(1 for f in rows if f["status"] == s) for s in ("found", "not_found", "error")}
        found = [f for f in rows if f["status"] == "found"]
        found.append(ctx.finding(
            self, target, source_tool="user-scanner", platform="user-scanner", url=self.source_url,
            status="found" if found else "not_found",
            meta={
                "summary": True, "checked": len(rows), "found": counts["found"],
                "not_found": counts["not_found"], "errors": counts["error"],
            },
        ))
        return found
