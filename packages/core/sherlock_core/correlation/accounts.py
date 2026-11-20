"""Findings -> accounts. Pure, deterministic, order-independent.

Several lookups and several sources report the same account: a username sweep
(user-scanner), WhatsMyName and the GitHub module all say "GitHub `edith`", and a
later email search says "this email is registered on GitHub". Those are ONE account
seen several times, not separate things to review. This module decides which found
rows describe the same account; the engine then reasons over accounts.

Rules (see docs/CONTRACTS.md, "Accounts"):

* Found account rows with the same (canonical platform, normalised handle) are one
  account, whatever module reported them. `account_key = "<platform>:<handle>"`.
* A row looked up by another identifier (an email) whose own URL is a profile URL on
  the same platform belongs to that profile's account.
* A registration hit without a handle ("email E is registered on P") joins account
  (P, h) when a row of that account publishes E. If two accounts on P publish E the
  hit is ambiguous and stays on its own, keyed `"<platform>:<identifier_type>:<value>"`.
* A scrape of an account's own profile URL belongs to that account.
* Accounts the user split (`split_keys`) fall back to one item per finding.

Breach, infostealer and crawler-event rows are not accounts and are not returned.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from sherlock_core.correlation import facts as facts_mod
from sherlock_core.correlation import norm
from sherlock_core.correlation.facts import FindingFacts

ACCOUNT_KINDS = ("account", "scrape")
_PROFILE_KINDS = ("display_name", "bio", "location", "avatar_hash", "url", "email")
_NAME_FIELDS = ("fullname", "full_name", "display_name", "displayname", "name", "real_name", "realname")
_CREATED_FIELDS = ("created_at", "joined", "join_date", "created")
_AVATAR_FIELDS = ("avatar_url", "avatar", "image", "profile_image", "og_image")


@dataclass(slots=True)
class Account:
    account_key: str
    platform: str                       # canonical
    label: str                          # best display name of the platform
    handle: str                         # '' for an item without a handle
    url: str
    finding_ids: list[str]
    sources: list[str]                  # distinct modules, sorted
    primary_finding_id: str
    profile: dict[str, Any] = field(default_factory=dict)
    joined_by: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "account_key": self.account_key, "platform": self.platform, "label": self.label,
            "handle": self.handle, "url": self.url, "finding_ids": list(self.finding_ids),
            "sources": list(self.sources), "primary_finding_id": self.primary_finding_id,
            "profile": self.profile, "joined_by": list(self.joined_by),
        }


def best_label(labels: list[str], platform: str) -> str:
    """'GitHub' over 'Github' over 'github': the most deliberately capitalised spelling."""
    cands = [lb for lb in labels if lb and not lb.lower().startswith("scraped:")]
    if not cands:
        return labels[0] if labels else platform
    return min(cands, key=lambda s: (s.islower(), -sum(c.isupper() for c in s), s))


def _dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _module(f: dict[str, Any]) -> str:
    return str(f.get("module") or f.get("source_tool") or "unknown")


def _richness(ff: FindingFacts, row: dict[str, Any]) -> int:
    extra = {str(k).lower(): v for k, v in _dict(_dict(row.get("extra_metadata")).get("extra")).items()}
    n = sum(1 for f in ff.facts if f.kind in _PROFILE_KINDS)
    n += sum(1 for k in (*_AVATAR_FIELDS, *_CREATED_FIELDS) if isinstance(extra.get(k), str) and extra[k].strip())
    return n


def _first_extra(row: dict[str, Any], names: tuple[str, ...]) -> str:
    extra = {str(k).lower(): v for k, v in _dict(_dict(row.get("extra_metadata")).get("extra")).items()}
    for n in names:
        v = extra.get(n)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _raw_url(row: dict[str, Any]) -> str:
    u = _dict(row.get("extra_metadata")).get("url")
    return u if isinstance(u, str) and u.startswith(("http://", "https://")) else ""


_HTTP = re.compile(r"^https?://", re.I)


def _profile(members: list[FindingFacts], rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Merged profile view; members are already ordered primary first."""
    out: dict[str, Any] = {}

    def single(key: str, value: Any, fid: str) -> None:
        if key not in out and isinstance(value, str) and value.strip():
            out[key] = {"value": value.strip(), "finding_id": fid}

    emails: dict[str, dict[str, str]] = {}
    links: dict[str, dict[str, str]] = {}
    for ff in members:
        row = rows[ff.finding_id]
        for fact in ff.facts:
            if fact.kind == "display_name":
                single("fullname", str(fact.raw), ff.finding_id)
            elif fact.kind == "bio":
                single("bio", str(fact.raw), ff.finding_id)
            elif fact.kind == "location":
                single("location", str(fact.raw), ff.finding_id)
            elif fact.kind == "email":
                emails.setdefault(fact.value, {"value": fact.value, "finding_id": ff.finding_id})
            elif fact.kind == "url" and fact.field.startswith("extra.") and "_in_page" not in fact.field:
                raw = str(fact.raw).strip()
                links.setdefault(fact.value, {"value": raw if _HTTP.match(raw) else f"https://{fact.value}",
                                              "finding_id": ff.finding_id})
        if ff.kind == "account":
            single("fullname", _first_extra(row, _NAME_FIELDS) if not ff.of("display_name") else "", ff.finding_id)
        single("avatar_url", _first_extra(row, _AVATAR_FIELDS), ff.finding_id)
        single("created_at", _first_extra(row, _CREATED_FIELDS), ff.finding_id)
    # a "name" that only repeats the handle says nothing
    if "fullname" in out and norm.norm_handle(out["fullname"]["value"]) in {m.handle for m in members if m.handle}:
        del out["fullname"]
    out["emails"] = [emails[k] for k in sorted(emails)]
    out["links"] = [links[k] for k in sorted(links)]
    return out


