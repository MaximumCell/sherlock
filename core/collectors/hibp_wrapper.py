"""HaveIBeenPwned breach exposure lookup. Returns [] on no exposure."""
import httpx

from core import config, normalize

API = "https://haveibeenpwned.com/api/v3/breachedaccount/{email}"


def check(email: str, case_id: str) -> list[dict]:
    if not config.HIBP_API_KEY:
        raise RuntimeError("HIBP_API_KEY not set in .env")
    resp = httpx.get(
        API.format(email=email),
        headers={"hibp-api-key": config.HIBP_API_KEY},
        params={"truncateResponse": "true"},
        timeout=15.0,
    )
    if resp.status_code == 404:
        return []
    if resp.status_code == 429:
        retry = float(resp.headers.get("Retry-After", "5"))
        raise RuntimeError(f"HIBP rate limited, retry after {retry}s")
    resp.raise_for_status()
    return [normalize.from_hibp(b, case_id, email) for b in resp.json()]
