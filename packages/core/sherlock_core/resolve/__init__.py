"""Candidate resolution for name searches: findings -> distinct people, ranked and explained.

    from sherlock_core.resolve import resolve_candidates
    candidates = resolve_candidates(findings, "Ada Lovelace", {"employer": "Analytical Engines Ltd"})

`names` holds the name comparison, `candidates` the clustering and scoring. Pure functions.
"""
from sherlock_core.resolve.names import NameMatch, match_name, name_tokens

__all__ = ["Candidate", "NameMatch", "match_name", "name_tokens", "resolve_candidates", "unassigned_finding_ids"]


def __getattr__(name: str):
    # `candidates` imports the correlation package; loading it lazily keeps `resolve.names`
    # importable from collector modules without pulling correlation in.
    if name in ("Candidate", "resolve_candidates", "unassigned_finding_ids"):
        from sherlock_core.resolve import candidates

        return getattr(candidates, name)
    raise AttributeError(name)
