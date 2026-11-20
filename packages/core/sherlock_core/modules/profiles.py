"""Public profile fields for a username, one small module per platform.

Existence checkers only say "this account exists". These modules read the profile the
account publishes (display name, bio, location, links, avatar, handles on other
platforms) through each platform's official, keyless, documented public API, which is
what the correlation engine needs to link accounts.

Every module makes one GET, emits at most one `found` row and stores nothing beyond the
contract keys in docs/CONTRACTS.md. Handles on other platforms are emitted under the
target platform's name (`twitter`, `github`, `reddit`, ...) like `modules/github.py`;
anything else the profile points at goes into `links`.
"""
from __future__ import annotations

import html
import re
from datetime import UTC, datetime
from typing import Any, ClassVar
from urllib.parse import quote

from sherlock_core.modules import register
from sherlock_core.modules._util import clean, describe_http_error, error_finding, json_or_none
from sherlock_core.modules.base import Module, ModuleContext, Target

TIMEOUT_S = 10.0
_HANDLE_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9._\-]{0,62}$")
_BREAK_RE = re.compile(r"<\s*(?:br\s*/?|/p|/div|/li)\s*>", re.I)
_TAG_RE = re.compile(r"<[^>]{0,2000}>")
_HREF_RE = re.compile(r"""href\s*=\s*["'](https?://[^"'\s]+)["']""", re.I)
_MAX_BIO = 2000
_MAX_LINKS = 20

Profile = tuple[str | None, dict[str, Any]]      # (public profile URL, extra)


# ----------------------------------------------------------------------------- helpers
def _d(v: Any) -> dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def strip_html(value: Any) -> str:
    """Plain text of an HTML-ish profile field (tags dropped, entities decoded)."""
    if not isinstance(value, str):
        return ""
    text = html.unescape(_TAG_RE.sub("", _BREAK_RE.sub("\n", value)))
    lines = [re.sub(r"[ \t\r\f\v]+", " ", ln).strip() for ln in text.split("\n")]
    return "\n".join(ln for ln in lines if ln)[:_MAX_BIO]


def as_url(value: Any) -> str:
    """A web URL from a profile field ('' when it is not one). Scheme-less values get https."""
    v = _s(value)
    if not v or " " in v or "." not in v or "@" in v.split("/", 1)[0]:
        return ""
    if "://" not in v:
        v = f"https://{v}"
    return v if v.lower().startswith(("http://", "https://")) else ""


def join_links(*values: Any) -> str:
    """Comma-separated, de-duplicated outbound URLs."""
    urls = [u for u in (as_url(v) for v in values) if u and "," not in u]
    return ", ".join(list(dict.fromkeys(urls))[:_MAX_LINKS])


def iso_from_epoch(value: Any, *, ms: bool = False) -> str | None:
    if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value / 1000 if ms else value, UTC).isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def _own_avatar(value: Any) -> str:
    """Avatar URL, unless it is the platform's placeholder (identical on unrelated accounts)."""
    u = as_url(value)
    return "" if u.rsplit("/", 1)[-1].startswith(("missing.", "no-avatar.")) else u


def _real_email(value: Any) -> str:
    e = _s(value)
    return "" if not e or "noreply" in e.lower() or "no-reply" in e.lower() else e


class ProfileModule(Module):
    """One GET against a public profile API -> at most one `found` row."""

    platform: ClassVar[str]
    inputs = ("username",)
    queue = "identity"
    timeout_s = 30.0
    lowercase: ClassVar[bool] = False        # the API only knows lower-case handles

    def request(self, handle: str) -> tuple[str, dict[str, str] | None]:
        """(URL, query parameters) of the lookup."""
        raise NotImplementedError

    def parse(self, handle: str, data: Any) -> Profile | None:
        """(profile URL, extra) from the decoded body, or None when it is not this account."""
        raise NotImplementedError

    def handle_of(self, value: str) -> str | None:
        h = value.strip().lstrip("@")
        if not _HANDLE_RE.match(h):
            return None
        return h.lower() if self.lowercase else h

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        handle = self.handle_of(target.value)
        if not handle:
            return []
        url, params = self.request(handle)
        r = await ctx.http.get(url, params=params, headers={"Accept": "application/json"}, timeout=TIMEOUT_S)
        if r.status_code in (403, 429):
            return [error_finding(ctx, self, target, self.platform, describe_http_error(r))]
        if 400 <= r.status_code < 500:       # 404, or 400 "no such user" (Bluesky, Codeforces)
            return []
        r.raise_for_status()
        parsed = self.parse(handle, json_or_none(r))
        if not parsed:
            return []
        profile_url, extra = parsed
        return [ctx.finding(self, target, platform=self.platform, url=profile_url, extra=clean(extra))]


