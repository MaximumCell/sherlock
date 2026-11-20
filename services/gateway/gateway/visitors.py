"""Where a request comes from, reduced to what the operator panel may keep.

Privacy rules (docs/CONTRACTS.md, "Operator panel"):
- The raw client IP never leaves this module. It is turned into `ip_hash`, the first 16 hex
  characters of HMAC-SHA256(INTERNAL_SECRET, ip): enough to see that two sessions share an
  origin, not enough to recover the address.
- `country` only comes from a trusted edge header (`CF-IPCountry`). No geo-IP service is called.
- The user agent is kept truncated to 300 characters; the web app shows it as "Browser on OS".
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import re
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from fastapi import Request
from sherlock_core import config
from sherlock_core.store import USER_AGENT_MAX, get_store

if TYPE_CHECKING:
    from gateway.auth import Principal

log = logging.getLogger("sherlock.gateway.visitors")

TOUCH_EVERY_S = 60.0       # at most one visitor_sessions write per session per minute
TOUCH_CACHE_MAX = 5000
_COUNTRY = re.compile(r"^[A-Z]{2}$")

_touched: dict[str, float] = {}


@dataclass(frozen=True)
class Origin:
    ip_hash: str | None = None
    country: str | None = None
    user_agent: str | None = None


def hash_ip(ip: str) -> str:
    """First 16 hex chars of HMAC-SHA256(INTERNAL_SECRET, ip)."""
    return hmac.new(config.INTERNAL_SECRET.encode(), ip.encode(), hashlib.sha256).hexdigest()[:16]


def client_ip(request: Request) -> str | None:
    """First hop of X-Forwarded-For (set by Render's edge), else the socket peer."""
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    if first:
        return first
    return request.client.host if request.client else None


def edge_country(request: Request) -> str | None:
    value = request.headers.get("cf-ipcountry", "").strip().upper()
    return value if _COUNTRY.match(value) and value != "XX" else None


def client_origin(request: Request) -> Origin:
    ip = client_ip(request)
    ua = request.headers.get("user-agent", "").strip()
    return Origin(ip_hash=hash_ip(ip) if ip else None, country=edge_country(request),
                  user_agent=ua[:USER_AGENT_MAX] or None)


def get_origin(request: Request) -> Origin:
    """FastAPI dependency."""
    return client_origin(request)


def _touch(principal: Principal, origin: Origin) -> None:
    try:
        get_store().touch_session(principal.user_id, is_anonymous=principal.is_anonymous,
                                  email=principal.email if principal.email_verified else None,
                                  ip_hash=origin.ip_hash, country=origin.country, user_agent=origin.user_agent)
    except Exception as e:  # monitoring must never break a command (e.g. 0002_admin.sql not applied yet)
        log.warning("visitor touch failed: %s", type(e).__name__)


async def touch_visitor(principal: Principal, origin: Origin) -> None:
    """Record that this session made a request; throttled to once a minute per session."""
    now = time.monotonic()
    last = _touched.get(principal.user_id)
    if last is not None and now - last < TOUCH_EVERY_S:
        return
    if len(_touched) >= TOUCH_CACHE_MAX:
        _touched.clear()
    _touched[principal.user_id] = now
    await asyncio.to_thread(_touch, principal, origin)


def reset_touch_cache() -> None:
    """Tests: forget which sessions were touched recently."""
    _touched.clear()
