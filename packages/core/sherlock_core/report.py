"""Deterministic Markdown report from a case. No agent yet — Phase 6 swaps this."""
from collections import defaultdict


def generate_markdown(case_id: str) -> str:
    """Return a Markdown report for case_id using findings + reviewed correlations only."""
    from sherlock_core import db

    case_row = db._client().table("cases").select("*").eq("id", case_id).execute().data
    if not case_row:
        raise ValueError(f"case {case_id} not found")
    case = case_row[0]

    findings = db.list_findings(case_id)
    corrs = db.list_correlations(case_id, reviewed=True)

    out = []
    out.append(f"# Investigation Report\n")
    out.append(f"**Case ID:** `{case['id']}`  ")
    out.append(f"**Created:** {case['created_at']}  ")
    out.append(f"**Status:** {case['status']}\n")

    out.append("## Identifiers Investigated\n")
    for ident in case["identifiers"]:
        out.append(f"- **{ident['type']}**: `{ident['value']}`")
    out.append("")

    out.append(f"## Findings ({len(findings)} total)\n")
    by_platform = defaultdict(list)
    for f in findings:
        by_platform[f["platform"]].append(f)
    for platform in sorted(by_platform):
        rows = by_platform[platform]
        out.append(f"### {platform} ({len(rows)})")
        for f in rows:
            out.append(f"- `{f['source_tool']}` — {f['status']} — `{f['identifier_value']}`")
        out.append("")

    if not corrs:
        out.append("## Approved Correlations\n\n_None reviewed yet._\n")
    else:
        out.append(f"## Approved Correlations ({len(corrs)})\n")
        for c in sorted(corrs, key=lambda x: -x["priority"]):
            out.append(f"### {c['type']} — confidence {c['confidence']:.2f}, priority {c['priority']:.2f}")
            out.append(f"**Entities:** {', '.join(c['entities_involved'])}")
            for ev in c["evidence"]:
                out.append(f"- {ev}")
            if c.get("review_note"):
                out.append(f"**Note:** {c['review_note']}")
            out.append("")

    out.append("## Next Steps\n")
    out.append("- [ ] Review remaining unreviewed correlations in the UI")
    out.append("- [ ] Run additional collectors (e.g. add a domain scan) if needed")
    out.append("- [ ] Re-run this report after review is complete")
    return "\n".join(out)
