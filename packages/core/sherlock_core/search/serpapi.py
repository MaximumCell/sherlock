"""SerpApi Google Search provider (`SERPAPI_KEY`).

Verified 2026-11-19 and again 2026-11-20:
  * endpoint `GET https://serpapi.com/search.json?engine=google&q=...&num=...&api_key=...`
    (https://serpapi.com/search-api); the response shape (`organic_results[].title / link /
    snippet / source`) was read from a real response (without `api_key` the endpoint serves a
    cached demo search) and trimmed into `tests/person/fixtures/serpapi_google.json`;
  * a request with an invalid key returns HTTP 401 `{"error": "Invalid API key. ..."}`.
  NOT verified with a paid/free key of our own: no `SERPAPI_KEY` was available in the
  environment this was built in.
Quota (https://serpapi.com/pricing, read 2026-11-20): free plan 250 searches / month,
50 / hour. Each uncached `search()` call costs one search; `BudgetedSearch` caps a job at 8.
"""
from __future__ import annotations

import os

import httpx

from sherlock_core.search.base import SearchError, SearchHit, SearchProvider

ENDPOINT = "https://serpapi.com/search.json"


class SerpApiProvider(SearchProvider):
    name = "serpapi-google"

    def __init__(self, http: httpx.AsyncClient) -> None:
        self.http = http

    @classmethod
    def available(cls) -> bool:
        return bool(os.getenv("SERPAPI_KEY", "").strip())

    async def search(self, query: str, *, num: int = 10) -> list[SearchHit]:
        params = {"engine": "google", "q": query, "num": max(1, min(num, 20)), "hl": "en",
                  "api_key": os.getenv("SERPAPI_KEY", "").strip()}
        try:
            r = await self.http.get(ENDPOINT, params=params, timeout=30.0)
        except httpx.HTTPError as e:
            raise SearchError(f"SerpApi request failed: {type(e).__name__}") from e
        try:
            data = r.json()
        except ValueError:
            data = None
        if not isinstance(data, dict):
            raise SearchError(f"SerpApi returned HTTP {r.status_code}")
        error = str(data.get("error") or "")
        if "hasn't returned any results" in error:      # SerpApi reports an empty page as an error
            return []
        if r.status_code != 200 or error:
            raise SearchError(f"SerpApi: {error or f'HTTP {r.status_code}'}"[:200])
        hits: list[SearchHit] = []
        for o in data.get("organic_results") or []:
            if isinstance(o, dict) and o.get("link"):
                hits.append(SearchHit(title=str(o.get("title") or ""), url=str(o["link"]),
                                      snippet=str(o.get("snippet") or ""), source=self.name))
        return hits[:num]
