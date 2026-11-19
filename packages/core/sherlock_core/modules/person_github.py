"""GitHub accounts whose public profile name is the searched name (candidates only).

Verified 2026-11-20 with real requests for "Linus Torvalds" (trimmed into
tests/person/fixtures/github_*.json):
  GET https://api.github.com/search/users?q=fullname:"<name>"&per_page=5
      -> items[]: login, html_url, avatar_url, type           (13 matches, `torvalds` first)
  GET https://api.github.com/users/<login>
      -> name, company, blog, location, email, bio, twitter_username, followers, created_at
Quota without a token: search 10 / minute, everything else 60 / hour per IP; up to 1 + 5
requests per job. When the profile calls are refused (403 / 429) the module keeps the search
hits without profile detail and says so in `partial`. `GITHUB_TOKEN` (optional) lifts both.

A match here is only "an account that displays this name"; it is the resolver's job to decide
whether it belongs to the person being looked for. Nothing is scanned further automatically.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import quote

from sherlock_core.modules import register
from sherlock_core.modules._util import UpstreamError, error_finding
from sherlock_core.modules.base import Module, ModuleContext, Target
from sherlock_core.modules.github import gh_get
from sherlock_core.modules.person_util import MIN_NAME_SCORE, coarse_location, name_gate, person_extra

MAX_ACCOUNTS = 5


@register
class PersonGitHub(Module):
    name = "person_github"
    title = "GitHub accounts by name"
    description = "GitHub accounts whose public profile shows this full name, with their public profile fields."
    inputs = ("name",)
    queue = "identity"
    source_url = "https://docs.github.com/en/rest/search/search#search-users"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        phrase = target.value.replace('"', " ").strip()
        try:
            found = await gh_get(ctx.http, "/search/users", q=f'fullname:"{phrase}"', per_page=MAX_ACCOUNTS)
        except UpstreamError as e:
            return [error_finding(ctx, self, target, "github", str(e))]
        items = [u for u in (found or {}).get("items") or []
                 if isinstance(u, dict) and u.get("login") and u.get("type", "User") == "User"][:MAX_ACCOUNTS]
        await ctx.progress(40, f"{len(items)} account(s)")
        out = []
        limited: str | None = None
        for item in items:
            profile: dict[str, Any] = {}
            if limited is None:
                try:
                    got = await gh_get(ctx.http, f"/users/{quote(item['login'], safe='')}")
                    profile = got if isinstance(got, dict) else {}
                except UpstreamError as e:
                    limited = str(e)
            name = str(profile.get("name") or "").strip()
            if name and name_gate(target.value, [name])[0].score < MIN_NAME_SCORE:
                continue
            login = str(item["login"])
            blog = str(profile.get("blog") or "").strip()
            if blog and "://" not in blog:
                blog = f"https://{blog}"
            company = str(profile.get("company") or "").strip().lstrip("@")
            twitter = str(profile.get("twitter_username") or "").strip()
            extra = person_extra(
                fullname=name or target.value,
                kind="profile",
                handles={"github": login.lower(), "twitter": twitter.lower() or None},
                employers=[company] if company else [],
                locations=[loc] if (loc := coarse_location(profile.get("location"))) else [],
                links=[blog] if blog else [],
                emails=[profile["email"]] if profile.get("email") else [],
                description=(str(profile.get("bio") or "").strip()[:500] or None),
                username=login,
                avatar_url=item.get("avatar_url"),
                followers=profile.get("followers"),
                public_repos=profile.get("public_repos"),
                created_at=profile.get("created_at"),
            )
            meta = {"matched_by": "profile name search", **({"partial": limited} if limited else {})}
            out.append(ctx.finding(self, target, platform="github", url=item.get("html_url") or f"https://github.com/{login}",
                                   extra=extra, meta=meta, discriminator=login.lower()))
        return out
