"""Deterministic exposure score for a case. Pure: no I/O, no LLM, no clock.

    score_exposure(findings, correlations) -> {score, band, factors, computed_from, method}

The score is the sum of capped factors (the `*_MAX` constants below add up to 100).
Every factor grows with diminishing returns (log / square root, never a linear count)
and never shrinks when a finding or an approved correlation is added.

Classification of rows (account, breach, infostealer, scrape) and everything a profile
says (emails, handles) comes from the correlation facts layer and `summarize()`. This
module only reads, in addition, the documented top-level meta of breach rows
(`breach_date`, `data_classes`), infostealer rows (`stealer_family`, `date_compromised`)
and the infra / media modules (`_read_*` helpers at the bottom of the readers section).

"Now" is the newest `collected_at` among the findings, so the same input always gives
the same output.
"""
from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date
from typing import Any

from sherlock_core.correlation import facts as facts_mod
from sherlock_core.correlation import norm, summarize
from sherlock_core.correlation.accounts import Account, group_accounts
from sherlock_core.correlation.facts import FindingFacts

# ----------------------------------------------------------------------------- weights (sum = 100)
BREACH_MAX = 30
FOOTPRINT_MAX = 15
LINKABILITY_MAX = 15
INFRA_MAX = 15
CONTACT_MAX = 10
HANDLE_REUSE_MAX = 10
MEDIA_MAX = 5
TOTAL_MAX = BREACH_MAX + FOOTPRINT_MAX + LINKABILITY_MAX + INFRA_MAX + CONTACT_MAX + HANDLE_REUSE_MAX + MEDIA_MAX

# Breach exposure, 30 = 10 + 4 + 6 + 10
BREACH_COUNT_MAX = 10          # distinct breaches, log curve
BREACH_COUNT_SATURATION = 20   # breaches at which the count part is full
BREACH_RECENCY_MAX = 4         # age of the newest dated breach / infostealer log
RECENCY_STEPS = ((1, 1.0), (3, 0.7), (5, 0.4), (10, 0.2))  # (age in years up to, share); older: RECENCY_OLD
RECENCY_OLD = 0.1
BREACH_SENSITIVITY_MAX = 6     # kinds of data exposed (shares below, summed, capped at 1)
SENSITIVITY = {                # category -> (share, label, keywords matched in a data-class name)
    "passwords": (0.4, "passwords", ("password", "passwd", "credential", "hash")),
    "government_id": (0.3, "government ID numbers",
                      ("government", "passport", "ssn", "social security", "national id", "driver", "licence",
                       "license", "tax id", "identity number", "id number")),
    "financial": (0.3, "financial data",
                  ("credit card", "card number", "payment", "bank", "financial", "iban", "cvv", "billing",
                   "account number", "partial credit")),
    "address": (0.2, "physical addresses", ("physical address", "home address", "address", "postcode", "zip")),
    "phone": (0.15, "phone numbers", ("phone", "mobile", "msisdn")),
    "birth_date": (0.1, "dates of birth", ("date of birth", "dob", "birth")),
}
INFOSTEALER_MAX = 10           # device-level credential theft: weighs most per item, square-root curve
INFOSTEALER_SATURATION = 3

FOOTPRINT_SATURATION = 50      # platforms with a found account
LINK_WEIGHTS = {               # approved correlation type -> how strongly it ties accounts together
    "manual_link": 1.0, "shared_email": 1.0, "shared_external_handle": 1.0,
    "avatar_match": 0.8, "shared_url": 0.7, "shared_bio_text": 0.6, "shared_display_name": 0.5,
    "breach_overlap": 0.4,
}
LINK_DEFAULT_WEIGHT = 0.5
LINK_SATURATION = 10           # weighted approved links
CONTACT_PHONE_WEIGHT = 1.5     # a published phone number counts as 1.5 published emails
CONTACT_SATURATION = 6
HANDLE_REUSE_SATURATION = 25   # platforms sharing one handle, beyond the first

# Infrastructure, 15 = 3 + 6 + 3 + 3
INFRA_PORTS_MAX = 3
INFRA_PORTS_SATURATION = 20
INFRA_VULNS_MAX = 6
INFRA_VULNS_SATURATION = 10
INFRA_MAIL_MAX = 3             # half for a domain without SPF, half for a domain without DMARC
INFRA_SUBDOMAINS_MAX = 3
INFRA_SUBDOMAINS_SATURATION = 200

