"""Small helpers shared by collector modules (not a module itself)."""
from __future__ import annotations

import ipaddress
import re
from typing import Any
from urllib.parse import urlsplit

import httpx

from sherlock_core.modules.base import Module, ModuleContext, Target

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
DOMAIN_RE = re.compile(r"^(?=.{1,253}$)([A-Za-z0-9_]([A-Za-z0-9\-_]{0,61}[A-Za-z0-9_])?\.)+[A-Za-z]{2,63}$")


class UpstreamError(Exception):
    """An upstream answered, but not usefully (rate limit, bot wall, bad payload)."""


def clean(d: dict[str, Any]) -> dict[str, Any]:
    """Drop keys whose value is None, empty string or empty collection (0 and False stay)."""
    return {k: v for k, v in d.items() if v is not None and v != "" and v != [] and v != {}}


def error_finding(
    ctx: ModuleContext, module: Module, target: Target, platform: str, reason: str,
    *, url: str | None = None, discriminator: str = "",
) -> dict[str, Any]:
    return ctx.finding(
        module, target, platform=platform, status="error", url=url,
        meta={"reason": reason[:300]}, discriminator=discriminator,
    )


def describe_http_error(r: httpx.Response) -> str:
    if r.status_code == 429:
        ra = r.headers.get("retry-after")
        return "rate limited (HTTP 429)" + (f", retry after {ra}s" if ra else "")
    if r.status_code == 403:
        return "blocked by upstream (HTTP 403)"
    return f"upstream returned HTTP {r.status_code}"


def json_or_none(r: httpx.Response) -> Any:
    try:
        return r.json()
    except ValueError:
        return None


def normalize_domain(value: str) -> str:
    v = value.strip().lower()
    if "://" in v:
        v = urlsplit(v).hostname or ""
    v = v.split("/")[0].rstrip(".")
    if not DOMAIN_RE.match(v):
        raise ValueError(f"not a domain name: {value!r}")
    return v


def normalize_ip(value: str) -> str:
    return str(ipaddress.ip_address(value.strip()))


def is_public_ip(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_global
    except ValueError:
        return False


def is_public_http_url(url: str) -> bool:
    """True for http(s) URLs that do not point at an obviously internal host.

    Literal private / loopback / link-local addresses and local names are refused so a
    user-supplied URL cannot be used to reach the worker's own network.
    """
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if parts.scheme not in ("http", "https") or not host:
        return False
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".lan")):
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return "." in host


async def fetch_capped(
    http: httpx.AsyncClient, url: str, *, max_bytes: int, timeout: float = 15.0,
    content_prefix: str | None = "image/", max_redirects: int = 3,
) -> tuple[bytes, str]:
    """Download `url` without ever holding more than `max_bytes`. Returns (body, content_type).

    Redirects are followed by hand so every hop is checked with `is_public_http_url`.
    Raises UpstreamError for anything that is not a usable response.
    """
    for _ in range(max_redirects + 1):
        if not is_public_http_url(url):
            raise UpstreamError("URL is not a public http(s) address")
        async with http.stream("GET", url, timeout=timeout, follow_redirects=False) as r:
            if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
                url = str(r.url.join(r.headers["location"]))
                continue
            if r.status_code != 200:
                raise UpstreamError(f"HTTP {r.status_code}")
            ctype = r.headers.get("content-type", "").split(";")[0].strip().lower()
            if content_prefix and not ctype.startswith(content_prefix):
                raise UpstreamError(f"unexpected content type {ctype or 'unknown'!r}")
            declared = r.headers.get("content-length", "")
            if declared.isdigit() and int(declared) > max_bytes:
                raise UpstreamError(f"larger than {max_bytes} bytes")
            buf = bytearray()
            async for chunk in r.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > max_bytes:
                    raise UpstreamError(f"larger than {max_bytes} bytes")
            return bytes(buf), ctype
    raise UpstreamError("too many redirects")
