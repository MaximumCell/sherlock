"""XposedOrNot free breach-exposure check (free HIBP alternative, no API key).
Returns breach names only for an email — exposure confirmation, never records.
https://github.com/XposedOrNot/XposedOrNot-API
"""
import httpx

from sherlock_core import normalize

API = "https://api.xposedornot.com/v1/check-email/{email}"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"


def check(email: str, case_id: str) -> list[dict]:
    resp = httpx.get(
        API.format(email=email),
        headers={"User-Agent": UA, "Accept": "application/json"},
        timeout=15.0,
    )
    if resp.status_code == 429:
        retry = float(resp.headers.get("Retry-After", "5"))
        raise RuntimeError(f"XposedOrNot rate limited, retry after {retry}s")
    resp.raise_for_status()
    return _parse(resp.json(), case_id, email)


def _parse(body: dict, case_id: str, email: str) -> list[dict]:
    # free tier returns {"breaches": [["Adobe", "LinkedIn"]], "status": "success"}
    flat = [breach for group in body.get("breaches", []) for breach in group]
    return [normalize.from_breach({"Name": name}, case_id, email) for name in flat]


if __name__ == "__main__":
    out = _parse({"breaches": [["Adobe", "LinkedIn"]], "status": "success"}, "c1", "a@b.c")
    assert len(out) == 2 and out[0]["status"] == "found"
    assert out[0]["extra_metadata"]["breach_name"] == "Adobe"
    assert out[0]["source_tool"] == "xposedornot"
    assert _parse({"breaches": [], "status": "success"}, "c1", "a@b.c") == []
    print("xposedornot parse OK")
