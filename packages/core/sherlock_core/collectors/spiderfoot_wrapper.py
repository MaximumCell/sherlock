"""SpiderFoot HTTP API client (requires a running SpiderFoot server, see plan.md).
Runs a scan and waits for completion; returns normalized event findings.
"""
import time

import httpx

from sherlock_core import config, normalize


def scan(domain: str, case_id: str, module_types: str = "domain") -> list[dict]:
    if not config.SPIDERFOOT_URL:
        return []
    with httpx.Client(base_url=config.SPIDERFOOT_URL, timeout=10.0) as c:
        r = c.post("/scan/new", params={
            "scanname": f"sherlocks-{case_id}", "scantarget": domain,
            "modulelist": module_types, "usecases": "All", "typelist": "",
        })
        r.raise_for_status()
        scan_id = int(r.text)
        deadline = time.monotonic() + config.SF_SCAN_TIMEOUT_S
        while time.monotonic() < deadline:
            # ponytail: poll every 10s until scan finishes or times out
            status = c.get("/scan/status", params={"scanid": scan_id}).json().get("status")
            if status == "FINISHED":
                break
            time.sleep(10)
        events = c.get("/scan/eventlist", params={"scanid": scan_id}).json()
    return [
        normalize.from_spiderfoot(e, case_id, domain)
        for e in events if e.get("status") != "PARENT" and e.get("confidence", 0) > 0
    ]