# ----------------------------------------------------------------------------- GitLab
@register
class GitLabProfile(ProfileModule):
    name = "profile_gitlab"
    title = "GitLab profile"
    description = "Public name, avatar and public email of a gitlab.com account."
    platform = "gitlab"
    source_url = "https://docs.gitlab.com/api/users/"

    def request(self, handle):
        return "https://gitlab.com/api/v4/users", {"username": handle}

    def parse(self, handle, data):
        # Without a token the API only answers the username search, with basic fields.
        for u in data if isinstance(data, list) else []:
            if isinstance(u, dict) and _s(u.get("username")).lower() == handle.lower():
                return _s(u.get("web_url")) or f"https://gitlab.com/{handle}", {
                    "fullname": u.get("name"),
                    "email": _real_email(u.get("public_email")),
                    "avatar_url": as_url(u.get("avatar_url")),
                }
        return None


# ----------------------------------------------------------------------------- Keybase
_KEYBASE_HANDLE_PROOFS = ("twitter", "github", "reddit", "facebook")


@register
class KeybaseProfile(ProfileModule):
    name = "profile_keybase"
    title = "Keybase profile and proofs"
    description = "Public Keybase profile and the accounts and sites its owner has cryptographically proven."
    platform = "keybase"
    source_url = "https://keybase.io/docs/api/1.0/call/user/lookup"
    lowercase = True

    def request(self, handle):
        return "https://keybase.io/_/api/1.0/user/lookup.json", {
            "usernames": handle, "fields": "basics,profile,proofs_summary,pictures",
        }

    def parse(self, handle, data):
        them = _d(data).get("them")
        u = them[0] if isinstance(them, list) and them and isinstance(them[0], dict) else None
        if not u:
            return None
        basics, profile = _d(u.get("basics")), _d(u.get("profile"))
        extra: dict[str, Any] = {
            "fullname": profile.get("full_name"),
            "bio": strip_html(profile.get("bio")),
            "location": profile.get("location"),
            "avatar_url": _d(_d(u.get("pictures")).get("primary")).get("url"),
            "created_at": iso_from_epoch(basics.get("ctime")),
        }
        links: list[str] = []
        for p in _d(u.get("proofs_summary")).get("all") or []:
            if not isinstance(p, dict) or p.get("state") != 1:      # 1 = proof currently verified
                continue
            kind, tag = _s(p.get("proof_type")), _s(p.get("nametag"))
            if kind in _KEYBASE_HANDLE_PROOFS and tag and kind not in extra:
                extra[kind] = tag
            else:
                links.append(p.get("service_url"))
        extra["links"] = join_links(*links)
        return f"https://keybase.io/{_s(basics.get('username')) or handle}", extra


# ----------------------------------------------------------------------------- Hacker News
@register
class HackerNewsProfile(ProfileModule):
    name = "profile_hackernews"
    title = "Hacker News profile"
    description = "Public 'about' text, creation date and karma of a Hacker News account (case-sensitive)."
    platform = "hackernews"
    source_url = "https://github.com/HackerNews/API"

    def request(self, handle):
        return f"https://hacker-news.firebaseio.com/v0/user/{quote(handle, safe='')}.json", None

    def parse(self, handle, data):
        if not isinstance(data, dict) or not data.get("id"):       # unknown users answer `null`
            return None
        return f"https://news.ycombinator.com/user?id={quote(str(data['id']), safe='')}", {
            "bio": strip_html(data.get("about")),
            "created_at": iso_from_epoch(data.get("created")),
            "karma": data.get("karma"),
        }


# ----------------------------------------------------------------------------- Bluesky
@register
class BlueskyProfile(ProfileModule):
    name = "profile_bluesky"
    title = "Bluesky profile"
    description = "Public Bluesky profile; a name without a dot is looked up as <name>.bsky.social."
    platform = "bluesky"
    source_url = "https://docs.bsky.app/docs/api/app-bsky-actor-get-profile"
    lowercase = True

    def request(self, handle):
        actor = handle if "." in handle else f"{handle}.bsky.social"
        return "https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile", {"actor": actor}

    def parse(self, handle, data):
        if not isinstance(data, dict) or not data.get("handle"):
            return None
        return f"https://bsky.app/profile/{data['handle']}", {
            "fullname": data.get("displayName"),
            "bio": strip_html(data.get("description")),
            "avatar_url": data.get("avatar"),
            "created_at": data.get("createdAt"),
            "followers": data.get("followersCount"),
            "following": data.get("followsCount"),
        }


