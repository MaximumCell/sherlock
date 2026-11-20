"""Run the rules over a case's findings and shape the rows for `store.sync_correlations`."""
from __future__ import annotations

import contextlib
import hashlib
import math
from typing import Any

from sherlock_core.correlation.accounts import Account, accounts_from, contribution, inputs
from sherlock_core.correlation.facts import FindingFacts
from sherlock_core.correlation.rules import RULES, Context, Match, platforms

MAX_EVIDENCE = 60
MAX_VALUE_CHARS = 300


def corr_key(rule: str, matched_value_normalised: str) -> str:
    """Deterministic identity of a correlation: the rule and the matched VALUE."""
    return hashlib.sha256(f"{rule}|{matched_value_normalised}".encode()).hexdigest()


def priority(confidence: float, n_platforms: int) -> float:
    """confidence * log(1 + distinct canonical platforms involved)."""
    return round(confidence * math.log(1 + n_platforms), 4)


SAME_ACCOUNT = "same_account"


def _row(case_id: str, m: Match, unit_of: dict[str, str], unit_members: dict[str, list[str]]) -> dict[str, Any] | None:
    units = {unit_of.get(ff.finding_id, f"finding:{ff.finding_id}") for ff in m.members}
    if len(units) < 2:      # every member is the same account: nothing to review
        return None
    seen: set[tuple[str, str]] = set()
    items: list[dict[str, Any]] = []
    for ff, field, value in sorted(m.evidence, key=lambda e: (e[0].label.casefold(), e[0].finding_id, e[1])):
        if (ff.finding_id, field) in seen:
            continue
        seen.add((ff.finding_id, field))
        shown = str(value if value is not None else "")
        if len(shown) > MAX_VALUE_CHARS:
            shown = shown[:MAX_VALUE_CHARS] + "..."
        items.append({"finding_id": ff.finding_id, "platform": ff.label, "field": field, "value": shown,
                      "account_key": unit_of.get(ff.finding_id, f"finding:{ff.finding_id}")})
    confidence = round(max(0.0, min(1.0, m.confidence)), 2)
    return {
        "case_id": case_id,
        "type": m.rule,
        "corr_key": corr_key(m.rule, m.key),
        "matched_value": m.matched_value,
        "entities_involved": sorted({fid for u in units for fid in unit_members.get(u, [u.removeprefix("finding:")])}),
        "confidence": confidence,
        "evidence": [m.summary, *items[:MAX_EVIDENCE]],
        "priority": priority(confidence, len(platforms(m.members))),
    }


def _same_account_row(case_id: str, acc: Account, by_id: dict[str, FindingFacts],
                      rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    who = f" {acc.handle}" if acc.handle else ""
    summary = (f"{len(acc.finding_ids)} findings describe one {acc.label} account{who}, "
               f"confirmed by {', '.join(acc.sources)}.")
    if acc.joined_by:
        summary += " " + " ".join(f"{r}." for r in acc.joined_by)
    items = []
    for fid in acc.finding_ids:
        ff = by_id[fid]
        items.append({"finding_id": fid, "platform": ff.label, "field": "contributed", "value": contribution(ff),
                      "module": str(rows[fid].get("module") or rows[fid].get("source_tool") or ""),
                      "account_key": acc.account_key})
    return {
        "case_id": case_id,
        "type": SAME_ACCOUNT,
        "corr_key": corr_key(SAME_ACCOUNT, acc.account_key),
        "matched_value": acc.account_key,
        "entities_involved": list(acc.finding_ids),
        "confidence": 1.0,
        "evidence": [summary, *items[:MAX_EVIDENCE]],
        "priority": 0.0,
        "status": "approved",     # merged automatically; a user may split it (reject)
    }


def correlate(case_id: str, findings: list[dict[str, Any]],
              split_keys: set[str] | frozenset[str] | None = None) -> list[dict[str, Any]]:
    """Pure function: finding rows in, correlation rows out (highest priority first).

    Only rows with status "found" are read. `entities_involved` holds finding ids.
    Rules reason over ACCOUNTS (see `correlation.accounts`): a match whose members all
    belong to one account is dropped, and one `same_account` row (status "approved",
    i.e. merged automatically) is emitted per account with 2+ findings. `split_keys`
    are account keys the user split; their findings are treated as separate again.
    Engine rows never carry review fields other than that initial status;
    `store.sync_correlations` owns them.
    """
    ffs, rows = inputs(findings)
    full, applied = accounts_from(ffs, rows, split_keys=split_keys)
    unit_of = {fid: acc.account_key for acc in applied for fid in acc.finding_ids}
    unit_members = {acc.account_key: acc.finding_ids for acc in applied}
    ctx = Context(ffs, unit_of)
    out: dict[str, dict[str, Any]] = {}
    for rule in RULES:
        with contextlib.suppress(Exception):  # one bad rule must not lose the others' results
            for match in rule.matches(ctx):
                if len(match.members) >= 2 and (row := _row(case_id, match, unit_of, unit_members)):
                    out.setdefault(row["corr_key"], row)
    by_id = {ff.finding_id: ff for ff in ffs}
    for acc in full:
        if len(acc.finding_ids) >= 2:
            row = _same_account_row(case_id, acc, by_id, rows)
            out.setdefault(row["corr_key"], row)
    return sorted(out.values(), key=lambda r: (-r["priority"], r["type"], r["corr_key"]))
