"""Deterministic Markdown report for a case. No LLM, no network.

Contains only what a human approved (approved links between accounts with their
evidence), the summary statistics, each account once (with the sources that
confirmed it), and the other found findings grouped by platform. Rows with status
not_found / error are counted, never listed. Automatic `same_account` merges are not
links: they are how the account list is built.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from sherlock_core.correlation import summarize
from sherlock_core.correlation.accounts import group_accounts
from sherlock_core.store import Store, get_store
from sherlock_core.walled import is_unknown

MAX_PER_PLATFORM = 25
MAX_LIST = 20


def _md(value: Any) -> str:
    """Single-line, table/markup-safe text."""
    s = " ".join(str(value if value is not None else "").split())
    return s.replace("|", "\\|").replace("`", "'")


def _finding_label(f: dict[str, Any]) -> str:
    return f"{_md(f.get('platform'))}: `{_md(f.get('identifier_value'))}`"


def _evidence_line(ev: Any, findings: dict[str, dict[str, Any]]) -> str:
    if isinstance(ev, dict):
        f = findings.get(str(ev.get("finding_id")), {})
        platform = ev.get("platform") or f.get("platform") or "?"
        who = f" `{_md(f.get('identifier_value'))}`" if f else ""
        return f"- {_md(platform)}{who}, {_md(ev.get('field'))}: {_md(ev.get('value'))}"
    return f"- {_md(ev)}"


def _url(f: dict[str, Any]) -> str:
    meta = f.get("extra_metadata")
    url = meta.get("url") if isinstance(meta, dict) else None
    return url if isinstance(url, str) and url.startswith(("http://", "https://")) else ""


def generate_markdown(case_id: str, store: Store | None = None) -> str:
    """Markdown report for `case_id`. Raises ValueError when the case does not exist."""
    store = store or get_store()
    case = store.get_case(case_id)
    if not case:
        raise ValueError(f"case {case_id} not found")
    findings = store.list_findings(case_id)
    corrs = store.list_correlations(case_id)
    split = {str(c.get("matched_value")) for c in corrs if c.get("type") == "same_account"
             and c.get("status") == "rejected"}
    approved = sorted((c for c in corrs if c.get("status") == "approved" and c.get("type") != "same_account"),
                      key=lambda c: (-(c.get("priority") or 0), str(c.get("corr_key"))))
    stats = summarize(findings, split)
    by_id = {str(f.get("id")): f for f in findings}
    out: list[str] = []

    out.append(f"# Investigation report: {_md(case.get('title') or case_id)}\n")
    out.append(f"**Case ID:** `{case_id}`  ")
    out.append(f"**Created:** {_md(case.get('created_at'))}  ")
    out.append(f"**Status:** {_md(case.get('status'))}\n")

    out.append("## Identifiers investigated\n")
    for ident in case.get("identifiers") or []:
        if isinstance(ident, dict):
            out.append(f"- **{_md(ident.get('type'))}**: `{_md(ident.get('value'))}`")
    out.append("")

    out.append("## Summary\n")
    unknown = f"{stats['unknown']} could not be checked, " if stats["unknown"] else ""
    out.append(f"- Checks run: {stats['total']} ({stats['found']} found, {stats['not_found']} not found, "
               f"{unknown}{stats['error'] - stats['unknown']} errors)")
    unchecked = sorted({str(f.get("platform")) for f in findings if is_unknown(f)}, key=str.casefold)
    if unchecked:
        out.append(f"- Could not be checked automatically (open these by hand): {_md(', '.join(unchecked))}")
    out.append(f"- Accounts found: {stats['account_count']} on {stats['platforms_found']} platform(s)")
    for h in stats["handles"][:MAX_LIST]:
        out.append(f"- Handle `{_md(h['handle'])}` found on {h['platform_count']} platform(s)")
    for e in stats["emails"][:MAX_LIST]:
        out.append(f"- Email `{_md(e['email'])}` registered on {e['platform_count']} platform(s)")
    out.append(f"- Named breaches: {stats['breach_count']}; infostealer log entries: {stats['infostealer_count']}")
    for b in stats["breaches"][:MAX_LIST]:
        date = f" ({_md(b['date'])})" if b.get("date") else ""
        who = ", ".join(f"`{_md(i)}`" for i in b["identifiers"][:5])
        out.append(f"  - {_md(b['name'])}{date}: {who}")
    out.append("")

    accounts = stats["accounts"]
    out.append(f"## Accounts ({len(accounts)})\n")
    for a in accounts[:MAX_PER_PLATFORM * 4]:
        who = f" `{_md(a['handle'])}`" if a["handle"] else ""
        url = f" (<{a['url']}>)" if a["url"] else ""
        out.append(f"- {_md(a['label'])}{who}{url}, confirmed by: {_md(', '.join(a['sources']))}")
    if len(accounts) > MAX_PER_PLATFORM * 4:
        out.append(f"- ... and {len(accounts) - MAX_PER_PLATFORM * 4} more")
    out.append("")

    out.append(f"## Approved links between accounts ({len(approved)})\n")
    if not approved:
        out.append("_No correlation has been approved yet._\n")
    for c in approved:
        title = _md(c.get("matched_value")) or "manual link"
        out.append(f"### {_md(c.get('type'))}: {title}")
        out.append(f"Confidence {float(c.get('confidence') or 0):.2f}, priority {float(c.get('priority') or 0):.2f}\n")
        members = [_finding_label(by_id[i]) for i in c.get("entities_involved") or [] if i in by_id]
        if members:
            shown = ", ".join(members[:MAX_LIST])
            more = f" and {len(members) - MAX_LIST} more" if len(members) > MAX_LIST else ""
            out.append(f"**Findings linked:** {shown}{more}\n")
        for ev in c.get("evidence") or []:
            out.append(_evidence_line(ev, by_id))
        if c.get("review_note"):
            out.append(f"\n**Reviewer note:** {_md(c['review_note'])}")
        out.append("")

    listed = {a["account_key"] for a in accounts}
    in_accounts = {i for a in group_accounts(findings, split) if a.account_key in listed for i in a.finding_ids}
    found = [f for f in findings if f.get("status") == "found" and str(f.get("id")) not in in_accounts
             and not (isinstance(f.get("extra_metadata"), dict) and f["extra_metadata"].get("summary") is True)]
    out.append(f"## Other found findings by platform ({len(found)})\n")
    by_platform: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for f in found:
        by_platform[str(f.get("platform") or "unknown")].append(f)
    for platform in sorted(by_platform, key=str.casefold):
        rows = sorted(by_platform[platform], key=lambda f: str(f.get("identifier_value")))
        out.append(f"### {_md(platform)} ({len(rows)})")
        for f in rows[:MAX_PER_PLATFORM]:
            raw_meta = f.get("extra_metadata")
            meta: dict[str, Any] = raw_meta if isinstance(raw_meta, dict) else {}
            detail = _md(meta.get("breach_name") or meta.get("stealer_family") or "")
            url = _url(f)
            line = f"- `{_md(f.get('identifier_value'))}` via {_md(f.get('source_tool'))}"
            if detail:
                line += f": {detail}"
            if url:
                line += f" (<{url}>)"
            out.append(line)
        if len(rows) > MAX_PER_PLATFORM:
            out.append(f"- ... and {len(rows) - MAX_PER_PLATFORM} more")
        out.append("")

    out.append("## Method and limitations\n")
    out.append("- Sources are public data only. Breach entries are exposure metadata "
               "(name, date, data classes), never breached records.")
    out.append("- Correlations are produced by deterministic rules and listed here only after a "
               "human reviewer approved them.")
    out.append("- Confidence is a rule score between 0 and 1, not a probability and not certainty. "
               "An approved correlation is a lead to verify, not proof that two accounts belong to one person.")
    out.append("- A handle found on many platforms may belong to different people; absence of a "
               "finding does not prove an account does not exist.")
    return "\n".join(out) + "\n"
