"""Public Gravatar profile for an email (name, bio, location, linked accounts)."""
from __future__ import annotations

import hashlib
from typing import Any

from sherlock_core.modules import register
from sherlock_core.modules._util import clean, describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target

API = "https://en.gravatar.com/{hash}.json"


@register
class Gravatar(Module):
    name = "gravatar"
    title = "Gravatar profile"
    description = "Looks up the public Gravatar profile tied to an email address."
    inputs = ("email",)
    queue = "identity"
    source_url = "https://docs.gravatar.com/"
    timeout_s = 30.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        email = target.value.strip().lower()
        md5 = hashlib.md5(email.encode()).hexdigest()  # noqa: S324 - Gravatar's lookup key, not security
        r = await ctx.http.get(API.format(hash=md5), timeout=10.0)
        if r.status_code in (403, 429):
            return [error_finding(ctx, self, target, "gravatar", describe_http_error(r))]
        if r.status_code != 200:
            return []
        body = json_or_none(r)  # an unknown hash answers 200 with an empty body
        entries = body.get("entry") if isinstance(body, dict) else None
        if not entries or not isinstance(entries[0], dict):
            return []
        e = entries[0]
        name = e.get("name") if isinstance(e.get("name"), dict) else {}
        accounts = [a for a in e.get("accounts") or [] if isinstance(a, dict)]
        links = [a["url"] for a in accounts if a.get("url")]
        links += [u["value"] for u in e.get("urls") or [] if isinstance(u, dict) and u.get("value")]
        emails = [x["value"] for x in e.get("emails") or [] if isinstance(x, dict) and x.get("value")]
        extra = clean({
            "gravatar_id": e.get("hash"),
            "username": e.get("preferredUsername"),
            "fullname": e.get("displayName") or name.get("formatted"),
            "bio": e.get("aboutMe"),
            "location": e.get("currentLocation"),
            "company": e.get("company"),
            "job_title": e.get("job_title"),
            "avatar_url": e.get("thumbnailUrl"),
            "emails": ", ".join(emails),
            "links": ", ".join(dict.fromkeys(links)),
        })
        return [ctx.finding(
            self, target, platform="gravatar",
            url=e.get("profileUrl") or f"https://gravatar.com/{md5}", extra=extra,
        )]
