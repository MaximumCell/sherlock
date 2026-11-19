"""user-scanner library: username/email sweep + Hudson Rock breach exposure + Gravatar."""
import asyncio
import hashlib

import httpx

from sherlock_core import normalize

from user_scanner.core.engine import check_all

HUDSON_URL = "https://cavalier.hudsonrock.com/api/json/v2/osint-tools/"
GRAVATAR_URL = "https://en.gravatar.com/{hash}.json"


def scan(target: str, is_email: bool, case_id: str) -> list[dict]:
    results = asyncio.run(check_all(target, is_email=is_email))
    findings = [
        f for r in results
        if (f := normalize.from_user_scanner(r, case_id, "email" if is_email else "username", target))
    ]
    findings += _hudson(target, is_email, case_id)
    if is_email:
        findings += _gravatar(target, case_id)
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


def _gravatar(email: str, case_id: str) -> list[dict]:
    """Public Gravatar profile lookup. Returns rich data: name, bio, location, links, accounts.

    For any email, queries https://en.gravatar.com/{md5(email)}.json. No auth required.
    Result is normalized into a finding with platform='gravatar' and full extras.
    """
    email = email.strip().lower()
    md5 = hashlib.md5(email.encode("utf-8")).hexdigest()
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True) as client:
            resp = client.get(GRAVATAR_URL.format(hash=md5), headers={"User-Agent": "sherlock-osint/1.0"})
        if resp.status_code != 200:
            return []
        data = resp.json()
    except Exception:
        return []
    entry = (data.get("entry") or [])
    if not entry:
        return []
    e = entry[0]
    extra: dict = {}
    if e.get("hash"):
        extra["gravatar_id"] = e["hash"]
    if e.get("preferredUsername"):
        extra["username"] = e["preferredUsername"]
    if e.get("displayName"):
        extra["fullname"] = e["displayName"]
    elif e.get("name", {}).get("formatted"):
        extra["fullname"] = e["name"]["formatted"]
    if e.get("aboutMe"):
        extra["bio"] = e["aboutMe"]
    if e.get("currentLocation"):
        extra["location"] = e["currentLocation"]
    if e.get("thumbnailUrl"):
        extra["image"] = e["thumbnailUrl"]
    emails = [y.get("value") for y in e.get("emails", []) if y.get("value")]
    if emails:
        extra["emails"] = ", ".join(emails)
    # 'accounts' is the killer field — list of linked social profiles
    accounts = []
    for a in e.get("accounts", []):
        url = a.get("url")
        if url:
            accounts.append(url)
    urls = [y.get("value") for y in e.get("urls", []) if y.get("value")]
    all_links = accounts + urls
    if all_links:
        extra["links"] = ", ".join(all_links)
    return [{
        "case_id": case_id,
        "identifier_type": "email",
        "identifier_value": email,
        "source_tool": "gravatar",
        "platform": "gravatar",
        "status": "found",
        "extra_metadata": {"extra": extra, "url": f"https://gravatar.com/{md5}"},
        "collected_at": normalize._ts(),
    }]
