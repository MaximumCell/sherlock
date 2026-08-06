#!/usr/bin/env python3
"""Thin headless runner: run collectors, dump normalized JSON to out/."""
import argparse
import json
import sys
import uuid
from pathlib import Path

from core import config
from core.collectors import hibp_wrapper, spiderfoot_wrapper, user_scanner_wrapper


def _dump(identifier_type, identifier_value, findings, tag):
    config.OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = config.OUT_DIR / f"{identifier_type}-{tag}-{identifier_value}.json"
    path.write_text(json.dumps(findings, indent=2))
    print(f"wrote {path} ({len(findings)} findings)")
    return path


def main():
    ap = argparse.ArgumentParser(description="OSINT collector runner")
    ap.add_argument("--case-id", default=str(uuid.uuid4())[:8])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("scan-username")
    p.add_argument("username")
    p.add_argument("--tag", default="us")

    p = sub.add_parser("scan-email")
    p.add_argument("email")
    p.add_argument("--tag", default="us")

    p = sub.add_parser("scan-domain")
    p.add_argument("domain")
    p.add_argument("--tag", default="sf")

    p = sub.add_parser("hibp")
    p.add_argument("email")
    p.add_argument("--tag", default="hibp")

    a = ap.parse_args()

    try:
        if a.cmd == "scan-username":
            f = user_scanner_wrapper.scan(a.username, is_email=False, case_id=a.case_id)
            _dump("username", a.username, f, a.tag)
        elif a.cmd == "scan-email":
            f = user_scanner_wrapper.scan(a.email, is_email=True, case_id=a.case_id)
            _dump("email", a.email, f, a.tag)
        elif a.cmd == "scan-domain":
            f = spiderfoot_wrapper.scan(a.domain, a.case_id)
            _dump("domain", a.domain, f, a.tag)
        elif a.cmd == "hibp":
            f = hibp_wrapper.check(a.email, a.case_id)
            _dump("email", a.email, f, a.tag)
    except Exception as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