# ----------------------------------------------------------------------------- Mastodon
@register
class MastodonProfile(ProfileModule):
    name = "profile_mastodon"
    title = "Mastodon profile (mastodon.social)"
    description = "Public profile and profile-field links of an account on mastodon.social."
    platform = "mastodon"
    source_url = "https://docs.joinmastodon.org/methods/accounts/#lookup"

    def request(self, handle):
        return "https://mastodon.social/api/v1/accounts/lookup", {"acct": handle}

    def parse(self, handle, data):
        if not isinstance(data, dict) or not data.get("username"):
            return None
        links: list[str] = []
        for f in data.get("fields") or []:
            value = _s(_d(f).get("value"))
            links.extend(_HREF_RE.findall(value) or [strip_html(value)])
        return _s(data.get("url")) or f"https://mastodon.social/@{data['username']}", {
            "fullname": data.get("display_name"),
            "bio": strip_html(data.get("note")),
            "links": join_links(*links),
            "avatar_url": _own_avatar(data.get("avatar_static") or data.get("avatar")),
            "created_at": data.get("created_at"),
            "followers": data.get("followers_count"),
            "following": data.get("following_count"),
        }


# ----------------------------------------------------------------------------- DEV
def _devto_date(value: Any) -> str | None:
    try:
        return datetime.strptime(_s(value), "%b %d, %Y").date().isoformat()   # "Dec 27, 2015"
    except ValueError:
        return None


@register
class DevToProfile(ProfileModule):
    name = "profile_devto"
    title = "DEV Community profile"
    description = "Public dev.to profile, including the Twitter and GitHub handles it names."
    platform = "devto"
    source_url = "https://developers.forem.com/api/v1#tag/users"

    def request(self, handle):
        return "https://dev.to/api/users/by_username", {"url": handle}

    def parse(self, handle, data):
        if not isinstance(data, dict) or not data.get("username"):
            return None
        return f"https://dev.to/{data['username']}", {
            "fullname": data.get("name"),
            "bio": strip_html(data.get("summary")),
            "location": data.get("location"),
            "links": join_links(data.get("website_url")),
            "twitter": data.get("twitter_username"),
            "github": data.get("github_username"),
            "avatar_url": data.get("profile_image"),
            "created_at": _devto_date(data.get("joined_at")),
        }


# ----------------------------------------------------------------------------- Lichess
@register
class LichessProfile(ProfileModule):
    name = "profile_lichess"
    title = "Lichess profile"
    description = "Public Lichess profile: name, bio, location and the links the player lists."
    platform = "lichess"
    source_url = "https://lichess.org/api#tag/Users/operation/apiUser"

    def request(self, handle):
        return f"https://lichess.org/api/user/{quote(handle, safe='')}", None

    def parse(self, handle, data):
        if not isinstance(data, dict) or not data.get("username"):
            return None
        profile = _d(data.get("profile"))
        channels = [_d(c).get("channel") for c in _d(data.get("streamer")).values()]
        return _s(data.get("url")) or f"https://lichess.org/@/{data['username']}", {
            "fullname": profile.get("realName"),
            "bio": strip_html(profile.get("bio")),
            "location": profile.get("location"),
            "links": join_links(*_s(profile.get("links")).split(), *channels),
            "created_at": iso_from_epoch(data.get("createdAt"), ms=True),
        }


# ----------------------------------------------------------------------------- Chess.com
@register
class ChessComProfile(ProfileModule):
    name = "profile_chesscom"
    title = "Chess.com profile"
    description = "Public Chess.com player profile: name, location, avatar and streaming links."
    platform = "chess.com"
    source_url = "https://www.chess.com/news/view/published-data-api"
    lowercase = True

    def request(self, handle):
        return f"https://api.chess.com/pub/player/{quote(handle, safe='')}", None

    def parse(self, handle, data):
        if not isinstance(data, dict) or not data.get("username"):
            return None
        streams = [_d(s).get("channel_url") for s in data.get("streaming_platforms") or []]
        return _s(data.get("url")) or f"https://www.chess.com/member/{handle}", {
            "fullname": data.get("name"),
            "location": data.get("location"),
            "links": join_links(data.get("twitch_url"), *streams),
            "avatar_url": data.get("avatar"),
            "created_at": iso_from_epoch(data.get("joined")),
            "followers": data.get("followers"),
        }