MEDIA_GPS_SATURATION = 2       # images carrying GPS coordinates

BANDS = ((20, "low"), (45, "moderate"), (70, "high"))  # score below -> band; otherwise "severe"
EVIDENCE_LIMIT = 50            # finding ids listed per factor
REMEDIATION_LIMIT = 6          # steps listed per factor
LIST_LIMIT = 5                 # names spelled out inside one sentence

# Rows that summarize() files under "accounts" but that are scan by-products, not accounts.
NON_ACCOUNT_PLATFORMS = frozenset({"leakcheck", "activity"})

METHOD = (
    "A deterministic 0-100 estimate of how much this case's public findings expose the subject. It is the sum "
    "of capped factors (breaches and infostealer logs 30, account footprint 15, identity linkability 15, "
    "infrastructure 15, published contact details 10, handle reuse 10, image location metadata 5), each with "
    "diminishing returns. Only findings with status 'found' and correlations you approved are counted; pending "
    "and rejected correlations contribute nothing. Breach recency is measured against the newest collection "
    "date in the case. It is not a probability of compromise and not a security audit: it reflects only the "
    "sources that were scanned, so a low score does not prove that nothing else is exposed."
)
METHOD_EMPTY = (
    "No findings with status 'found' in this case yet, so there is nothing to score and the score is 0. "
    "Run a scan first. " + METHOD
)

_DATE = re.compile(r"^\s*(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?")
_CVE_LIKE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,40}$")


# ----------------------------------------------------------------------------- small helpers
def _log_share(n: float, saturation: float) -> float:
    """0..1, logarithmic: fast at first, full at `saturation`."""
    return 0.0 if n <= 0 else min(1.0, math.log1p(n) / math.log1p(saturation))


def _sqrt_share(n: float, saturation: float) -> float:
    return 0.0 if n <= 0 else min(1.0, math.sqrt(n / saturation))


