"""user-scanner library: username/email sweep + Hudson Rock breach exposure."""
import asyncio

import httpx

from core import normalize

from user_scanner.core.engine import check_all

HUDSON_URL = "https://cavalier.hudsonrock.com/api/json/v2/osint-tools/"


def scan(target: str, is_email: bool, case_id: str) -> list[dict]:
    results = asyncio.run(check_all(target, is_email=is_email))
    findings = [
        f for r in results
        if (f := normalize.from_user_scanner(r, case_id, "email" if is_email else "username", target))
    ]
    findings += _hudson(target, is_email, case_id)
    return findings


def _hudson(target: str, is_email: bool, case_id: str) -> list[dict]:
    endpoint = "search-by-email" if is_email else "search-by-username"
    param = "email" if is_email else "username"
    # ponytail: no retries / rate-limit here; single-shot exposure check, cheap to rerun
    with httpx.Client(timeout=10.0) as client:
        resp = client.get(f"{HUDSON_URL}{endpoint}", params={param: target})
        resp.raise_for_status()
    hits = resp.json().get("stealers", [])
    return [
        normalize.from_hudson_rock(h, case_id, "email" if is_email else "username", target)
        for h in hits
    ]
