"""Reverse image search.

`reverse_image_links` (keyless) returns ready-made links for a manual search on the major
engines. `reverse_image` (needs SERPAPI_KEY) runs one Google Lens query through SerpApi and
returns the top visual matches. Both look for copies of the same picture on the web; neither
identifies people.

For an uploaded photo (`storage://media/uploads/...`) both sign a one-hour URL for the object
(search engines must fetch the picture themselves). That URL only ever lives inside the links
finding (and the SerpApi request); it is never logged or stored anywhere else.
"""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import httpx

from sherlock_core import uploads
from sherlock_core.modules import register
from sherlock_core.modules._util import (
    clean,
    describe_http_error,
    error_finding,
    is_public_http_url,
    json_or_none,
)
from sherlock_core.modules.base import Module, ModuleContext, Target

SERPAPI = "https://serpapi.com/search.json"
MAX_MATCHES = 20
SIGNED_LINKS_NOTE = "These links use a private link to your photo that stops working after an hour."


async def image_url(target: Target) -> tuple[str | None, str | None]:
    """(URL search engines can fetch, error). An uploaded photo gets a one-hour signed URL."""
    value = target.value.strip()
    if uploads.is_upload(value):
        try:
            return await uploads.signed_upload_url(value), None
        except (ValueError, uploads.UploadUnavailable) as e:
            return None, str(e)
    if not is_public_http_url(value):
        return None, "not a public http(s) image URL"
    return value, None


def manual_search_links(image_url: str) -> dict[str, str]:
    q = quote(image_url, safe="")
    return {
        "google_lens": f"https://lens.google.com/uploadbyurl?url={q}",
        "yandex": f"https://yandex.com/images/search?rpt=imageview&url={q}",
        "tineye": f"https://tineye.com/search?url={q}",
        "bing": f"https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:{q}",
    }


@register
class ReverseImageLinks(Module):
    name = "reverse_image_links"
    title = "Reverse image search links"
    description = "Ready-made links to search an image on Google Lens, Yandex, TinEye and Bing."
    inputs = ("image",)
    queue = "media"
    timeout_s = 5.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        url, error = await image_url(target)
        if url is None:
            return [error_finding(ctx, self, target, "reverse-image-links", error or "no image URL")]
        signed = uploads.is_upload(target.value)
        links = manual_search_links(url)
        return [ctx.finding(
            self, target, platform="reverse-image-links", url=links["google_lens"],
            extra=clean({"links": ", ".join(links.values()), "note": SIGNED_LINKS_NOTE if signed else None}),
            meta=clean({"engines": links, "manual": True,
                        "expires_s": uploads.SIGNED_URL_TTL_S if signed else None}),
        )]


@register
class ReverseImage(Module):
    name = "reverse_image"
    title = "Reverse image search (Google Lens)"
    description = "Finds pages showing the same or a visually similar image (Google Lens via SerpApi)."
    inputs = ("image",)
    queue = "media"
    requires_env = ("SERPAPI_KEY",)
    source_url = "https://serpapi.com/google-lens-api"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        key = os.getenv("SERPAPI_KEY", "").strip()
        if not key:
            raise RuntimeError("SERPAPI_KEY is not set")
        url, error = await image_url(target)
        if url is None:
            return [error_finding(ctx, self, target, "google-lens", error or "no image URL")]
        try:
            r = await ctx.http.get(
                SERPAPI, params={"engine": "google_lens", "type": "all", "url": url, "api_key": key},
                timeout=40.0,
            )
        except httpx.HTTPError as e:   # the message could carry the request URL (key, signed URL)
            raise RuntimeError(f"Google Lens request failed ({type(e).__name__})") from None
        body = json_or_none(r)
        if r.status_code != 200 or not isinstance(body, dict):
            reason = body.get("error") if isinstance(body, dict) else None
            reason = str(reason or describe_http_error(r)).replace(url, "<image>")  # never echo a signed URL
            return [error_finding(ctx, self, target, "google-lens", reason)]
        # type=all: the "visual_matches"-only query comes back empty for many images (checked
        # 2026-11-22). Exact copies of the picture first, then visually similar pages; one row
        # per page even when a page appears in both lists.
        matches: list[dict] = []
        seen: set[str] = set()
        for kind in ("exact_matches", "visual_matches"):
            for m in body.get(kind) or []:
                if isinstance(m, dict) and m.get("link") and m["link"] not in seen:
                    seen.add(m["link"])
                    matches.append({**m, "_kind": "exact" if kind == "exact_matches" else "similar"})
        if not matches:  # SerpApi reports "no results" as 200 + {"error": "..."}
            return []
        return [
            ctx.finding(
                self, target, platform="google-lens", url=m["link"],
                meta=clean({
                    "title": m.get("title"), "source": m.get("source"), "thumbnail": m.get("thumbnail"),
                    "position": m.get("position"), "match": m["_kind"],
                }),
                discriminator=str(m["link"]),
            )
            for m in matches[:MAX_MATCHES]
        ]
