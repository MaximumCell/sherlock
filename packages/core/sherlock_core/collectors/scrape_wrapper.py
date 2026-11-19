"""Web scraping enrichment via Firecrawl-compatible API.

Used to fetch the actual public profile page of a found account and extract
structured data (description, social links, posts, etc.) that platform APIs
don't expose. Returns a normalized finding that can be added to a case.

Configuration (env vars):
  SCRAPING_API_URL  — default https://api.firecrawl.dev
  SCRAPING_API_KEY  — required to enable

The endpoint contract is Firecrawl v1:
  POST {SCRAPING_API_URL}/v1/scrape
  Authorization: Bearer <SCRAPING_API_KEY>
  Body: {"url": "<target>", "formats": ["markdown"]}

Returns: {"success": true, "data": {"markdown": "...", "metadata": {...}}}
"""
import hashlib
import json
from datetime import datetime, timezone

import httpx

from sherlock_core import config


def is_configured() -> bool:
    return bool(config.SCRAPING_API_KEY)


def enrich_url(url: str, case_id: str) -> dict:
    """Scrape a public profile URL and return a normalized finding dict.

    The finding's `platform` is set to 'scraped:<host>' so it can be
    filtered, and `extra_metadata.extra` carries the markdown + metadata.
    Re-running on the same URL overwrites the previous scrape finding.
    """
    if not is_configured():
        raise RuntimeError(
            "SCRAPING_API_KEY not set — sign up at https://firecrawl.dev "
            "and add the key to your .env to enable enrichment."
        )
    if not url.startswith(("http://", "https://")):
        raise ValueError(f"Invalid URL: {url!r}")

    body = {
        "url": url,
        "formats": ["markdown"],
        "onlyMainContent": True,
        # Firecrawl expects timeout in MILLISECONDS, minimum 1000.
        # 30s gives slow sites a fair chance without blocking the worker.
        "timeout": 30000,
    }
    headers = {
        "Authorization": f"Bearer {config.SCRAPING_API_KEY}",
        "Content-Type": "application/json",
    }
    endpoint = f"{config.SCRAPING_API_URL.rstrip('/')}/v1/scrape"
    with httpx.Client(timeout=45.0) as client:
        resp = client.post(endpoint, json=body, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"scrape API {resp.status_code}: {resp.text[:300]}")
    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(f"scrape returned failure: {payload}")

    data = payload.get("data") or {}
    markdown = data.get("markdown") or ""
    metadata = data.get("metadata") or {}

    # Extract host as a stable platform tag, e.g. "scraped:github.com"
    host = (url.split("/")[2] if "//" in url else "unknown").lower()
    platform = f"scraped:{host}"

    extra: dict = {
        "scraped_url": url,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "title": metadata.get("title"),
        "description": metadata.get("description"),
        "og_image": metadata.get("ogImage") or metadata.get("image"),
        "language": metadata.get("language"),
        "author": metadata.get("author"),
        "markdown_length": len(markdown),
        "markdown_preview": markdown[:4000],
    }
    # Try to extract extra emails/handles from the markdown
    import re
    email_re = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
    handle_re = re.compile(r"@[A-Za-z0-9_]{2,30}")
    urls_in_text = re.compile(r"https?://[^\s<>\"',;]+")
    emails = sorted(set(email_re.findall(markdown)))
    handles = sorted(set(handle_re.findall(markdown)))
    urls_found = sorted(set(urls_in_text.findall(markdown)))
    if emails:
        extra["emails_in_page"] = ", ".join(emails[:10])
    if handles:
        extra["handles_in_page"] = ", ".join(handles[:15])
    if urls_found:
        # Filter out the same URL we just scraped
        other_urls = [u for u in urls_found if u.rstrip("/") != url.rstrip("/")]
        if other_urls:
            extra["urls_in_page"] = ", ".join(other_urls[:15])

    return {
        "case_id": case_id,
        "identifier_type": "scraped_url",
        "identifier_value": url,
        "source_tool": "firecrawl",
        "platform": platform,
        "status": "found",
        "extra_metadata": {"extra": extra, "url": url},
        "collected_at": datetime.now(timezone.utc).isoformat(),
    }
