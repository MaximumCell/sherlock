"""Correlation engine public API (see docs/CONTRACTS.md). Placeholder until the engine lands."""
from typing import Any


def correlate(case_id: str, findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return []


def summarize(findings: list[dict[str, Any]]) -> dict[str, Any]:
    return {}
