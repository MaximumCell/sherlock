"""Keyless fallback: the `ddgs` metasearch library (extra `search`, installed in the worker and gateway).

Verified 2026-11-20 with real requests (no key, no card), `ddgs` 9.16.1, queries for public figures:

  backend    plain `"Tim Berners-Lee"`        `"Tim Berners-Lee" site:github.com`
  bing       8 results, ~4 s                  7 results (github.com/timbl first), ~4 s
  google     8 results, ~7 s                  "No results found"
  auto       2 results                        7 results
  duckduckgo / brave: "No results found" for both from this address.
  Result rows are `{"title", "href", "body"}`.

So `bing` is tried first and `google` second. Also checked the same day and NOT usable:
the DuckDuckGo HTML endpoint with a plain HTTP client (HTTP 202 bot challenge), Tavily (needs a
key, answers 401 without one; none was available), Gemini grounding with Google Search (free
tier only on gemini-2.5-flash / -flash-lite, 500 requests/day shared, and those models are
announced to be retired on 2026-12-01; no GOOGLE_API_KEY was available to test it).

This is scraping through a third-party library: FRAGILE, no quota contract, expect it to
break or be rate limited without notice, especially from datacenter addresses. It is the
last resort after SerpApi and can be switched off with `SEARCH_DISABLE_KEYLESS=1`.
The library does its own HTTP (browser TLS impersonation); it cannot use the module's client.
"""
from __future__ import annotations

import asyncio
import importlib.util
import os

from sherlock_core.search.base import SearchError, SearchHit, SearchProvider

BACKENDS = ("bing", "google")


def _ddgs_text(query: str, num: int, backend: str) -> list[dict]:
    from ddgs import DDGS  # imported lazily: optional dependency

    return list(DDGS(timeout=15).text(query, max_results=num, backend=backend) or [])


class KeylessProvider(SearchProvider):
    name = "ddgs"

    @classmethod
    def available(cls) -> bool:
        if os.getenv("SEARCH_DISABLE_KEYLESS", "").strip().lower() in ("1", "true", "yes"):
            return False
        return importlib.util.find_spec("ddgs") is not None

    async def search(self, query: str, *, num: int = 10) -> list[SearchHit]:
        last = ""
        for backend in BACKENDS:
            try:
                rows = await asyncio.wait_for(asyncio.to_thread(_ddgs_text, query, num, backend), timeout=20)
            except Exception as e:  # the library raises its own types for "no results" and for blocks
                last = f"{type(e).__name__}: {e}"
                if "no results" in str(e).lower():
                    last = ""
                continue
            hits = [
                SearchHit(title=str(r.get("title") or ""), url=str(r.get("href") or r.get("url") or ""),
                          snippet=str(r.get("body") or ""), source=f"{self.name}-{backend}")
                for r in rows if isinstance(r, dict) and (r.get("href") or r.get("url"))
            ]
            if hits:
                return hits[:num]
        if last:
            raise SearchError(f"keyless search failed: {last}"[:200])
        return []
