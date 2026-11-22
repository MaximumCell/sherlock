"""user-scanner library checks: is this username / email registered on public sites.

Username searches run a FOCUSED set of the library's per-site checks by default
(`FOCUSED`, ~70 well-known platforms: Instagram, Facebook, TikTok, Threads, LinkedIn,
Snapchat, X, YouTube...), module by module with a bounded semaphore and a per-check
timeout. These checks work where a plain page fetch cannot (see `sherlock_core.walled`),
so for the platforms they cover their verdict wins: WhatsMyName skips its own rules for
them (`covered_platforms`). The full ~2,500-site username sweep cannot finish on a
0.1-CPU host and stays opt-in (`USER_SCANNER_USERNAMES=1`). Email searches run the
library's email sweep (~200 sites).

Outcomes: Found -> `found` (profile URL from the library, else the platform's own),
Not Found -> counted in the summary row, Error / timeout -> `unknown` (status `error`,
`reason` from `walled.reason_from_text`, the library's words in `detail`), Skipped ->
dropped. Plus one summary row with found / not_found / unknown counts.

The library does its own networking (the one module allowed to bypass `ctx.http`).
Its import is at module level on purpose: when the optional dependency is missing the
registry skips this file.
"""
from __future__ import annotations

import asyncio
import importlib.util
import os
from functools import lru_cache
from types import ModuleType
from typing import Any

from user_scanner.core.engine import check, check_all  # optional dep: ImportError => module skipped
from user_scanner.core.helpers import load_categories

from sherlock_core.modules import register
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.walled import is_unknown, reason_from_text, unknown_meta

_STATUS: dict[Any, str] = {0: "found", 1: "not_found", 2: "error"}  # 3 = skipped, dropped

# Default username checks: library category -> module file names. Chosen for value (big
# social networks first, then the creative / dev / music / gaming platforms people reuse a
# handle on); the ~200 Lemmy / small fediverse instances and niche forums are left out.
FOCUSED: dict[str, tuple[str, ...]] = {
    "social": (
        "instagram", "facebook", "tiktok", "threads", "linkedin", "snapchat", "x", "youtube", "pinterest",
        "reddit", "telegram", "discord", "tumblr", "bluesky", "mastodon", "vk", "ok",
        "about_me", "anilist", "blogger", "buzzfeed", "carrd", "clubhouse", "dailymotion", "foursquare",
        "giphy", "goodreads", "gravatar", "imgur", "keybase", "kik", "letterboxd", "livejournal", "matrix",
        "minds", "myanimelist", "speakerdeck", "warpcast", "zhihu", "habr",
    ),
    "creative": ("behance", "deviantart", "dribbble", "flickr"),
    "creator": ("devto", "kaggle", "linktree", "medium", "patreon", "producthunt", "substack", "twitch", "vimeo"),
    "dev": ("github", "gitlab", "bitbucket", "codepen", "dockerhub", "huggingface", "leetcode", "npmjs", "pypi"),
    "gaming": ("chess_com", "roblox", "steam"),
    "music": ("bandcamp", "lastfm", "soundcloud", "spotify"),
}
CHECK_TIMEOUT_S = 25.0      # one site check (the library's own request timeouts are shorter)
CONCURRENCY = 12

# Library module name -> canonical platform key where `platform_info` would not guess it.
_PLATFORM_KEY = {"x": "twitter", "ok": "okru", "about_me": "aboutme", "chess_com": "chess", "devto": "devto",
                 "npmjs": "npm", "lastfm": "lastfm"}


@lru_cache(maxsize=1)
def focused_modules() -> tuple[ModuleType, ...]:
    """The default username checks that exist in the installed library version."""
    cats = load_categories(False)
    out = []
    for cat, names in FOCUSED.items():
        root = cats.get(cat)
        for name in names:
            path = root / f"{name}.py" if root else None
            if path is None or not path.is_file():
                continue
            spec = importlib.util.spec_from_file_location(name, str(path))
            if spec is None or spec.loader is None:
                continue
            mod = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(mod)
            except Exception:  # a broken site module must not cost the others
                continue
            out.append(mod)
    return tuple(out)


def platform_key(module_name: str) -> str:
    from sherlock_core.platforms import platform_info
    return _PLATFORM_KEY.get(module_name) or platform_info(module_name.replace("_", "."))["key"]


@lru_cache(maxsize=1)
def covered_platforms() -> frozenset[str]:
    """Canonical platform keys the default username checks cover (WhatsMyName skips these)."""
    return frozenset(platform_key(n) for names in FOCUSED.values() for n in names)