# ----------------------------------------------------------------------------- Codeberg
@register
class CodebergProfile(ProfileModule):
    name = "profile_codeberg"
    title = "Codeberg profile"
    description = "Public Codeberg (Forgejo) profile: name, description, location and website."
    platform = "codeberg"
    source_url = "https://codeberg.org/api/swagger"

    def request(self, handle):
        return f"https://codeberg.org/api/v1/users/{quote(handle, safe='')}", None

    def parse(self, handle, data):
        if not isinstance(data, dict) or not data.get("login"):
            return None
        return _s(data.get("html_url")) or f"https://codeberg.org/{data['login']}", {
            "fullname": data.get("full_name"),
            "bio": strip_html(data.get("description")),
            "location": data.get("location"),
            "email": _real_email(data.get("email")),
            "links": join_links(data.get("website")),
            "avatar_url": data.get("avatar_url"),
            "created_at": data.get("created"),
            "followers": data.get("followers_count"),
            "following": data.get("following_count"),
        }


# ----------------------------------------------------------------------------- npm
@register
class NpmProfile(ProfileModule):
    name = "profile_npm"
    title = "npm maintainer"
    description = "The email an npm account publishes as maintainer of its public packages."
    platform = "npm"
    source_url = "https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md#get-v1search"
    lowercase = True

    def request(self, handle):
        # The registry has no keyless user endpoint; the search API lists package maintainers.
        return "https://registry.npmjs.org/-/v1/search", {"text": f"maintainer:{handle}", "size": "5"}

    def parse(self, handle, data):
        for obj in _d(data).get("objects") or []:
            pkg = _d(_d(obj).get("package"))
            for m in [*(pkg.get("maintainers") or []), pkg.get("publisher")]:
                if _s(_d(m).get("username")).lower() == handle:
                    return f"https://www.npmjs.com/~{handle}", {"email": _real_email(_d(m).get("email"))}
        return None


# ----------------------------------------------------------------------------- Docker Hub
@register
class DockerHubProfile(ProfileModule):
    name = "profile_dockerhub"
    title = "Docker Hub profile"
    description = "Public Docker Hub profile: name, location, website and Gravatar details."
    platform = "dockerhub"
    source_url = "https://docs.docker.com/reference/api/hub/latest/"
    lowercase = True

    def request(self, handle):
        return f"https://hub.docker.com/v2/users/{quote(handle, safe='')}/", None

    def parse(self, handle, data):
        if not isinstance(data, dict) or not (data.get("username") or data.get("orgname")):
            return None
        return f"https://hub.docker.com/u/{handle}", {
            "fullname": data.get("full_name"),
            "location": data.get("location"),
            "email": _real_email(data.get("gravatar_email")),
            "links": join_links(data.get("profile_url")),
            "avatar_url": data.get("gravatar_url"),
            "created_at": data.get("date_joined"),
        }


# ----------------------------------------------------------------------------- Hugging Face
@register
class HuggingFaceProfile(ProfileModule):
    name = "profile_huggingface"
    title = "Hugging Face profile"
    description = "Public Hugging Face user overview: name, avatar and follower counts."
    platform = "huggingface"
    source_url = "https://huggingface.co/docs/hub/api"

    def request(self, handle):
        return f"https://huggingface.co/api/users/{quote(handle, safe='')}/overview", None

    def parse(self, handle, data):
        if not isinstance(data, dict) or not (data.get("user") or data.get("fullname")):
            return None
        avatar = _s(data.get("avatarUrl"))
        return f"https://huggingface.co/{_s(data.get('user')) or handle}", {
            "fullname": data.get("fullname"),
            "avatar_url": f"https://huggingface.co{avatar}" if avatar.startswith("/") else avatar,
            "created_at": data.get("createdAt"),
            "followers": data.get("numFollowers"),
            "following": data.get("numFollowing"),
        }


# ----------------------------------------------------------------------------- Codeforces
@register
class CodeforcesProfile(ProfileModule):
    name = "profile_codeforces"
    title = "Codeforces profile"
    description = "Public Codeforces profile: name, city and country, avatar and registration date."
    platform = "codeforces"
    source_url = "https://codeforces.com/apiHelp/methods#user.info"

    def request(self, handle):
        return "https://codeforces.com/api/user.info", {"handles": handle}

    def parse(self, handle, data):
        result = _d(data).get("result")
        u = result[0] if isinstance(result, list) and result and isinstance(result[0], dict) else None
        if not u or not u.get("handle"):
            return None
        return f"https://codeforces.com/profile/{u['handle']}", {
            "fullname": " ".join(p for p in (_s(u.get("firstName")), _s(u.get("lastName"))) if p),
            "location": ", ".join(p for p in (_s(u.get("city")), _s(u.get("country"))) if p),
            "avatar_url": _own_avatar(u.get("avatar")),
            "created_at": iso_from_epoch(u.get("registrationTimeSeconds")),
            "followers": u.get("friendOfCount"),
        }
