"""Web search provider contract, the per-job budget guard and the process-wide cache.

    provider = get_provider(http)            # first available implementation, or None
    search = BudgetedSearch(provider)        # one per job: at most N upstream queries
    hits = await search.search('"Ada Lovelace" site:github.com', num=10)

Every hit passes the people-search denylist (`search.denylist`) before it leaves this
layer, so data-broker pages never reach a module, a finding or the UI.
"""
from __future__ import annotations

import os
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass

from sherlock_core.search.denylist import is_denied

DEFAULT_MAX_QUERIES_PER_JOB = 8
CACHE_TTL_S = 6 * 3600
CACHE_MAX_ENTRIES = 512


@dataclass(frozen=True)
class SearchHit:
    title: str
    url: str
    snippet: str
    source: str        # provider name, e.g. "serpapi-google"


class SearchError(Exception):
    """The provider answered, but not usefully (bad key, quota, bot wall)."""


class SearchBudgetExceeded(SearchError):
    """The job already spent its query budget."""


class SearchProvider(ABC):
    name: str = ""

    @classmethod
    @abstractmethod
    def available(cls) -> bool:
        """Whether this provider can be used in this process (key set / library installed)."""

    @abstractmethod
    async def search(self, query: str, *, num: int = 10) -> list[SearchHit]:
        """Organic results for `query`. Raises SearchError when the upstream refuses."""


class TTLCache:
    """Small in-memory cache: query -> hits. Process-wide instance below."""

    def __init__(self, ttl_s: float = CACHE_TTL_S, max_entries: int = CACHE_MAX_ENTRIES) -> None:
        self.ttl_s, self.max_entries = ttl_s, max_entries
        self._data: dict[tuple, tuple[float, list[SearchHit]]] = {}

    def get(self, key: tuple) -> list[SearchHit] | None:
        item = self._data.get(key)
        if item is None:
            return None
        if time.monotonic() - item[0] > self.ttl_s:
            self._data.pop(key, None)
            return None
        return list(item[1])

    def put(self, key: tuple, hits: list[SearchHit]) -> None:
        if len(self._data) >= self.max_entries:
            for k in sorted(self._data, key=lambda k: self._data[k][0])[: self.max_entries // 4 or 1]:
                self._data.pop(k, None)
        self._data[key] = (time.monotonic(), list(hits))

    def clear(self) -> None:
        self._data.clear()


CACHE = TTLCache()


def max_queries_per_job() -> int:
    try:
        return max(0, int(os.getenv("SEARCH_MAX_QUERIES_PER_JOB", "") or DEFAULT_MAX_QUERIES_PER_JOB))
    except ValueError:
        return DEFAULT_MAX_QUERIES_PER_JOB


class BudgetedSearch:
    """Wraps a provider for ONE job: caches, counts upstream queries, filters the denylist.

    A cache hit costs nothing. Once `max_queries` upstream calls were made, further
    uncached queries raise `SearchBudgetExceeded` (the caller keeps what it has).
    """

    def __init__(self, provider: SearchProvider, *, max_queries: int | None = None,
                 cache: TTLCache | None = None) -> None:
        self.provider = provider
        self.max_queries = max_queries_per_job() if max_queries is None else max_queries
        self.cache = CACHE if cache is None else cache
        self.used = 0

    @property
    def remaining(self) -> int:
        return max(0, self.max_queries - self.used)

    async def search(self, query: str, *, num: int = 10) -> list[SearchHit]:
        q = " ".join(query.split())
        key = (self.provider.name, q.casefold(), num)
        cached = self.cache.get(key)
        if cached is not None:
            return cached
        if self.used >= self.max_queries:
            raise SearchBudgetExceeded(f"search budget of {self.max_queries} queries per job is spent")
        self.used += 1
        hits = [h for h in await self.provider.search(q, num=num) if h.url and not is_denied(h.url)]
        self.cache.put(key, hits)
        return hits
