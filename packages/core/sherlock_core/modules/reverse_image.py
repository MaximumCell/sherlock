"""Reverse image search.

`reverse_image_links` (keyless) returns ready-made links for a manual search on the major
engines. `reverse_image` (needs SERPAPI_KEY) runs one Google Lens query through SerpApi and
returns the top visual matches. Both look for copies of the same picture on the web; neither
identifies people.
"""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

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
        url = target.value.strip()
        if not is_public_http_url(url):
            return [error_finding(ctx, self, target, "reverse-image-links", "not a public http(s) image URL")]
        links = manual_search_links(url)
        return [ctx.finding(
            self, target, platform="reverse-image-links", url=links["google_lens"],
            extra={"links": ", ".join(links.values())}, meta={"engines": links, "manual": True},
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
        url = target.value.strip()
        if not is_public_http_url(url):
            return [error_finding(ctx, self, target, "google-lens", "not a public http(s) image URL")]
        key = os.getenv("SERPAPI_KEY", "").strip()
        if not key:
            raise RuntimeError("SERPAPI_KEY is not set")
        r = await ctx.http.get(
            SERPAPI, params={"engine": "google_lens", "type": "visual_matches", "url": url, "api_key": key},
            timeout=40.0,
        )
        body = json_or_none(r)
        if r.status_code != 200 or not isinstance(body, dict):
            reason = body.get("error") if isinstance(body, dict) else None
            return [error_finding(ctx, self, target, "google-lens", str(reason or describe_http_error(r)))]
        matches = [m for m in body.get("visual_matches") or [] if isinstance(m, dict) and m.get("link")]
        if not matches:  # SerpApi reports "no results" as 200 + {"error": "..."}
            return []
        return [
            ctx.finding(
                self, target, platform="google-lens", url=m["link"],
                meta=clean({
                    "title": m.get("title"), "source": m.get("source"), "thumbnail": m.get("thumbnail"),
                    "position": m.get("position"),
                }),
                discriminator=str(m["link"]),
            )
            for m in matches[:MAX_MATCHES]
        ]
