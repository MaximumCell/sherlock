"""GitHub public profile, public commit emails and email -> account lookup (REST API).

Unauthenticated calls are limited to 60 per hour per IP (search: 10 per minute), so the
module makes few requests; `GITHUB_TOKEN` (optional) raises the limits.
"""
from __future__ import annotations

import asyncio
import os
from typing import Any
from urllib.parse import quote

import httpx

from sherlock_core.modules import register
from sherlock_core.modules._util import EMAIL_RE, UpstreamError, clean, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://api.github.com"
MAX_COMMIT_LOOKUPS = 3          # without a token
MAX_COMMIT_LOOKUPS_TOKEN = 10
MAX_ACCOUNTS = 5


def gh_headers() -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    token = os.getenv("GITHUB_TOKEN", "").strip()
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _is_noreply(email: str) -> bool:
    e = email.lower()
    return "noreply" in e or "no-reply" in e or e.endswith((".local", ".localdomain", "@localhost"))


async def gh_get(http: httpx.AsyncClient, path: str, **params: Any) -> Any:
    """GET a GitHub API path. Returns parsed JSON, or None for 404 / 422. Raises UpstreamError when limited."""
    r = await http.get(f"{API}{path}", params=params or None, headers=gh_headers(), timeout=15.0)
    if r.status_code in (404, 422):
        return None
    if r.status_code in (403, 429):
        if r.headers.get("x-ratelimit-remaining") == "0" or "rate limit" in r.text.lower():
            raise UpstreamError("GitHub API rate limit reached (set GITHUB_TOKEN to raise it)")
        raise UpstreamError(f"GitHub API refused the request (HTTP {r.status_code})")
    if r.status_code == 401:
        raise UpstreamError("GitHub rejected GITHUB_TOKEN (HTTP 401)")
    r.raise_for_status()
    return json_or_none(r)


def _profile_extra(u: dict[str, Any]) -> dict[str, Any]:
    blog = (u.get("blog") or "").strip()
    if blog and "://" not in blog:
        blog = f"https://{blog}"
    return clean({
        "username": u.get("login"),
        "fullname": u.get("name"),
        "bio": u.get("bio"),
        "location": u.get("location"),
        "company": u.get("company"),
        "email": u.get("email"),
        "links": blog,
        "twitter": u.get("twitter_username"),
        "avatar_url": u.get("avatar_url"),
        "created_at": u.get("created_at"),
        "followers": u.get("followers"),
        "following": u.get("following"),
        "public_repos": u.get("public_repos"),
        "account_type": u.get("type"),
    })


