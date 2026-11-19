"""Web search for the name-search modules.

Providers, in order of preference (the first whose `available()` is true is used):

    SerpApiProvider   Google results via SerpApi          needs SERPAPI_KEY (250 searches/month free)
    KeylessProvider   `ddgs` metasearch library, no key   needs the optional `ddgs` package; fragile

See each provider's module docstring for what was verified, when, and the quota.
"""
from __future__ import annotations

import httpx

from sherlock_core.search.base import (
    CACHE,
    BudgetedSearch,
    SearchBudgetExceeded,
    SearchError,
    SearchHit,
    SearchProvider,
    TTLCache,
)
from sherlock_core.search.denylist import BROKER_DOMAINS, is_denied
from sherlock_core.search.keyless import KeylessProvider
from sherlock_core.search.serpapi import SerpApiProvider

PROVIDERS: tuple[type[SearchProvider], ...] = (SerpApiProvider, KeylessProvider)


def provider_available() -> bool:
    return any(p.available() for p in PROVIDERS)


def get_provider(http: httpx.AsyncClient) -> SearchProvider | None:
    """The preferred available provider, or None when no web search can be made."""
    if SerpApiProvider.available():
        return SerpApiProvider(http)
    if KeylessProvider.available():
        return KeylessProvider()
    return None


__all__ = [
    "BROKER_DOMAINS", "CACHE", "PROVIDERS", "BudgetedSearch", "KeylessProvider", "SearchBudgetExceeded",
    "SearchError", "SearchHit", "SearchProvider", "SerpApiProvider", "TTLCache", "get_provider", "is_denied",
    "provider_available",
]
