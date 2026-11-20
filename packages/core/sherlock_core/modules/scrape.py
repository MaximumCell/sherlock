"""Optional public-page enrichment through a Firecrawl-compatible scraping API.

Not a registered module: a URL is not a scan target type. The gateway / worker call
`enrich_url` for a profile URL the investigator picked. Needs SCRAPING_API_KEY
(SCRAPING_API_URL defaults to https://api.firecrawl.dev).

Contract (Firecrawl v1): POST {SCRAPING_API_URL}/v1/scrape, `Authorization: Bearer <key>`,
body {"url", "formats": ["markdown"]} -> {"success": true, "data": {"markdown", "metadata"}}.
"""
from __future__ import annotations

import os
import re
from typing import Any
from urllib.parse import urlsplit

import httpx

from sherlock_core.models import make_finding, now_iso
from sherlock_core.modules._util import clean, is_public_http_url

REQUIRES_ENV = ("SCRAPING_API_KEY",)
DEFAULT_API_URL = "https://api.firecrawl.dev"
PREVIEW_CHARS = 4000

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
_HANDLE = re.compile(r"(?<![\w@.])@[A-Za-z0-9_]{2,30}\b")
_URL = re.compile(r"https?://[^\s<>\"',;)\]]+")


def is_configured() -> bool:
    return all(os.getenv(k, "").strip() for k in REQUIRES_ENV)


async def enrich_url(url: str, case_id: str, http: httpx.AsyncClient) -> dict[str, Any]:
    """Scrape one public page and return a finding in the legacy "firecrawl" shape.

    `platform` is `scraped:<host>`; re-running on the same URL replaces the earlier row
    (the finding key is derived from the URL). Raises RuntimeError when the API is not
    configured or fails, ValueError for a URL that is not public http(s).
    """
    key = os.getenv("SCRAPING_API_KEY", "").strip()
    if not key:
        raise RuntimeError("SCRAPING_API_KEY is not set; page enrichment is disabled")
    if not is_public_http_url(url):
        raise ValueError(f"not a public http(s) URL: {url!r}")
    base = (os.getenv("SCRAPING_API_URL", "").strip() or DEFAULT_API_URL).rstrip("/")
    resp = await http.post(
        f"{base}/v1/scrape",
        # Firecrawl's timeout is in milliseconds
        json={"url": url, "formats": ["markdown"], "onlyMainContent": True, "timeout": 30000},
        headers={"Authorization": f"Bearer {key}"},
        timeout=45.0,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"scrape API answered HTTP {resp.status_code}: {resp.text[:200]}")
    try:
        payload = resp.json()
    except ValueError:
        raise RuntimeError("scrape API returned a non-JSON answer") from None
    if not isinstance(payload, dict) or not payload.get("success"):
        raise RuntimeError(f"scrape failed: {str(payload.get('error') if isinstance(payload, dict) else payload)[:200]}")

    data = payload.get("data") or {}
    markdown = data.get("markdown") or ""
    metadata = data.get("metadata") or {}
    host = (urlsplit(url).hostname or "unknown").lower()
    other_urls = [u for u in dict.fromkeys(_URL.findall(markdown)) if u.rstrip("/") != url.rstrip("/")]
    extra = clean({
        "scraped_url": url,
        "scraped_at": now_iso(),
        "title": metadata.get("title"),
        "description": metadata.get("description"),
        "og_image": metadata.get("ogImage") or metadata.get("image"),
        "language": metadata.get("language"),
        "author": metadata.get("author"),
        "markdown_length": len(markdown),
        "markdown_preview": markdown[:PREVIEW_CHARS],
        "emails_in_page": ", ".join(sorted(set(_EMAIL.findall(markdown)))[:10]),
        "handles_in_page": ", ".join(sorted(set(_HANDLE.findall(markdown)))[:15]),
        "urls_in_page": ", ".join(other_urls[:15]),
    })
    return make_finding(
        case_id=case_id, identifier_type="scraped_url", identifier_value=url,
        source_tool="firecrawl", module="scrape_profile", platform=f"scraped:{host}",
        url=url, extra=extra,
    )