@register
class GitHub(Module):
    name = "github"
    title = "GitHub profile and commit emails"
    description = (
        "Public GitHub profile, emails published in the account's own recent public commits, "
        "and accounts linked to an email address."
    )
    inputs = ("username", "email")
    queue = "identity"
    source_url = "https://docs.github.com/en/rest"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            if target.type == "email":
                return await self._by_email(target, ctx)
            return await self._by_username(target, ctx)
        except UpstreamError as e:
            return [error_finding(ctx, self, target, "github", str(e))]

    # ---------------------------------------------------------------- username
    async def _by_username(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        login = target.value.strip().lstrip("@")
        user = await gh_get(ctx.http, f"/users/{quote(login, safe='')}")
        if not isinstance(user, dict) or not user.get("login"):
            return []
        extra = _profile_extra(user)
        await ctx.progress(40, "profile fetched")
        note = None
        try:
            commit_emails = await self._commit_emails(user["login"], ctx)
        except UpstreamError as e:  # keep the profile even when the extra calls are limited
            commit_emails, note = [], str(e)
        emails = list(dict.fromkeys([e for e in [user.get("email"), *commit_emails] if e]))
        if emails:
            extra["email"] = emails[0]
            extra["emails"] = ", ".join(emails)
        meta = clean({"commit_emails": commit_emails, "partial": note})
        return [ctx.finding(self, target, platform="github", url=user.get("html_url"), extra=extra, meta=meta)]

    async def _commit_emails(self, login: str, ctx: ModuleContext) -> list[str]:
        """Author emails of the account's own recent public pushes.

        Push events no longer embed commits, so the head commit of a few distinct
        repositories is fetched and kept only when GitHub attributes it to `login`.
        """
        events = await gh_get(ctx.http, f"/users/{quote(login, safe='')}/events/public", per_page=100)
        heads: dict[str, str] = {}
        for ev in events if isinstance(events, list) else []:
            if not isinstance(ev, dict) or ev.get("type") != "PushEvent":
                continue
            repo = (ev.get("repo") or {}).get("name")
            head = (ev.get("payload") or {}).get("head")
            if repo and head and repo not in heads:
                heads[repo] = head
        cap = MAX_COMMIT_LOOKUPS_TOKEN if os.getenv("GITHUB_TOKEN") else MAX_COMMIT_LOOKUPS
        sem = asyncio.Semaphore(min(ctx.max_concurrency, 4))

        async def one(repo: str, sha: str) -> str | None:
            async with sem:
                try:
                    c = await gh_get(ctx.http, f"/repos/{repo}/commits/{sha}")
                except (UpstreamError, httpx.HTTPError) as e:
                    ctx.log.info("github commit lookup %s skipped: %s", repo, e)
                    return None
            if not isinstance(c, dict):
                return None
            author_login = ((c.get("author") or {}).get("login") or "").lower()
            email = (((c.get("commit") or {}).get("author") or {}).get("email") or "").strip().lower()
            if author_login != login.lower() or not EMAIL_RE.match(email) or _is_noreply(email):
                return None
            return email

        found = await asyncio.gather(*(one(r, s) for r, s in list(heads.items())[:cap]))
        return list(dict.fromkeys(e for e in found if e))

    # ------------------------------------------------------------------- email
    async def _by_email(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        email = target.value.strip().lower()
        if not EMAIL_RE.match(email):
            return []
        accounts: dict[str, dict[str, Any]] = {}
        errors: list[str] = []

        try:
            users = await gh_get(ctx.http, "/search/users", q=f"{email} in:email", per_page=MAX_ACCOUNTS)
            for u in (users or {}).get("items") or []:
                if isinstance(u, dict) and u.get("login"):
                    accounts[u["login"].lower()] = {
                        "login": u["login"], "url": u.get("html_url"), "avatar_url": u.get("avatar_url"),
                        "matched_by": "public profile email",
                    }
        except UpstreamError as e:
            errors.append(str(e))
        await ctx.progress(50, "searching commits")
        try:
            commits = await gh_get(
                ctx.http, "/search/commits", q=f"author-email:{email}", per_page=20, sort="author-date",
            )
            for c in (commits or {}).get("items") or []:
                if not isinstance(c, dict):
                    continue
                author = c.get("author") or {}
                ca = (c.get("commit") or {}).get("author") or {}
                # GitHub only links a commit to an account that has verified the address
                if not author.get("login") or (ca.get("email") or "").lower() != email:
                    continue
                # (the commit's free-text author name is not trusted: anyone can set it)
                accounts.setdefault(author["login"].lower(), {
                    "login": author["login"], "url": author.get("html_url"),
                    "avatar_url": author.get("avatar_url"), "matched_by": "commit author email",
                })
        except UpstreamError as e:
            errors.append(str(e))

        out = [
            ctx.finding(
                self, target, platform="github", url=a.get("url") or f"https://github.com/{a['login']}",
                extra=clean({
                    "username": a["login"], "email": email, "avatar_url": a.get("avatar_url"),
                }),
                meta={"matched_by": a["matched_by"]}, discriminator=a["login"].lower(),
            )
            for a in list(accounts.values())[:MAX_ACCOUNTS]
        ]
        if errors and not out:
            return [error_finding(ctx, self, target, "github", errors[0])]
        return out
