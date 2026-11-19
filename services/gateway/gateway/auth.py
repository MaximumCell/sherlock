"""Bearer-token auth: a Supabase access token resolves to a `Principal`.

The token is verified by asking Supabase Auth who it belongs to (so revoked and
expired sessions are rejected without sharing the JWT secret), with a short
in-process cache. Tests override `get_token_verifier`.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from sherlock_core.store import get_store

log = logging.getLogger("sherlock.gateway.auth")

CACHE_TTL_S = 60.0
CACHE_MAX = 2000


@dataclass(frozen=True)
class Principal:
    user_id: str
    is_anonymous: bool = False


TokenVerifier = Callable[[str], Awaitable[Principal | None]]

_cache: dict[str, tuple[float, Principal]] = {}


def _lookup(token: str) -> Principal | None:
    """Blocking call to Supabase Auth. None when the token is not valid."""
    client = getattr(get_store(), "c", None)
    if client is None:
        raise RuntimeError("the configured store cannot verify tokens")
    try:
        res = client.auth.get_user(token)
    except Exception as e:  # supabase raises AuthApiError for bad or expired tokens
        log.info("token rejected: %s", type(e).__name__)
        return None
    user = getattr(res, "user", None)
    if user is None or not getattr(user, "id", None):
        return None
    return Principal(user_id=str(user.id), is_anonymous=bool(getattr(user, "is_anonymous", False)))


async def verify_supabase_token(token: str) -> Principal | None:
    key = hashlib.sha256(token.encode()).hexdigest()
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    principal = await asyncio.to_thread(_lookup, token)
    if principal is not None:
        if len(_cache) >= CACHE_MAX:
            _cache.clear()
        _cache[key] = (now + CACHE_TTL_S, principal)
    return principal


def get_token_verifier() -> TokenVerifier:
    return verify_supabase_token


async def get_principal(
    request: Request,
    verifier: Annotated[TokenVerifier, Depends(get_token_verifier)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    scheme, _, token = (authorization or "").partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "missing bearer token", headers={"WWW-Authenticate": "Bearer"})
    principal = await verifier(token)
    if principal is None:
        raise HTTPException(401, "invalid or expired session", headers={"WWW-Authenticate": "Bearer"})
    request.state.principal = principal
    return principal


CurrentPrincipal = Annotated[Principal, Depends(get_principal)]
