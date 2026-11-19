"""Perceptual hashing of images (helper, not a registered module).

`phash_hex` is shared with `image_meta`. `hash_avatars` is called by the worker after
identity scans so profile pictures can be compared across platforms. Pillow and imagehash
are imported inside functions: this file must import cleanly on workers without them.

This is image similarity only (same or near-identical picture). It is not face recognition.
"""
from __future__ import annotations

import asyncio
import copy
import io
import logging
from typing import Any

import httpx

from sherlock_core.modules._util import UpstreamError, fetch_capped

log = logging.getLogger(__name__)

MAX_AVATAR_BYTES = 2_000_000
MAX_AVATARS = 60
MAX_PIXELS = 25_000_000  # refuse to decode anything larger (memory on a 512 MB host)
CONCURRENCY = 4


def open_image(data: bytes) -> Any:
    """Open image bytes with Pillow, refusing oversized images. Raises ValueError when unusable."""
    from PIL import Image, UnidentifiedImageError

    try:
        img = Image.open(io.BytesIO(data))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as e:
        raise ValueError(f"not a readable image: {type(e).__name__}") from None
    if img.width * img.height > MAX_PIXELS:
        raise ValueError(f"image too large to process ({img.width}x{img.height})")
    return img


def phash_hex(data: bytes) -> str:
    """64-bit perceptual hash of an image as 16 hex characters."""
    import imagehash

    img = open_image(data)
    try:
        img.draft("L", (256, 256))  # JPEG: decode at reduced size, no-op for other formats
        return str(imagehash.phash(img.convert("L")))
    except (OSError, SyntaxError, ValueError) as e:  # truncated or corrupt image data
        raise ValueError(f"image could not be decoded: {type(e).__name__}") from None


async def hash_avatars(findings: list[dict[str, Any]], http: httpx.AsyncClient) -> list[dict[str, Any]]:
    """Return updated copies of the found findings that gained `extra.avatar_phash`.

    Considers findings with `extra.avatar_url` and no `extra.avatar_phash`; downloads at most
    `MAX_AVATARS` images of at most `MAX_AVATAR_BYTES` each, a few at a time. Findings whose
    avatar cannot be fetched or decoded are left out of the result (nothing to update).
    """
    todo = []
    for f in findings:
        extra = (f.get("extra_metadata") or {}).get("extra") or {}
        url = extra.get("avatar_url")
        if f.get("status") == "found" and isinstance(url, str) and url and not extra.get("avatar_phash"):
            todo.append((f, url))
    todo = todo[:MAX_AVATARS]
    if not todo:
        return []
    sem = asyncio.Semaphore(CONCURRENCY)
    cache: dict[str, asyncio.Task[str | None]] = {}

    async def hash_url(url: str) -> str | None:
        async with sem:
            try:
                data, _ = await fetch_capped(http, url, max_bytes=MAX_AVATAR_BYTES, timeout=10.0)
                return await asyncio.to_thread(phash_hex, data)
            except (UpstreamError, httpx.HTTPError, ValueError) as e:
                log.info("avatar %s skipped: %s", url, str(e) or type(e).__name__)
                return None

    for _, url in todo:  # one download per distinct URL
        if url not in cache:
            cache[url] = asyncio.ensure_future(hash_url(url))
    await asyncio.gather(*cache.values())

    out = []
    for f, url in todo:
        phash = cache[url].result()
        if phash:
            updated = copy.deepcopy(f)
            updated["extra_metadata"]["extra"]["avatar_phash"] = phash
            out.append(updated)
    return out