def _dict(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _text(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _items(v: Any) -> list[Any]:
    return list(v) if isinstance(v, list | tuple | set) else []


def _parse_date(v: Any) -> date | None:
    """'2013', '2013-10', '2013-10-04', ISO timestamps. A missing month or day counts as the first."""
    m = _DATE.match(v) if isinstance(v, str) else None
    if not m:
        return None
    try:
        d = date(int(m.group(1)), int(m.group(2) or 1), int(m.group(3) or 1))
    except ValueError:
        return None
    return d if d.year >= 1990 else None


def _plural(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _listing(names: list[str], limit: int = LIST_LIMIT) -> str:
    """'A, B and C' or 'A, B, C and 4 more' (input order kept)."""
    shown, rest = names[:limit], len(names) - limit
    if rest > 0:
        return ", ".join(shown) + f" and {rest} more"
    return shown[0] if len(shown) == 1 else ", ".join(shown[:-1]) + " and " + shown[-1] if shown else ""


def _ids(ids: Any) -> list[str]:
    return sorted(set(ids))[:EVIDENCE_LIMIT]


def _factor(key: str, label: str, points: float, max_points: int, detail: str,
            evidence: Any, remediation: list[str]) -> dict[str, Any]:
    return {
        "key": key, "label": label, "points": round(max(0.0, min(float(max_points), points)), 1),
        "max_points": max_points, "detail": detail, "evidence_finding_ids": _ids(evidence),
        "remediation": remediation[:REMEDIATION_LIMIT],
    }


def _band(score: int) -> str:
    return next((name for limit, name in BANDS if score < limit), "severe")


# ----------------------------------------------------------------------------- readers
class _Row:
    """One usable `found` row: its facts plus the documented meta this module reads."""

    __slots__ = ("ff", "meta", "module")

    def __init__(self, ff: FindingFacts, finding: dict) -> None:
        self.ff = ff
        self.meta = _dict(finding.get("extra_metadata"))
        self.module = _text(finding.get("module"))

    @property
    def id(self) -> str:
        return self.ff.finding_id


def _rows(findings: list[dict]) -> list[_Row]:
    out: dict[str, _Row] = {}
    ordered = sorted((f for f in findings if isinstance(f, dict) and f.get("status") == "found"),
                     key=lambda f: (str(f.get("id") or ""), str(f.get("finding_key") or "")))
    for f in ordered:
        ff = facts_mod.facts_for(f)
        if ff and ff.finding_id not in out:
            out[ff.finding_id] = _Row(ff, f)
    return list(out.values())


def _reference_date(findings: list[dict]) -> date | None:
    dates = [d for f in findings if isinstance(f, dict) and (d := _parse_date(f.get("collected_at")))]
    return max(dates) if dates else None


def _is_account(row: _Row) -> bool:
    ff = row.ff
    return ff.kind == "account" and bool(ff.handle or ff.email) and ff.platform not in NON_ACCOUNT_PLATFORMS


def _sensitive_categories(classes: list[str]) -> set[str]:
    found: set[str] = set()
    for c in classes:
        name = c.replace("_", " ").casefold()
        for cat, (_, _, keywords) in SENSITIVITY.items():
            if any(k in name for k in keywords):
                # "email address" / "ip address" are not physical addresses
                if cat == "address" and any(x in name for x in ("email", "e-mail", "ip ", "mac ")):
                    continue
                found.add(cat)
    return found


def _read_classes(meta: dict) -> list[str]:
    """Data classes of a breach row, or the case-wide `exposed_fields` of a LeakCheck summary row."""
    return sorted({s for v in (*_items(meta.get("data_classes")), *_items(meta.get("exposed_fields")))
                   if (s := _text(v))})


# ----------------------------------------------------------------------------- factors
def _breach_factor(rows: list[_Row], today: date | None) -> dict[str, Any] | None:
    breaches: dict[str, dict[str, Any]] = {}
    stealers: list[_Row] = []
    loose_classes: dict[str, set[str]] = defaultdict(set)   # category -> finding ids (not tied to one breach)
    checked = False
    for r in rows:
        if r.ff.kind == "infostealer":
            stealers.append(r)
        elif r.ff.kind in ("breach", "event"):
            for fact in r.ff.of("breach"):
                b = breaches.setdefault(fact.value, {"names": set(), "dates": set(), "ids": set(),
                                                     "subjects": set(), "cats": set()})
                b["names"].add(str(fact.raw))
                b["ids"].add(r.id)
                if fact.subject:
                    b["subjects"].add(fact.subject)
                if r.ff.kind == "breach":
                    if d := _parse_date(r.meta.get("breach_date")):
                        b["dates"].add((d, _text(r.meta.get("breach_date"))[:10]))
                    b["cats"] |= _sensitive_categories(_read_classes(r.meta))
        elif r.ff.platform == "leakcheck":
            checked = True
            for cat in _sensitive_categories(_read_classes(r.meta)):
                loose_classes[cat].add(r.id)
    if not breaches and not stealers and not checked:
        return None

    def name(b: dict[str, Any]) -> str:
        label = min(b["names"], key=lambda s: (s.casefold(), s))
        return f"{label} ({max(b['dates'])[1]})" if b["dates"] else label

    def newest_first(keys: Any) -> list[str]:
        return sorted(keys, key=lambda k: (-(max(breaches[k]["dates"])[0].toordinal() if breaches[k]["dates"] else 0),
                                           name(breaches[k]).casefold(), k))

    n = len(breaches)
    count_pts = BREACH_COUNT_MAX * _log_share(n, BREACH_COUNT_SATURATION)

    stealer_dates = [(d, r) for r in stealers if (d := _parse_date(r.meta.get("date_compromised")))]
    dated = [max(b["dates"])[0] for b in breaches.values() if b["dates"]] + [d for d, _ in stealer_dates]
    recency_pts, recency_text = 0.0, ""
    if dated and today:
        newest = max(dated)
        age = max(0.0, (today - newest).days / 365.25)
        share = next((s for limit, s in RECENCY_STEPS if age <= limit), RECENCY_OLD)
        recency_pts = BREACH_RECENCY_MAX * share
        years = "less than a year" if age < 1 else _plural(int(age), "year")
        recency_text = f" The most recent dated exposure is from {newest.isoformat()[:7]}, {years} before the latest scan."
    elif n or stealers:
        recency_text = " The sources gave no dates, so recency is not scored."

    cats: dict[str, set[str]] = defaultdict(set)
    for b in breaches.values():
        for cat in b["cats"]:
            cats[cat] |= b["ids"]
    for cat, ids in loose_classes.items():
        cats[cat] |= ids
    sens_pts = BREACH_SENSITIVITY_MAX * min(1.0, sum(SENSITIVITY[c][0] for c in cats))
    ordered_cats = sorted(cats, key=lambda c: (-SENSITIVITY[c][0], c))
    if cats:
        sens_text = f" Sensitive data types reported: {_listing([SENSITIVITY[c][1] for c in ordered_cats], 6)}."
    elif n:
        sens_text = " The sources did not say which data types were exposed, so data sensitivity is not scored."
    else:
        sens_text = ""

    stealer_pts = INFOSTEALER_MAX * _sqrt_share(len(stealers), INFOSTEALER_SATURATION)

    if n or stealers:
        parts = []
        if n:
            parts.append(f"{_plural(n, 'distinct breach', 'distinct breaches')} "
                         f"({_listing([name(breaches[k]) for k in newest_first(breaches)])})")
        if stealers:
            parts.append(f"{_plural(len(stealers), 'infostealer log')} (credentials stolen from an infected device)")
        detail = "Found in " + " and ".join(parts) + "." + recency_text + sens_text
    else:
        detail = "A breach lookup returned a result but named no breach." + sens_text

    steps: list[str] = []
    by_subject: dict[str, list[_Row]] = defaultdict(list)
    for r in stealers:
        by_subject[r.ff.identifier_value.strip() or "this identifier"].append(r)
    for subject in sorted(by_subject, key=str.casefold):
        logs = by_subject[subject]
        families = sorted({f for r in logs if (f := _text(r.meta.get("stealer_family")))}, key=str.casefold)
        when = sorted({_text(r.meta.get("date_compromised"))[:10] for r in logs
                       if _parse_date(r.meta.get("date_compromised"))})
        steps.append(
            f"Credentials for {subject} were captured by infostealer malware"
            + (f" ({_listing(families)})" if families else "")
            + f" on {_plural(len(logs), 'infected device')}"
            + (f" (compromised {_listing(when)})" if when else "")
            + ": clean or reinstall that device, then change every password that was saved in its browsers "
              "and sign out all active sessions."
        )
    subjects: dict[str, set[str]] = defaultdict(set)
    for key, b in breaches.items():
        for s in b["subjects"]:
            subjects[s].add(key)
    for subject in sorted(subjects, key=lambda s: (-len(subjects[s]), s)):
        keys = newest_first(subjects[subject])
        steps.append(
            f"Change the password of accounts that use {subject} and turn on two-factor authentication: it appears "
            f"in the {_listing([name(breaches[k]) for k in keys])} {'breach' if len(keys) == 1 else 'breaches'}."
        )
    advice = {
        "government_id": "watch for identity fraud and consider a fraud alert or credit freeze where your country offers one",
        "financial": "check card and bank statements and ask the issuer to replace any card that was in use at the time",
        "address": "treat unexpected post or callers who quote your address as unverified",
        "phone": "expect phishing texts and calls, and ask your carrier for a SIM-swap / port-out lock",
    }
    for cat in ordered_cats:
        if cat in advice:
            src = sorted((k for k, b in breaches.items() if cat in b["cats"]), key=lambda k: name(breaches[k]).casefold())
            where = (f"the {_listing([name(breaches[k]) for k in src])} "
                     f"{'breach' if len(src) == 1 else 'breaches'}") if src else "these breaches (reported across all sources)"
            steps.append(f"{SENSITIVITY[cat][1].capitalize()} were among the data exposed in {where}: {advice[cat]}.")

    evidence = {i for b in breaches.values() for i in b["ids"]} | {r.id for r in stealers} \
        | {i for ids in loose_classes.values() for i in ids}
    return _factor("breach_exposure", "Breach exposure", count_pts + recency_pts + sens_pts + stealer_pts,
                   BREACH_MAX, detail, evidence, steps)


def _accounts(grouped: list[Account], rows: list[_Row]) -> list[Account]:
    """Found accounts, one per account however many rows / sources reported it."""
    ids = {r.id for r in rows if _is_account(r)}
    return [a for a in grouped if any(i in ids for i in a.finding_ids)]


def _footprint_factor(accounts: list[Account]) -> dict[str, Any] | None:
    if not accounts:
        return None
    n = len(accounts)
    by_platform: dict[str, str] = {}
    for a in accounts:
        by_platform.setdefault(a.platform, a.label)
    labels = sorted(by_platform.values(), key=lambda s: (s.casefold(), s))
    where = f"{_plural(len(labels), 'distinct platform')} ({_listing(labels, 8)})"
    head = (f"An account was found on {where}." if n == len(labels)
            else f"{_plural(n, 'account')} were found on {where}.")
    detail = head + " Every account is one more place that holds personal data and can be breached or taken over."
    steps = [f"Go through the {_plural(n, 'account')} found ({_listing(labels, 8)}) and delete or deactivate "
             "the ones you no longer use; set the rest to private where the platform allows it."]
    return _factor("account_footprint", "Account footprint", FOOTPRINT_MAX * _log_share(n, FOOTPRINT_SATURATION),
                   FOOTPRINT_MAX, detail, {i for a in accounts for i in a.finding_ids}, steps)


_LINK_PHRASES = {
    "shared_email": ("the same email address{v}", "use a different address or an alias on the accounts you want kept apart"),
    "shared_external_handle": ("a profile that names another account{v}", "remove that cross-reference from the profile"),
    "shared_url": ("the same link{v}", "remove the link from the profiles you want kept apart"),
    "shared_display_name": ("the same display name{v}", "use a different display name on the accounts you want kept apart"),
    "shared_bio_text": ("the same bio text", "reword the bio on the accounts you want kept apart"),
    "avatar_match": ("the same profile picture", "use a different picture on the accounts you want kept apart"),
    "breach_overlap": ("appearing in the same breach{v}", "use different sign-in addresses for identities you want kept apart"),
    "manual_link": ("a link you added by hand", "review what led you to connect them and remove that detail where you can"),
}


def _cross_account(c: dict, unit_of: dict[str, str]) -> bool:
    """True when the correlation's findings belong to 2+ different accounts."""
    return len({unit_of.get(str(i), f"finding:{i}") for i in _items(c.get("entities_involved"))}) >= 2


def _linkability_factor(correlations: list[dict], rows: list[_Row],
                        unit_of: dict[str, str]) -> tuple[dict[str, Any] | None, int]:
    # `same_account` rows are one account seen several times, never a link between accounts
    corrs = [c for c in correlations if isinstance(c, dict) and c.get("type") != "same_account"]
    if not corrs:
        return None, 0
    labels = {r.id: r.ff.label for r in rows}
    approved = sorted((c for c in corrs if c.get("status") == "approved" and _cross_account(c, unit_of)),
                      key=lambda c: (-LINK_WEIGHTS.get(str(c.get("type")), LINK_DEFAULT_WEIGHT), str(c.get("type")),
                                     str(c.get("matched_value") or ""), str(c.get("corr_key") or ""),
                                     sorted(str(i) for i in _items(c.get("entities_involved")))))
    other = len(corrs) - len(approved)
    weight = sum(LINK_WEIGHTS.get(str(c.get("type")), LINK_DEFAULT_WEIGHT) for c in approved)
    linked = {str(i) for c in approved for i in _items(c.get("entities_involved"))}
    not_counted = f" {_plural(other, 'pending or rejected link')} not counted." if other else ""
    if approved:
        kinds = sorted({str(c.get("type")) for c in approved})
        detail = (f"{_plural(len(approved), 'approved link')} ({_listing(kinds, 6)}) connect "
                  f"{_plural(len(linked), 'finding')} that would otherwise look unrelated, which makes it easier "
                  f"to tie the accounts to one person.{not_counted}")
    else:
        detail = f"No approved links between findings, so nothing is scored here.{not_counted}"
    steps = []
    for c in approved:
        kind = str(c.get("type"))
        how, fix = _LINK_PHRASES.get(kind, (f"a '{kind}' match", "remove the shared detail where you can"))
        value = _text(c.get("matched_value"))
        how = how.replace("{v}", f" ({value[:80]})" if value else "")
        where = sorted({labels[str(i)] for i in _items(c.get("entities_involved")) if str(i) in labels},
                       key=lambda s: (s.casefold(), s))
        subject = (f"The findings on {_listing(where)} are" if len(where) > 1
                   else f"{_plural(len(_items(c.get('entities_involved'))), 'finding')} on {where[0]} are" if where
                   else f"{_plural(len(_items(c.get('entities_involved'))), 'finding')} are")
        steps.append(f"{subject} tied together by {how}: {fix}.")
    return _factor("identity_linkability", "Identity linkability", LINKABILITY_MAX * _log_share(weight, LINK_SATURATION),
                   LINKABILITY_MAX, detail, linked, list(dict.fromkeys(steps))), len(approved)


def _phones(row: _Row) -> list[str]:
    extra = _dict(row.meta.get("extra"))
    out = []
    for key in ("phone", "phone_number", "phones"):
        for piece in norm.split_values(extra.get(key)):
            digits = re.sub(r"\D", "", piece)
            if 7 <= len(digits) <= 15:
                out.append(("+" if piece.strip().startswith("+") else "") + digits)
    return out


def _contact_factor(rows: list[_Row]) -> dict[str, Any] | None:
    profiles = [r for r in rows if r.ff.kind in ("account", "scrape") and r.ff.identifier_type in
                ("username", "email", "name", "scraped_url") and r.ff.platform not in NON_ACCOUNT_PLATFORMS]
    if not profiles:
        return None
    emails: dict[str, dict[str, set[str]]] = {}
    phones: dict[str, dict[str, set[str]]] = {}
    for r in profiles:
        for fact in r.ff.of("email"):
            if fact.value != r.ff.email:  # the address the row was looked up by is not a discovery
                e = emails.setdefault(fact.value, {"labels": set(), "ids": set()})
                e["labels"].add(r.ff.label)
                e["ids"].add(r.id)
        for p in _phones(r):
            e = phones.setdefault(p, {"labels": set(), "ids": set()})
            e["labels"].add(r.ff.label)
            e["ids"].add(r.id)
    points = CONTACT_MAX * _log_share(len(emails) + CONTACT_PHONE_WEIGHT * len(phones), CONTACT_SATURATION)
    if emails or phones:
        parts = ([f"{_plural(len(emails), 'email address', 'email addresses')} ({_listing(sorted(emails))})"] if emails else []) \
            + ([f"{_plural(len(phones), 'phone number')} ({_listing(sorted(phones))})"] if phones else [])
        detail = (f"{' and '.join(parts)} can be read in public profiles or pages. Published contact details "
                  "invite phishing and let anyone search for more accounts.")
    else:
        detail = f"No email address or phone number is published in the {_plural(len(profiles), 'profile or page', 'profiles and pages')} checked."
    steps = []
    for kind, index in (("phone number", phones), ("email address", emails)):
        for value in sorted(index):
            where = sorted(index[value]["labels"], key=lambda s: (s.casefold(), s))
            steps.append(f"Remove the {kind} {value} from {_listing(where)}, or replace it with a contact form "
                         "or an alias you can retire.")
    evidence = {i for index in (emails, phones) for v in index.values() for i in v["ids"]}
    return _factor("exposed_contact_details", "Exposed contact details", points, CONTACT_MAX, detail, evidence, steps)


def _handle_reuse_factor(summary: dict[str, Any], rows: list[_Row]) -> dict[str, Any] | None:
    handles = []
    for h in summary.get("handles") or []:
        labels = [p for p in h.get("platforms") or [] if norm.canonical_platform(p) not in NON_ACCOUNT_PLATFORMS]
        if labels:
            handles.append((str(h.get("handle")), labels))
    if not handles:
        return None
    handles.sort(key=lambda h: (-len(h[1]), h[0]))
    top, top_labels = handles[0]
    reused = [(h, labels) for h, labels in handles if len(labels) > 1]
    points = HANDLE_REUSE_MAX * _log_share(len(top_labels) - 1, HANDLE_REUSE_SATURATION)
    if reused:
        detail = (f"The handle '{top}' is used on {_plural(len(top_labels), 'platform')} ({_listing(top_labels)}). "
                  "One search for a reused handle finds every account that carries it.")
        if len(reused) > 1:
            detail += f" {_plural(len(reused), 'handle')} in this case are reused on more than one platform."
    else:
        detail = (f"{_plural(len(handles), 'handle')} checked; none is used on more than one platform, "
                  "so nothing is scored here.")
    steps = [f"The handle '{h}' is the same on {_listing(labels)}: pick a different handle for the accounts "
             "you do not want found together." for h, labels in reused]
    reused_names = {h for h, _ in reused}
    evidence = {r.id for r in rows if _is_account(r) and r.ff.handle in reused_names}
    return _factor("handle_reuse", "Handle reuse", points, HANDLE_REUSE_MAX, detail, evidence, steps)


def _infra_factor(rows: list[_Row]) -> dict[str, Any] | None:
    hosts = [r for r in rows if r.ff.platform == "internetdb" or r.module == "internetdb"]
    dns = [r for r in rows if r.module == "dns_records" or (r.ff.platform == "dns" and "has_spf" in r.meta)]
    certs = [r for r in rows if r.module == "crtsh" or r.ff.platform == "crt.sh"]
    if not hosts and not dns and not certs:
        return None
    parts: list[str] = []
    steps: list[str] = []
    evidence: set[str] = set()

    ports: dict[str, set[int]] = defaultdict(set)
    vulns: dict[str, set[str]] = defaultdict(set)
    for r in hosts:
        ip = _text(r.meta.get("ip")) or r.ff.identifier_value
        ports[ip] |= {p for p in _items(r.meta.get("ports")) if isinstance(p, int) and not isinstance(p, bool)}
        vulns[ip] |= {v.upper() for v in _items(r.meta.get("vulns")) if isinstance(v, str) and _CVE_LIKE.match(v)}
        if ports[ip] or vulns[ip]:
            evidence.add(r.id)
    n_ports = sum(len(p) for p in ports.values())
    all_vulns = {v for vs in vulns.values() for v in vs}
    ports_pts = INFRA_PORTS_MAX * _log_share(n_ports, INFRA_PORTS_SATURATION)
    vulns_pts = INFRA_VULNS_MAX * _sqrt_share(len(all_vulns), INFRA_VULNS_SATURATION)
    if hosts:
        parts.append(f"{_plural(n_ports, 'open port')} on {_plural(len(ports), 'address', 'addresses')} and "
                     f"{_plural(len(all_vulns), 'known vulnerability', 'known vulnerabilities')} listed by Shodan InternetDB")
    for ip in sorted(vulns):
        if vulns[ip]:
            steps.append(f"Update the software exposed on {ip}: Shodan lists {_plural(len(vulns[ip]), 'known vulnerability', 'known vulnerabilities')} "
                         f"for it ({_listing(sorted(vulns[ip]))}). These are inferred from version banners, so confirm each one.")
    for ip in sorted(ports):
        if ports[ip]:
            steps.append(f"Check the open {'port' if len(ports[ip]) == 1 else 'ports'} on {ip} "
                         f"({_listing([str(p) for p in sorted(ports[ip])], 12)}) and close or firewall every one "
                         "that does not need to be reachable from the internet.")

    no_spf = sorted({r.ff.identifier_value for r in dns if r.meta.get("has_spf") is False})
    no_dmarc = sorted({r.ff.identifier_value for r in dns if r.meta.get("has_dmarc") is False})
    mail_pts = INFRA_MAIL_MAX * (0.5 * bool(no_spf) + 0.5 * bool(no_dmarc))
    if dns:
        missing = ([f"no SPF record on {_listing(no_spf)}"] if no_spf else []) \
            + ([f"no DMARC record on {_listing(no_dmarc)}"] if no_dmarc else [])
        parts.append(" and ".join(missing) if missing else
                     f"SPF and DMARC records present on {_plural(len({r.ff.identifier_value for r in dns}), 'domain')}")
        evidence |= {r.id for r in dns if r.meta.get("has_spf") is False or r.meta.get("has_dmarc") is False}
    steps += [f"Publish an SPF record (a TXT record starting with v=spf1) for {d} so that others cannot send "
              "mail that passes as coming from it." for d in no_spf]
    steps += [f"Publish a DMARC record (a TXT record at _dmarc.{d}) so that receivers reject mail that fakes "
              "this domain." for d in no_dmarc]

    subdomains: dict[str, int] = {}
    for r in certs:
        count = r.meta.get("subdomain_count")
        if not isinstance(count, int) or isinstance(count, bool):
            count = len(_items(r.meta.get("subdomains")))
        d = r.ff.identifier_value
        subdomains[d] = max(subdomains.get(d, 0), count)
        if count:
            evidence.add(r.id)
    n_sub = sum(subdomains.values())
    sub_pts = INFRA_SUBDOMAINS_MAX * _log_share(n_sub, INFRA_SUBDOMAINS_SATURATION)
    if certs:
        parts.append(f"{_plural(n_sub, 'subdomain')} named in public certificate logs")
    steps += [f"Review the {_plural(subdomains[d], 'subdomain')} of {d} listed in certificate transparency logs and "
              "retire the hosts and DNS records that are no longer used." for d in sorted(subdomains) if subdomains[d] > 1]

    detail = "Infrastructure checks found " + "; ".join(parts) + "."
    return _factor("infrastructure_exposure", "Infrastructure exposure", ports_pts + vulns_pts + mail_pts + sub_pts,
                   INFRA_MAX, detail, evidence, steps)


def _media_factor(rows: list[_Row]) -> dict[str, Any] | None:
    images = [r for r in rows if r.module == "image_meta" or (r.ff.platform == "image" and "exif" in r.meta)]
    if not images:
        return None
    gps = sorted((r for r in images if r.meta.get("gps_present") is True or _dict(r.meta.get("exif")).get("gps_present") is True),
                 key=lambda r: (r.ff.url or r.ff.identifier_value, r.id))
    if gps:
        detail = (f"{len(gps)} of {_plural(len(images), 'image')} checked {'carries' if len(gps) == 1 else 'carry'} "
                  "GPS coordinates in the EXIF metadata, which shows where the photo was taken.")
    else:
        detail = f"None of the {_plural(len(images), 'image')} checked carries GPS coordinates in its metadata."
    steps = [f"Replace the published copy of {_text(r.meta.get('url')) or r.ff.identifier_value} with one that has "
             "its location metadata removed, and turn off location tagging in the camera app." for r in gps]
    return _factor("media_location", "Image location metadata", MEDIA_MAX * _sqrt_share(len(gps), MEDIA_GPS_SATURATION),
                   MEDIA_MAX, detail, {r.id for r in gps}, steps)


# ----------------------------------------------------------------------------- entry point
def score_exposure(findings: list[dict], correlations: list[dict]) -> dict[str, Any]:
    """Exposure score of a case from its finding rows and correlation rows. Pure and deterministic.

    Returns {score, band, factors: [{key, label, points, max_points, detail,
    evidence_finding_ids, remediation}], computed_from: {findings, approved_correlations}, method}.
    A factor is listed only when the case has data for it (possibly with 0 points).
    Accounts are counted once however many sources reported them; only approved links
    between DIFFERENT accounts count for linkability (`same_account` rows never do).
    Factors are ordered by points, highest first.
    """
    findings = [f for f in findings or [] if isinstance(f, dict)]
    correlations = [c for c in correlations or [] if isinstance(c, dict)]
    rows = _rows(findings)
    found = sum(1 for f in findings if f.get("status") == "found")
    split = {str(c.get("matched_value")) for c in correlations
             if c.get("type") == "same_account" and c.get("status") == "rejected"}
    grouped = group_accounts(findings, split)
    accounts = _accounts(grouped, rows)
    unit_of = {i: a.account_key for a in grouped for i in a.finding_ids}
    summary = summarize(findings, split)
    link_factor, approved = _linkability_factor(correlations, rows, unit_of)
    factors = [f for f in (
        _breach_factor(rows, _reference_date(findings)),
        _footprint_factor(accounts),
        link_factor,
        _contact_factor(rows),
        _handle_reuse_factor(summary, rows),
        _infra_factor(rows),
        _media_factor(rows),
    ) if f]
    factors.sort(key=lambda f: (-f["points"], f["key"]))
    score = max(0, min(TOTAL_MAX, int(round(sum(f["points"] for f in factors)))))
    return {
        "score": score,
        "band": _band(score),
        "factors": factors,
        "computed_from": {"findings": found, "approved_correlations": approved},
        "method": METHOD if found else METHOD_EMPTY,
    }
