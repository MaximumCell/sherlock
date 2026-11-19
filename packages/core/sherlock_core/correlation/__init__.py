"""Correlation engine public API (see docs/CONTRACTS.md).

    correlate(case_id, findings) -> rows for store.sync_correlations
    summarize(findings)          -> case summary stats (handle reuse etc.), not review items
    extract_entities(findings)   -> pivot candidates, rows for store.upsert_entities

Layout: `norm` (normalisation), `facts` (the one place that knows source data
shapes), `rules` (one small class per rule), `engine` (rows, corr_key, priority),
`summary` (stats and entities). Pure functions, stdlib only, no I/O.
"""
from sherlock_core.correlation.engine import corr_key, correlate, priority
from sherlock_core.correlation.facts import Fact, FindingFacts, facts_for
from sherlock_core.correlation.rules import RULES, Rule
from sherlock_core.correlation.summary import extract_entities, summarize

__all__ = [
    "RULES", "Fact", "FindingFacts", "Rule", "corr_key", "correlate", "extract_entities", "facts_for",
    "priority", "summarize",
]
