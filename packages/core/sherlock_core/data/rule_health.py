"""Rule health check for the bundled WhatsMyName dataset.

    uv run python -m sherlock_core.data.rule_health [--concurrency 16] [--only NAME ...] [--connection TEXT]

For every site, asks the site about its own `known` accounts (the dataset lists usernames
that exist there) and about one random made-up name, with exactly the request and matching
logic the `whatsmyname` module uses (`modules.whatsmyname.check_site`). Each rule is put in
one class:

    ok                 known -> found, random -> missing
    false_negative     a known account does not come out found (the rule misses real accounts)
    false_positive     the made-up name comes out found
    indistinguishable  the same verdict for both (e.g. a login shell for every name)
    error              no usable answer (timeouts, connection errors) for either side

and the result is written to `rule_health.json` next to this file:
`{"meta": {checked_at, connection, counts, ...}, "sites": {name: {status, checked_at, detail}}}`.
The module skips every rule not marked `ok`. Results depend on the connection the check
runs from (datacenter IPs get more bot walls), which `meta.connection` records.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import secrets
import string
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from sherlock_core.modules.whatsmyname import SITE_TIMEOUT_S, account_for, check_site, load_sites

OUT = Path(__file__).with_name("rule_health.json")
STATUSES = ("ok", "false_negative", "false_positive", "indistinguishable", "error")


def random_name() -> str:
    """A made-up handle no one has: letters then digits, 14 characters."""
    alphabet = string.ascii_lowercase
    return "zq" + "".join(secrets.choice(alphabet) for _ in range(8)) + "".join(
        secrets.choice(string.digits) for _ in range(4))


def classify_rule(known: list[str], random: str) -> tuple[str, str]:
    """(status, detail) from the verdicts for the known accounts and for the made-up name.

    Verdicts are the module's: found | not_found | unknown | error.
    """
    usable = [v for v in known if v != "error"]
    if not usable or random == "error":
        return "error", f"no usable answer (known: {', '.join(known) or 'none listed'}; random: {random})"
    k = "found" if "found" in usable else usable[0]
    detail = f"known -> {k}, random -> {random}"
    if k == "found" and random == "not_found":
        return "ok", detail
    if k == random:
        return "indistinguishable", detail
    if random == "found":
        return "false_positive", detail
    return "false_negative", detail


async def _verdict(site: dict[str, Any], name: str, http: httpx.AsyncClient) -> str:
    try:
        verdict, _ = await asyncio.wait_for(check_site(site, name, http), SITE_TIMEOUT_S + 2)
        return verdict
    except (httpx.HTTPError, TimeoutError, UnicodeError, ValueError, LookupError):
        return "error"


async def check_rule(site: dict[str, Any], http: httpx.AsyncClient, rand: str | None = None) -> dict[str, str]:
    """Health entry for one site. Requests to one site go one after the other (politeness)."""
    names = [n for n in (site.get("known") or [])[:2] if isinstance(n, str) and account_for(site, n)]
    known = [await _verdict(site, n, http) for n in names]
    random = await _verdict(site, rand or random_name(), http)
    status, detail = classify_rule(known, random)
    return {"status": status, "checked_at": datetime.now(UTC).isoformat(timespec="seconds"), "detail": detail}


async def run(concurrency: int = 16, only: list[str] | None = None,
              http: httpx.AsyncClient | None = None) -> dict[str, dict[str, str]]:
    sites = [s for s in load_sites() if not only or s["name"] in only]
    sem = asyncio.Semaphore(max(1, concurrency))
    out: dict[str, dict[str, str]] = {}
    client = http or httpx.AsyncClient(limits=httpx.Limits(max_connections=concurrency * 2))

    async def one(site: dict[str, Any]) -> None:
        async with sem:
            out[site["name"]] = await check_rule(site, client)

    try:
        await asyncio.gather(*(one(s) for s in sites))
    finally:
        if http is None:
            await client.aclose()
    return dict(sorted(out.items(), key=lambda kv: kv[0].casefold()))


def write(results: dict[str, dict[str, str]], connection: str, path: Path = OUT) -> dict[str, Any]:
    counts = Counter(r["status"] for r in results.values())
    doc = {
        "meta": {
            "checked_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "connection": connection,
            "dataset": "wmn-data.json",
            "total": len(results),
            "counts": {s: counts.get(s, 0) for s in STATUSES},
            "method": "each site's own `known` accounts and one random made-up name, same request and "
                      "matching as modules/whatsmyname.py; only `ok` rules run",
        },
        "sites": results,
    }
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return doc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--concurrency", type=int, default=16)
    ap.add_argument("--only", nargs="*", help="site names to check (default: all)")
    ap.add_argument("--connection", default="home (residential) connection")
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    results = asyncio.run(run(args.concurrency, args.only))
    doc = write(results, args.connection, args.out)
    print(json.dumps(doc["meta"]["counts"]), "of", doc["meta"]["total"], "->", args.out)


if __name__ == "__main__":
    main()