class _Unit:
    __slots__ = ("key", "platform", "handle", "members", "reasons")

    def __init__(self, key: str, platform: str, handle: str) -> None:
        self.key, self.platform, self.handle = key, platform, handle
        self.members: list[FindingFacts] = []
        self.reasons: set[str] = set()


def _own_url_account(ff: FindingFacts, row: dict[str, Any]) -> tuple[str, str] | None:
    """(platform, handle) when a row looked up by something else points at its own profile."""
    pair = norm.handle_from_url(_raw_url(row)) if ff.kind == "account" else None
    return pair if pair and pair[0] == ff.platform else None


def _build(ffs: list[FindingFacts], rows: dict[str, dict[str, Any]]) -> list[_Unit]:
    """Full grouping (no split applied). Units sorted by key."""
    units: dict[str, _Unit] = {}
    labels: dict[str, str] = {}

    def unit(key: str, platform: str, handle: str) -> _Unit:
        if key not in units:
            units[key] = _Unit(key, platform, handle)
        return units[key]

    for ff in ffs:
        labels.setdefault(ff.platform, ff.label)
    pending: list[FindingFacts] = []
    scrapes: list[FindingFacts] = []
    # 1. rows that ARE an account with a handle
    for ff in sorted(ffs, key=lambda f: f.finding_id):
        if ff.kind == "scrape":
            scrapes.append(ff)
            continue
        pair = ff.account if ff.kind == "account" and ff.account else None
        if not pair:
            pair = _own_url_account(ff, rows[ff.finding_id])
            if pair:
                u = unit(f"{pair[0]}:{pair[1]}", pair[0], pair[1])
                u.members.append(ff)
                u.reasons.add(f"{{label}} account {pair[1]} was found by looking up "
                              f"{ff.identifier_value.strip()}")
                continue
            pending.append(ff)
            continue
        unit(f"{pair[0]}:{pair[1]}", pair[0], pair[1]).members.append(ff)

    # 2. registration hits without a handle join the one account that publishes the email
    publishers: dict[tuple[str, str], set[str]] = defaultdict(set)   # (platform, email) -> unit keys
    for u in units.values():
        for m in u.members:
            for fact in m.of("email"):
                publishers[(u.platform, fact.value)].add(u.key)
    for ff in pending:
        ident = ff.email if ff.identifier_type == "email" else ""
        owners = sorted(publishers.get((ff.platform, ident), ())) if ident else []
        if len(owners) == 1:
            u = units[owners[0]]
            u.members.append(ff)
            u.reasons.add(f"The {{label}} profile {u.handle} publishes {ident}, and {ident} is registered on {{label}}")
            continue
        value = ident or norm.norm_text(ff.identifier_value)
        unit(f"{ff.platform}:{ff.identifier_type or 'value'}:{value}", ff.platform, "").members.append(ff)

    # 3. a scrape of an account's own profile page
    for ff in scrapes:
        key = f"{ff.account[0]}:{ff.account[1]}" if ff.account else ""
        if key in units and units[key].handle:
            units[key].members.append(ff)
            units[key].reasons.add(f"A copy of the {{label}} profile page of {units[key].handle} was read")
            continue
        unit(f"{ff.platform}:url:{ff.url or ff.finding_id}", ff.platform, "").members.append(ff)
    return [units[k] for k in sorted(units)]


