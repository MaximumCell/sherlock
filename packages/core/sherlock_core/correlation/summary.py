"""Case summary statistics and pivot candidates. Not review items.

`username_reuse` lives here: "this handle exists on N platforms" is a property of
every scan, not a finding a reviewer should approve or reject.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from typing import Any

from sherlock_core.correlation import facts as facts_mod
from sherlock_core.correlation import norm
from sherlock_core.correlation.accounts import group_accounts
from sherlock_core.correlation.rules import ignorable_url
from sherlock_core.walled import is_unknown

_FREEMAIL = frozenset({
    "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com",
    "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "gmx.net", "mail.com", "yandex.com",
    "yandex.ru", "zoho.com", "msn.com", "pm.me", "tutanota.com", "hey.com", "fastmail.com", "qq.com",
    "163.com", "mail.ru",
})


def summarize(findings: list[dict[str, Any]], split_keys: set[str] | None = None) -> dict[str, Any]:
    """Counts for the case overview. Accounts are counted once, however many sources
    or lookups reported them (see `correlation.accounts`).

    {
      total, found, not_found, error,
      unknown:     rows that could not be checked (a subset of `error`, see `sherlock_core.walled`),
      by_source:   {source_tool: {found, not_found, error, unknown}},
      account_count: accounts found (one per account, not per row),
      accounts:    [{account_key, label, handle, url, sources, finding_count}, ...],
      platforms_found: distinct platforms with a found account (breach sources excluded),
      handles:     [{handle, platform_count, platforms: [...]}, ...]  most reused first,
      username_reuse: {handle: platform_count},
      emails:      [{email, platform_count, platforms: [...]}, ...],
      breach_count, breaches: [{name, date, identifiers: [...]}, ...],
      infostealer_count,
      scraped_pages,
    }
    Handles are compared case-insensitively.
    """
    status: Counter[str] = Counter()
    by_source: dict[str, Counter[str]] = defaultdict(Counter)
    rows = [f for f in findings or [] if isinstance(f, dict)]
    for f in rows:
        s = str(f.get("status") or "unknown")
        status[s] += 1
        by_source[str(f.get("source_tool") or "unknown")][s] += 1
        if is_unknown(f):
            status["unknown"] += 1
            by_source[str(f.get("source_tool") or "unknown")]["unknown"] += 1

    handles: dict[str, dict[str, str]] = defaultdict(dict)   # handle -> {platform: label}
    emails: dict[str, dict[str, str]] = defaultdict(dict)
    breaches: dict[str, dict[str, Any]] = {}
    account_platforms: set[str] = set()
    infostealer = scraped = 0
    accounts = [a for a in group_accounts(rows, split_keys) if a.platform not in norm.NON_SOCIAL_PLATFORMS]
    account_ids = {fid for a in accounts for fid in a.finding_ids}
    real_accounts = []
    for a in accounts:
        if a.handle:
            handles[a.handle].setdefault(a.platform, a.label)
        if a.handle or a.account_key.split(":")[1:2] == ["email"]:
            account_platforms.add(a.platform)
            real_accounts.append(a)
    for ff in facts_mod.extract(rows):
        if ff.kind == "account":
            if ff.email and not ff.handle and ff.finding_id in account_ids:
                emails[ff.email].setdefault(ff.platform, ff.label)
        elif ff.kind == "infostealer":
            infostealer += 1
        elif ff.kind == "scrape":
            scraped += 1
        if ff.kind in ("breach", "event"):
            for fact in ff.of("breach"):
                b = breaches.setdefault(fact.value, {"name": str(fact.raw), "date": None, "identifiers": set()})
                if fact.subject:
                    b["identifiers"].add(fact.subject)
    # breach dates live at the top level of breach rows
    for f in rows:
        meta = f.get("extra_metadata")
        if f.get("status") == "found" and isinstance(meta, dict) and meta.get("breach_name"):
            b = breaches.get(norm.norm_text(str(meta["breach_name"])))
            if b and not b["date"] and meta.get("breach_date"):
                b["date"] = str(meta["breach_date"])

    def ranked(index: dict[str, dict[str, str]], key: str) -> list[dict[str, Any]]:
        out = [{key: k, "platform_count": len(v), "platforms": sorted(v.values(), key=str.casefold)}
               for k, v in index.items()]
        return sorted(out, key=lambda r: (-r["platform_count"], r[key]))

    handle_rows = ranked(handles, "handle")
    return {
        "total": len(rows),
        "found": status.get("found", 0),
        "not_found": status.get("not_found", 0),
        "error": status.get("error", 0),
        "unknown": status.get("unknown", 0),
        "by_source": {k: {s: v.get(s, 0) for s in ("found", "not_found", "error", "unknown")}
                      for k, v in sorted(by_source.items())},
        "account_count": len(real_accounts),
        "accounts": [{"account_key": a.account_key, "label": a.label, "handle": a.handle, "url": a.url,
                      "sources": a.sources, "finding_count": len(a.finding_ids)} for a in real_accounts],
        "platforms_found": len(account_platforms),
        "handles": handle_rows,
        "username_reuse": {r["handle"]: r["platform_count"] for r in handle_rows},
        "emails": ranked(emails, "email"),
        "breach_count": len(breaches),
        "breaches": [{"name": b["name"], "date": b["date"], "identifiers": sorted(b["identifiers"])}
                     for _, b in sorted(breaches.items())],
        "infostealer_count": infostealer,
        "scraped_pages": scraped,
    }


def _scanned(findings: list[dict[str, Any]]) -> set[tuple[str, str]]:
    out: set[tuple[str, str]] = set()
    for f in findings or []:
        if not isinstance(f, dict):
            continue
        itype, value = str(f.get("identifier_type") or "").lower(), f.get("identifier_value")
        if itype == "email" and (e := norm.norm_email(value)):
            out.add(("email", e))
        elif itype == "username" and (h := norm.norm_handle(value)):
            out.add(("username", h))
        elif itype == "domain" and isinstance(value, str) and value.strip():
            out.add(("domain", norm.clean_host(value)))
        elif itype in ("url", "scraped_url") and (u := norm.norm_url(value)):
            out.add(("url", u))
    return out


def extract_entities(findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pivot candidates discovered in findings, as rows for `store.upsert_entities`.

    kinds: `email`, `username` (platform = canonical platform, None when unknown),
    `url` (normalised, link hubs and site furniture dropped) and `domain` (hosts of
    personal sites and non-freemail email domains). Values are normalised and each
    (kind, value) appears once, attributed to the first finding that showed it
    (`source_finding_id`). Identifiers the case already scanned (the
    `identifier_value` of ANY row passed in, whatever its status) are never
    returned, so pass every row of the case, not only found ones. Seeds that have
    not been scanned yet are not visible here; the store's `is_seed` covers them.
    """
    out: dict[tuple[str, str], dict[str, Any]] = {}
    scanned = _scanned(findings)

    def add(kind: str, value: str, platform: str | None, finding_id: str) -> None:
        if (kind, value) in scanned:
            return
        cur = out.get((kind, value))
        if cur is None:
            out[(kind, value)] = {"kind": kind, "value": value, "platform": platform,
                                  "source_finding_id": finding_id}
        elif cur["platform"] is None and platform:
            cur["platform"] = platform

    for ff in facts_mod.extract(findings):
        for fact in ff.facts:
            if fact.kind == "email":
                if fact.value == ff.email:
                    continue
                add("email", fact.value, None, ff.finding_id)
                domain = fact.value.rsplit("@", 1)[-1]
                if domain not in _FREEMAIL:
                    add("domain", domain, None, ff.finding_id)
            elif fact.kind == "handle":
                add("username", fact.value, fact.platform or None, ff.finding_id)
            elif fact.kind == "url" and not ignorable_url(fact.value):
                add("url", fact.value, None, ff.finding_id)
                host = fact.value.partition("/")[0].partition("?")[0]
                if host not in norm.HOST_PLATFORM and not norm.handle_from_url(fact.value):
                    add("domain", host, None, ff.finding_id)
    return list(out.values())