def _profile_url(result: Any) -> str | None:
    url = getattr(result, "url", "") or ""
    return url if isinstance(url, str) and url.startswith(("http://", "https://")) else None


def result_to_finding(module: Module, target: Target, ctx: ModuleContext, result: Any) -> dict[str, Any] | None:
    status = _STATUS.get(getattr(result.status, "value", None))
    if status is None or not result.site_name:
        return None
    extra = dict(result.extra or {})
    media = dict(result.media or {})
    avatar = media.get("avatar") or media.get("avatar_url")
    if status == "found" and avatar and "avatar_url" not in extra:
        extra["avatar_url"] = avatar
    reason = str(result.reason) if result.reason else None
    meta: dict[str, Any] = {"category": result.category, "media": media}
    if status == "error":
        meta.update(unknown_meta(reason_from_text(reason), reason or "the check failed"))
    else:
        meta["reason"] = reason
    return ctx.finding(
        module, target,
        source_tool="user-scanner",  # legacy name, kept so old and new rows share finding keys
        platform=result.site_name, status=status, url=_profile_url(result), extra=extra, meta=meta,
    )


_USERNAME_SWEEP = os.getenv("USER_SCANNER_USERNAMES", "").strip().lower() in ("1", "true", "yes")


@register
class UserScanner(Module):
    name = "user_scanner"
    title = "Account checks (user-scanner)"
    description = ("Checks whether a username is registered on ~70 well-known platforms (Instagram, "
                   "Facebook, TikTok, LinkedIn...), or an email on a few hundred sites.")
    inputs = ("username", "email")
    queue = "identity"
    source_url = "https://github.com/kaifcodec/user-scanner"
    timeout_s = 420.0
    heavy = True  # thousands of site checks for emails / the full sweep; memory-heavy like whatsmyname

    def covers(self) -> frozenset[str]:
        """Platforms whose verdict comes from here for username searches (WhatsMyName skips them)."""
        return frozenset() if _USERNAME_SWEEP else covered_platforms()

    async def _focused(self, value: str, ctx: ModuleContext) -> list[Any]:
        mods = focused_modules()
        sem = asyncio.Semaphore(CONCURRENCY)
        results: list[Any] = []
        done = 0

        async def one(m: ModuleType) -> None:
            nonlocal done
            async with sem:
                try:
                    r = await asyncio.wait_for(check(m, value), CHECK_TIMEOUT_S)
                except TimeoutError:
                    r = _timeout_result(m, value)
            results.append(r)
            done += 1
            if done % 10 == 0:
                await ctx.progress(min(95, 5 + done * 90 // max(1, len(mods))), f"{done}/{len(mods)} sites")

        await asyncio.gather(*(one(m) for m in mods))
        return results

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        await ctx.progress(5, "checking sites")
        value = target.value.strip()
        if target.type == "username" and not _USERNAME_SWEEP:
            results = await self._focused(value.lstrip("@"), ctx)
        else:
            results = await check_all(value, is_email=target.type == "email")
        await ctx.progress(95, f"{len(results)} sites answered")
        rows = [f for r in results if (f := result_to_finding(self, target, ctx, r))]
        if not rows or target.params.get("include_all"):
            return rows  # legacy behaviour: one row per site, whatever its status
        unknown = [f for f in rows if is_unknown(f)]
        counts = {s: sum(1 for f in rows if f["status"] == s) for s in ("found", "not_found", "error")}
        if target.type == "username" and counts["error"] == len(rows):
            raise RuntimeError("user_scanner: every site check failed (no network?)")
        kept = [f for f in rows if f["status"] == "found"]
        # an email sweep's errors are hundreds of small sites: counted, not listed
        if target.type == "username":
            kept += unknown
        kept.append(ctx.finding(
            self, target, source_tool="user-scanner", platform="user-scanner", url=self.source_url,
            status="found" if counts["found"] else "not_found",
            meta={
                "summary": True, "checked": len(rows), "found": counts["found"],
                "not_found": counts["not_found"], "unknown": len(unknown), "errors": counts["error"],
                "mode": "focused" if target.type == "username" and not _USERNAME_SWEEP else "full",
            },
        ))
        return kept


def _timeout_result(module: ModuleType, value: str) -> Any:
    from user_scanner.core.helpers import find_category, get_site_name
    from user_scanner.core.result import Result
    return Result.error(f"no answer within {CHECK_TIMEOUT_S:g}s").update(
        site_name=get_site_name(module), username=value, category=find_category(module) or "Username")