def _account(u: _Unit, members: list[FindingFacts], rows: dict[str, dict[str, Any]], key: str,
             reasons: set[str]) -> Account:
    ordered = sorted(members, key=lambda m: (-_richness(m, rows[m.finding_id]), m.kind != "account", m.finding_id))
    primary = ordered[0]
    label = best_label(sorted({m.label for m in members if m.kind == "account"} or {m.label for m in members}),
                       u.platform)
    url = next((_raw_url(rows[m.finding_id]) for m in ordered if _raw_url(rows[m.finding_id])), "")
    return Account(
        account_key=key, platform=u.platform, label=label, handle=u.handle if key == u.key else "",
        url=url, finding_ids=sorted(m.finding_id for m in members),
        sources=sorted({_module(rows[m.finding_id]) for m in members}), primary_finding_id=primary.finding_id,
        profile=_profile(ordered, rows),
        joined_by=sorted(r.replace("{label}", label) for r in reasons) if len(members) > 1 else [],
    )


def inputs(findings: list[dict[str, Any]]) -> tuple[list[FindingFacts], dict[str, dict[str, Any]]]:
    rows: dict[str, dict[str, Any]] = {}
    for f in findings or []:
        if isinstance(f, dict) and f.get("status") == "found":
            fid = str(f.get("id") or f.get("finding_key") or "")
            if fid:
                rows.setdefault(fid, f)
    return facts_mod.extract(list(rows.values())), rows


def group_accounts(findings: list[dict[str, Any]], split_keys: set[str] | frozenset[str] | None = None,
                   ) -> list[Account]:
    """Accounts (and handle-less account items) in the found rows, sorted by key.

    `split_keys`: account keys the user split; their findings come back one item each,
    keyed `"<account_key>#<finding_id>"`.
    """
    return accounts_from(*inputs(findings), split_keys=split_keys)[1]


def accounts_from(ffs: list[FindingFacts], rows: dict[str, dict[str, Any]], *,
                  split_keys: set[str] | frozenset[str] | None = None) -> tuple[list[Account], list[Account]]:
    """(full grouping ignoring splits, grouping with splits applied). Used by the engine."""
    split = set(split_keys or ())
    full: list[Account] = []
    applied: list[Account] = []
    for u in _build([ff for ff in ffs if ff.kind in ACCOUNT_KINDS], rows):
        acc = _account(u, u.members, rows, u.key, u.reasons)
        full.append(acc)
        if u.key in split and len(u.members) > 1:
            for m in sorted(u.members, key=lambda m: m.finding_id):
                one = _account(u, [m], rows, f"{u.key}#{m.finding_id}", set())
                one.handle = u.handle if m.account == (u.platform, u.handle) else ""
                applied.append(one)
        else:
            applied.append(acc)
    return full, applied


def contribution(ff: FindingFacts) -> str:
    """Plain words for what one finding adds to its account."""
    if ff.kind == "scrape":
        return "a copy of the profile page"
    parts = []
    names = {"display_name": "name", "bio": "bio", "location": "location", "email": "email",
             "url": "links", "avatar_hash": "profile picture"}
    for kind, word in names.items():
        if ff.of(kind):
            parts.append(word)
    if parts:
        return "profile details: " + ", ".join(parts)
    if ff.identifier_type == "email":
        return f"{ff.identifier_value.strip()} is registered here"
    return "confirms the account exists"
