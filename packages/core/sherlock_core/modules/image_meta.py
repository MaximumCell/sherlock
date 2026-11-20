"""Image metadata: perceptual hash, dimensions, format, a small EXIF subset and SHA-256.

The image is fetched once (8 MB cap) and discarded. GPS coordinates, when present, are
rounded to two decimals (about 1 km). No face detection or recognition is performed.
"""
from __future__ import annotations

import asyncio
import hashlib
from typing import Any

import httpx
import imagehash  # noqa: F401 - optional deps: ImportError => module skipped by the registry
import PIL  # noqa: F401

from sherlock_core.modules import register
from sherlock_core.modules._util import UpstreamError, clean, error_finding, fetch_capped, is_public_http_url
from sherlock_core.modules.avatar_hash import open_image, phash_hex
from sherlock_core.modules.base import Module, ModuleContext, Target

MAX_IMAGE_BYTES = 8_000_000
_TAG_MAKE, _TAG_MODEL, _TAG_SOFTWARE, _TAG_DATETIME = 271, 272, 305, 306
_IFD_EXIF, _IFD_GPS, _TAG_DATETIME_ORIGINAL = 0x8769, 0x8825, 36867


def _text(v: Any) -> str | None:
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    s = str(v).replace("\x00", "").strip() if v is not None else ""
    return s[:120] or None


def _degrees(dms: Any, ref: Any) -> float | None:
    try:
        d, m, s = (float(x) for x in dms)
        value = d + m / 60 + s / 3600
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if str(ref).strip().upper()[:1] in ("S", "W"):
        value = -value
    return round(value, 2)


def read_exif(img: Any) -> dict[str, Any]:
    """Camera make/model, software, capture time and coarse GPS from a Pillow image."""
    try:
        exif = img.getexif()
    except Exception:  # noqa: BLE001 - malformed EXIF must never fail the module
        return {}
    if not exif:
        return {}
    out: dict[str, Any] = {
        "camera_make": _text(exif.get(_TAG_MAKE)),
        "camera_model": _text(exif.get(_TAG_MODEL)),
        "software": _text(exif.get(_TAG_SOFTWARE)),
        "datetime": _text(exif.get(_TAG_DATETIME)),
    }
    try:
        original = exif.get_ifd(_IFD_EXIF).get(_TAG_DATETIME_ORIGINAL)
        gps = exif.get_ifd(_IFD_GPS)
    except Exception:  # noqa: BLE001
        original, gps = None, {}
    if original:
        out["datetime"] = _text(original)
    lat = _degrees(gps.get(2), gps.get(1)) if gps else None
    lon = _degrees(gps.get(4), gps.get(3)) if gps else None
    out["gps_present"] = bool(gps) and lat is not None and lon is not None
    if out["gps_present"]:
        out["gps_lat"], out["gps_lon"] = lat, lon
    return clean(out)


def analyse(data: bytes) -> dict[str, Any]:
    """Everything derived from the image bytes. Raises ValueError for unreadable images."""
    img = open_image(data)
    info = {
        "format": img.format, "width": img.width, "height": img.height, "mode": img.mode,
        "exif": read_exif(img),
    }
    info["phash"] = phash_hex(data)
    return info


@register
class ImageMeta(Module):
    name = "image_meta"
    title = "Image metadata and perceptual hash"
    description = "Dimensions, format, SHA-256, perceptual hash and a small EXIF subset of an image URL."
    inputs = ("image",)
    queue = "media"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        url = target.value.strip()
        if not is_public_http_url(url):
            return [error_finding(ctx, self, target, "image", "not a public http(s) image URL")]
        try:
            data, content_type = await fetch_capped(ctx.http, url, max_bytes=MAX_IMAGE_BYTES, timeout=20.0)
        except UpstreamError as e:
            return [error_finding(ctx, self, target, "image", f"could not fetch image: {e}", url=url)]
        except httpx.HTTPError as e:
            return [error_finding(ctx, self, target, "image", f"could not fetch image: {type(e).__name__}", url=url)]
        await ctx.progress(60, "image downloaded")
        sha256 = hashlib.sha256(data).hexdigest()
        try:
            info = await asyncio.to_thread(analyse, data)
        except ValueError as e:
            return [error_finding(ctx, self, target, "image", str(e), url=url)]
        exif = info.pop("exif")
        return [ctx.finding(
            self, target, platform="image", url=url,
            extra={"avatar_phash": info.pop("phash")},
            meta=clean({
                **info, "content_type": content_type, "size_bytes": len(data), "sha256": sha256,
                "exif": exif, "gps_present": bool(exif.get("gps_present")),
            }),
        )]
