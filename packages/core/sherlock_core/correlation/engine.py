"""Run the rules over a case's findings and shape the rows for `store.sync_correlations`."""
from __future__ import annotations

import contextlib
import hashlib
import math
from typing import Any

from sherlock_core.correlation import facts as facts_mod
from sherlock_core.correlation.rules import RULES, Context, Match, platforms

MAX_EVIDENCE = 60
MAX_VALUE_CHARS = 300


def corr_key(rule: str, matched_value_normalised: str) -> str:
    """Deterministic identity of a correlation: the rule and the matched VALUE."""
    return hashlib.sha256(f"{rule}|{matched_value_normalised}".encode()).hexdigest()


def priority(confidence: float, n_platforms: int) -> float:
    """confidence * log(1 + distinct canonical platforms involved)."""
    return round(confidence * math.log(1 + n_platforms), 4)


def _row(case_id: str, m: Match) -> dict[str, Any]:
    seen: set[tuple[str, str]] = set()
    items: list[dict[str, Any]] = []
    for ff, field, value in sorted(m.evidence, key=lambda e: (e[0].label.casefold(), e[0].finding_id, e[1])):
        if (ff.finding_id, field) in seen:
            continue
        seen.add((ff.finding_id, field))
        shown = str(value if value is not None else "")
        if len(shown) > MAX_VALUE_CHARS:
            shown = shown[:MAX_VALUE_CHARS] + "..."
        items.append({"finding_id": ff.finding_id, "platform": ff.label, "field": field, "value": shown})
    confidence = round(max(0.0, min(1.0, m.confidence)), 2)
    return {
        "case_id": case_id,
        "type": m.rule,
        "corr_key": corr_key(m.rule, m.key),
        "matched_value": m.matched_value,
        "entities_involved": sorted({ff.finding_id for ff in m.members}),
        "confidence": confidence,
        "evidence": [m.summary, *items[:MAX_EVIDENCE]],
        "priority": priority(confidence, len(platforms(m.members))),
    }


def correlate(case_id: str, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Pure function: finding rows in, correlation rows out (highest priority first).

    Only rows with status "found" are read. `entities_involved` holds finding ids.
    Never sets status / review fields; `store.sync_correlations` owns those.
    """
    ctx = Context(facts_mod.extract(findings))
    rows: dict[str, dict[str, Any]] = {}
    for rule in RULES:
        with contextlib.suppress(Exception):  # one bad rule must not lose the others' results
            for match in rule.matches(ctx):
                if len(match.members) >= 2:
                    row = _row(case_id, match)
                    rows.setdefault(row["corr_key"], row)
    return sorted(rows.values(), key=lambda r: (-r["priority"], r["type"], r["corr_key"]))
