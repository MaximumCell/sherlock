"""Candidate resolution: which findings of a name search describe the same PERSON.

    resolve_candidates(findings, name, hints) -> list[Candidate]   (best first)

Pure and deterministic: no I/O, no LLM, the same input always gives the same output.

How it works
  1. Every `found` finding of a person module becomes a record with
       own keys     identity claims the source makes about its subject: its ORCID iD, Wikidata
                    QID, account handles, and the record's own URL;
       linked keys  URLs / accounts the record links to.
  2. Records are clustered with union-find on STRONG keys only:
       * two records own the same key (same ORCID, same handle on the same platform, same
         profile URL, same Wikidata QID), or
       * one record links to a key another record owns (a cross-link) and their names agree.
     Two records that merely link to the same third page are NOT merged.
  3. WEAK signals never merge anything; they only move scores: employer / city / school /
     keyword hints, shared employers or topics between separate candidates, and web mentions
     whose text names something only one candidate has.
  4. Each cluster is scored 0..1 and every contribution is written to `evidence` in plain English.

News and other mentions are not people: they are attached to a candidate when exactly one
fits, otherwise left out (see `unassigned_finding_ids`).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import asdict, dataclass, field
from typing import Any

from sherlock_core.correlation import norm
from sherlock_core.resolve.names import NameMatch, best_match, describe, fold, match_name, name_tokens

# ----------------------------------------------------------------------------- weights
W_NAME = 0.35                       # x name-match score
W_SOURCES = (0.15, 0.10, 0.05)      # 2nd, 3rd, each further independent source
W_SOURCES_CAP = 0.35
W_PERSISTENT_ID = 0.05
W_HINT_EMPLOYER, W_HINT_CITY, W_HINT_SCHOOL = 0.15, 0.10, 0.10
W_HINT_KEYWORD, W_HINT_KEYWORD_CAP = 0.04, 0.12
W_HINT_INDIRECT = 0.05              # hint found somewhere less direct (city inside an employer name)
P_EMPLOYER_MISMATCH, P_CITY_MISMATCH, P_SCHOOL_MISMATCH = 0.08, 0.05, 0.05
W_MENTION, W_MENTION_CAP = 0.02, 0.06
W_RELATED, W_RELATED_CAP = 0.03, 0.06

IDENTITY_KINDS = ("record", "profile")
PERSISTENT_IDS = ("orcid", "wikidata")
# strongest first: what a candidate's stable id is derived from
_KEY_PRIORITY = ("orcid", "wikidata", "openalex", "companieshouse", "github", "linkedin", "twitter")
_SOURCE_PRIORITY = ("wikidata", "orcid", "openalex", "companies-house", "github", "web")
_ACCOUNT_PLATFORMS = frozenset(norm.HOST_PLATFORM.values()) | {"googlescholar"}
_ORG_NOISE = frozenset({"inc", "ltd", "llc", "limited", "plc", "corp", "corporation", "co", "company", "gmbh",
                        "the", "of", "and", "for", "at", "in", "de", "la"})
_WORDS = re.compile(r"[a-z0-9]+")
# "employers" that say nothing about who someone is
_GENERIC_ORGS = frozenset({"self employed", "self-employed", "freelance", "freelancer", "independent", "retired",
                           "student", "unemployed", "none", "n a", "various", "consultant", "private"})
_ORCID = re.compile(r"orcid\.org/(\d{4}-\d{4}-\d{4}-\d{3}[\dxX])")
_WIKIDATA = re.compile(r"wikidata\.org/(?:wiki|entity)/(Q\d+)")
_SOURCE_NAMES = {
    "openalex": "OpenAlex", "orcid": "ORCID", "wikidata": "Wikidata", "companies-house": "Companies House",
    "github": "GitHub", "web": "web search", "linkedin": "LinkedIn", "twitter": "X/Twitter",
    "googlescholar": "Google Scholar", "medium": "Medium", "companieshouse": "Companies House",
    "mastodon": "Mastodon", "instagram": "Instagram", "facebook": "Facebook", "youtube": "YouTube",
}


@dataclass
class Candidate:
    candidate_id: str
    label: str
    score: float
    evidence: list[str]
    finding_ids: list[str]
    attributes: dict[str, Any]
    related: list[str] = field(default_factory=list)   # other candidates sharing weak signals (not merged)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class _Rec:
    fid: str
    source: str                       # platform as stored: openalex, orcid, wikidata, github, web, ...
    kind: str                         # record | profile | news | mention
    name: str
    aliases: list[str]
    own: dict[tuple[str, str], str]   # key -> display value
    linked: dict[tuple[str, str], str]
    employers: list[str]
    education: list[str]
    locations: list[str]
    topics: list[str]
    emails: list[str]
    links: list[str]
    description: str
    text: str                         # folded free text (title, snippet, description) for weak matching
    url: str

    @property
    def names(self) -> list[str]:
        return [n for n in [self.name, *self.aliases] if n]

    @property
    def channel(self) -> str:
        """What counts as one independent source: the platform, or the site of a web profile."""
        if self.source == "web":
            for (kind, _value) in self.own:
                if kind in _ACCOUNT_PLATFORMS:
                    return kind
        return self.source


# ----------------------------------------------------------------------------- reading findings
def _list(v: Any) -> list[str]:
    if isinstance(v, str):
        v = [p for p in re.split(r"\s*[;,]\s*", v) if p]
    return [" ".join(str(x).split()) for x in v or [] if isinstance(x, str | int) and str(x).strip()]


def _display(source: str) -> str:
    return _SOURCE_NAMES.get(source, source)


def _id_key(platform: str, value: str) -> tuple[str, str] | None:
    plat = norm.canonical_platform(platform)
    v = str(value or "").strip()
    if not plat or not v:
        return None
    if plat == "googlescholar":
        return plat, v                                     # case-sensitive ids
    return plat, v.upper() if plat in ("orcid", "wikidata", "openalex") else v.lstrip("@").lower()


def _url_keys(url: str) -> dict[tuple[str, str], str]:
    """Keys a URL stands for: the page itself and, on known sites, the account or record behind it."""
    out: dict[tuple[str, str], str] = {}
    n = norm.norm_url(url)
    if not n:
        return out
    out[("url", n)] = url
    if m := _ORCID.search(url):
        out[("orcid", m.group(1).upper())] = m.group(1).upper()
    if m := _WIKIDATA.search(url):
        out[("wikidata", m.group(1))] = m.group(1)
    fixed = re.sub(r"//[a-z]{2,3}\.linkedin\.com", "//www.linkedin.com", url, flags=re.I)
    if pair := norm.handle_from_url(fixed):
        out[pair] = pair[1]
    return out


def _coarse(loc: str) -> bool:
    return bool(loc) and len(loc) <= 80 and not any(ch.isdigit() for ch in loc)


def _record(f: dict[str, Any]) -> _Rec | None:
    if not isinstance(f, dict) or f.get("status", "found") != "found":
        return None
    fid = str(f.get("id") or f.get("finding_key") or "")
    meta = f.get("extra_metadata") if isinstance(f.get("extra_metadata"), dict) else {}
    extra = meta.get("extra") if isinstance(meta.get("extra"), dict) else {}
    hint = extra.get("candidate_hint") if isinstance(extra.get("candidate_hint"), dict) else {}
    if not fid or (not hint and not extra.get("fullname")):
        return None
    source = str(f.get("platform") or "").strip().lower() or "unknown"
    url = str(meta.get("url") or "")
    kind = str(hint.get("kind") or extra.get("result_kind") or "record")
    own: dict[tuple[str, str], str] = {}
    ids = hint.get("ids") if isinstance(hint.get("ids"), dict) else {}
    for platform, value in ids.items():
        if key := _id_key(str(platform), str(value)):
            own[key] = str(value)
    if kind in IDENTITY_KINDS:
        own.update({k: v for k, v in _url_keys(url).items() if k not in own})
    links = _list(hint.get("links") or extra.get("links"))
    linked: dict[tuple[str, str], str] = {}
    for link in links:
        for k, v in _url_keys(link).items():
            if k not in own:
                linked[k] = link if k[0] == "url" else v
    description = str(hint.get("description") or extra.get("bio") or "")
    text = fold(" ".join([str(extra.get("title") or ""), str(extra.get("snippet") or ""), description]))
    return _Rec(
        fid=fid, source=source, kind=kind, name=str(hint.get("name") or extra.get("fullname") or ""),
        aliases=_list(hint.get("aliases")), own=own, linked=linked,
        employers=_list(hint.get("employers") or extra.get("employer")),
        education=_list(hint.get("education") or extra.get("education")),
        locations=[x for x in _list(hint.get("locations") or ([extra["location"]] if extra.get("location") else []))
                   if _coarse(x)],
        topics=_list(hint.get("topics")),
        emails=[e for e in (norm.norm_email(x) for x in _list(hint.get("emails") or extra.get("email"))) if e],
        links=links, description=description, text=text, url=url,
    )


# ----------------------------------------------------------------------------- union-find
class _Groups:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, i: int) -> int:
        while self.parent[i] != i:
            self.parent[i] = self.parent[self.parent[i]]
            i = self.parent[i]
        return i

    def union(self, a: int, b: int) -> bool:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.parent[max(ra, rb)] = min(ra, rb)
        return True


def _key_text(key: tuple[str, str], display: str) -> str:
    kind = key[0]
    if kind == "orcid":
        return f"ORCID iD {display}"
    if kind == "wikidata":
        return f"Wikidata entry {display}"
    if kind == "url":
        return f"page {key[1]}"
    if kind in _ACCOUNT_PLATFORMS:
        return f"{_display(kind)} account '{display}'"
    return f"{_display(kind)} id {display}"


def _names_agree(a: _Rec, b: _Rec) -> bool:
    return any(match_name(x, y).score >= 0.5 for x in a.names for y in b.names)


# ----------------------------------------------------------------------------- weak matching
def _tokens(text: str) -> list[str]:
    return [t for t in _WORDS.findall(fold(text)) if t not in _ORG_NOISE]


def _phrase_in(needle: str, haystack: str) -> bool:
    """All significant words of `needle` appear, in order and adjacent, in `haystack`."""
    n = _tokens(needle)
    return bool(n) and re.search(r"\b" + r"\W+(?:\w+\W+)?".join(map(re.escape, n)) + r"\b", fold(haystack)) is not None


def _generic_org(name: str) -> bool:
    return " ".join(_tokens(name)) in _GENERIC_ORGS or fold(name).strip() in _GENERIC_ORGS


def _same_org(a: str, b: str) -> bool:
    if _generic_org(a) or _generic_org(b):
        return False
    ta, tb = set(_tokens(a)), set(_tokens(b))
    return bool(ta) and bool(tb) and (ta <= tb or tb <= ta)


# hosts of sources and platforms: a link there is a record or an account, not the person's own site
_NOT_OWN_SITE = frozenset({
    "openalex.org", "orcid.org", "wikidata.org", "wikipedia.org", "find-and-update.company-information.service.gov.uk",
    "scholar.google.com", "medium.com", "web.archive.org",
}) | frozenset(norm.HOST_PLATFORM)


def _domains(links: list[str]) -> list[str]:
    """Registrable-looking hosts of links that are probably the person's own website."""
    out: list[str] = []
    for link in links:
        host = norm.clean_host(norm.url_host(link))
        if "/@" in link:                                  # a fediverse account on a shared instance
            continue
        if not host or "." not in host or any(host == d or host.endswith("." + d) for d in _NOT_OWN_SITE):
            continue
        if host not in out:
            out.append(host)
    return out[:5]


def _first(values: list[str], pred) -> str | None:
    return next((v for v in values if pred(v)), None)


def _stable_id(own: dict[tuple[str, str], str], fallback: str) -> str:
    def rank(key: tuple[str, str]) -> tuple[int, str, str]:
        kind = key[0]
        if kind in _KEY_PRIORITY:
            return _KEY_PRIORITY.index(kind), kind, key[1]
        return (len(_KEY_PRIORITY) + (1 if kind == "url" else 0)), kind, key[1]

    strongest = min(own, key=rank) if own else ("finding", fallback)
    return "c_" + hashlib.sha256(f"{strongest[0]}:{strongest[1]}".encode()).hexdigest()[:12]


def _merge(lists: list[list[str]], limit: int = 12) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for values in lists:
        for v in values:
            if v and fold(v) not in seen:
                seen.add(fold(v))
                out.append(v)
    return out[:limit]


# ----------------------------------------------------------------------------- the resolver
def resolve_candidates(findings: list[dict[str, Any]], name: str,
                       hints: dict[str, Any] | None = None) -> list[Candidate]:
    """Cluster person-module findings into distinct people and rank them. See the module docstring."""
    hints = hints or {}
    recs = [r for r in (_record(f) for f in findings or []) if r]
    recs.sort(key=lambda r: (_SOURCE_PRIORITY.index(r.source) if r.source in _SOURCE_PRIORITY else 99, r.fid))
    people = [r for r in recs if r.kind in IDENTITY_KINDS]
    mentions = [r for r in recs if r.kind not in IDENTITY_KINDS]

    groups = _Groups(len(people))
    reasons: dict[frozenset[int], str] = {}
    owners: dict[tuple[str, str], list[int]] = {}
    for i, r in enumerate(people):
        for key in r.own:
            owners.setdefault(key, []).append(i)
    for key in sorted(owners):
        idx = owners[key]
        for other in idx[1:]:
            a, b = people[idx[0]], people[other]
            who = (f"Two {_display(a.channel)} results describe" if a.channel == b.channel
                   else f"{_display(a.channel)} and {_display(b.channel)} records carry")
            reasons.setdefault(frozenset((idx[0], other)), f"{who} the same {_key_text(key, a.own[key])}")
            groups.union(idx[0], other)
    for i, r in enumerate(people):
        for key in sorted(r.linked):
            for j in owners.get(key, []):
                if j == i or not _names_agree(r, people[j]):
                    continue
                reasons.setdefault(frozenset((i, j)), (
                    f"The {_display(r.channel)} record links to the {_key_text(key, people[j].own[key])} "
                    f"found on {_display(people[j].channel)}"))
                groups.union(i, j)

    clusters: dict[int, list[int]] = {}
    for i in range(len(people)):
        clusters.setdefault(groups.find(i), []).append(i)

    built = []
    for members in clusters.values():
        rs = [people[i] for i in members]
        merge_reasons = [reason for pair, reason in reasons.items() if pair <= set(members)]
        built.append(_Cluster(rs, sorted(set(merge_reasons))))

    _attach_mentions(built, mentions)
    _relate(built)
    out = [c.candidate(name, hints) for c in built]
    out.sort(key=lambda c: (-c.score, -len(c.finding_ids), c.candidate_id))
    return out


def unassigned_finding_ids(findings: list[dict[str, Any]], candidates: list[Candidate]) -> list[str]:
    """Person findings (mostly news / mentions) that could not be attributed to one candidate."""
    used = {fid for c in candidates for fid in c.finding_ids}
    return [r.fid for r in (_record(f) for f in findings or []) if r and r.fid not in used]


class _Cluster:
    def __init__(self, recs: list[_Rec], merge_reasons: list[str]) -> None:
        self.recs = recs
        self.merge_reasons = merge_reasons
        self.mentions: list[tuple[_Rec, str]] = []
        self.related: list[tuple[_Cluster, str]] = []
        self.own: dict[tuple[str, str], str] = {}
        for r in recs:
            for k, v in r.own.items():
                self.own.setdefault(k, v)
        self.employers = _merge([r.employers for r in recs])
        self.education = _merge([r.education for r in recs])
        self.locations = _merge([r.locations for r in recs], 6)
        self.topics = _merge([r.topics for r in recs])
        self.cid = _stable_id(self.own, recs[0].fid)

    def terms(self) -> list[str]:
        """Things only this person is likely to be mentioned with (for attaching mentions)."""
        # a handle that only spells the name ("tim-berners-lee") is on every page that names the person
        name_toks = {t for r in self.recs for n in r.names for t in name_tokens(n)}
        handles = [v for (k, _), v in self.own.items()
                   if k in _ACCOUNT_PLATFORMS and len(v) >= 4 and not set(_tokens(v)) <= name_toks]
        cities = [loc.split(",")[0] for loc in self.locations if len(loc.split(",")[0]) > 3]
        employers = [e for e in self.employers if not _generic_org(e)]
        return _merge([employers, self.topics, handles, cities], 40)

    # ------------------------------------------------------------------ scoring
    def candidate(self, name: str, hints: dict[str, Any]) -> Candidate:
        evidence: list[str] = []
        score = 0.0

        all_names = _merge([r.names for r in self.recs], 30)
        match, matched = best_match(name, all_names)
        by = next((r for r in self.recs if matched in r.names), self.recs[0])
        score += W_NAME * match.score
        evidence.append(self._name_line(match, matched, by))

        channels = list(dict.fromkeys(r.channel for r in self.recs))
        extra_sources = len(channels) - 1
        if extra_sources > 0:
            gain = min(W_SOURCES_CAP, sum(W_SOURCES[min(i, len(W_SOURCES) - 1)] for i in range(extra_sources)))
            score += gain
            evidence.append(f"Confirmed by {len(channels)} independent sources "
                            f"({', '.join(_display(c) for c in channels)}): +{gain:.2f}")
            evidence.extend(f"Linked because: {r}" for r in self.merge_reasons)
        else:
            evidence.append(f"Seen in one source only ({_display(channels[0])}); nothing else confirms it")

        persistent = [(k, v) for (k, _), v in self.own.items() if k in PERSISTENT_IDS]
        if persistent:
            score += W_PERSISTENT_ID
            evidence.append(f"Has a persistent identifier ({_key_text((persistent[0][0], ''), persistent[0][1])}): "
                            f"+{W_PERSISTENT_ID:.2f}")

        score += self._hints(hints, evidence)

        if self.mentions:
            gain = min(W_MENTION_CAP, W_MENTION * len(self.mentions))
            score += gain
            terms = ", ".join(f"'{t}'" for t in list(dict.fromkeys(t for _, t in self.mentions))[:3])
            evidence.append(f"{len(self.mentions)} web page(s) mention the name together with {terms}: +{gain:.2f}")

        if self.related:
            gain = min(W_RELATED_CAP, W_RELATED * len(self.related))
            score += gain
            for other, why in self.related[:3]:
                evidence.append(f"{why} with another record ({other.cid}); possibly the same person, "
                                f"not merged without a stronger link: +{W_RELATED:.2f}")

        score = round(max(0.0, min(1.0, score)), 3)
        finding_ids = [r.fid for r in self.recs] + [r.fid for r, _ in self.mentions]
        handles = sorted(({"platform": k, "handle": v} for (k, _), v in self.own.items() if k in _ACCOUNT_PLATFORMS),
                         key=lambda h: (h["platform"], h["handle"]))
        own_urls = [r.url for r in self.recs if r.url]
        links = _merge([own_urls, *[r.links for r in self.recs]], 20)
        attributes = {
            "names": all_names[:8],
            "description": next((r.description for r in self.recs if r.description), None),
            "employers": self.employers,
            "education": self.education,
            "locations": self.locations,
            "handles": handles,
            "emails": _merge([r.emails for r in self.recs], 5),
            "links": links,
            "topics": self.topics,
            "domains": _domains(links),
            "identifiers": {k: v for (k, _), v in sorted(self.own.items())
                            if k not in _ACCOUNT_PLATFORMS and k != "url"},
            "sources": channels,
        }
        return Candidate(
            candidate_id=self.cid, label=self._label(matched or name), score=score, evidence=evidence,
            finding_ids=finding_ids, attributes=attributes, related=[o.cid for o, _ in self.related],
        )

    def _name_line(self, match: NameMatch, matched: str, by: _Rec) -> str:
        points = W_NAME * match.score
        if match.score == 0:
            return "No name on these records matches the searched name: +0.00"
        line = f"Name '{matched}' on {_display(by.channel)} {describe(match)}: +{points:.2f}"
        if match.kind == "single-token":
            line += " (a single shared name is very common, so this counts for little)"
        return line

    def _label(self, shown: str) -> str:
        best = next((r for r in self.recs if r.name and match_name(shown, r.name).score >= 0.9), None)
        display = (best.name if best else None) or self.recs[0].name or shown
        detail = next((r.description for r in self.recs
                       if r.source == "wikidata" and r.description and len(r.description) <= 90), None)
        if not detail and self.employers:
            detail = self.employers[0]
        if not detail:
            handle = next(((k, v) for (k, _), v in sorted(self.own.items()) if k in _ACCOUNT_PLATFORMS), None)
            detail = f"{_display(handle[0])}: {handle[1]}" if handle else _display(self.recs[0].channel)
        return f"{display} ({detail})"

    def _hints(self, hints: dict[str, Any], evidence: list[str]) -> float:
        gain = 0.0
        blob = " ".join(r.text for r in self.recs)

        if employer := hints.get("employer"):
            if hit := _first(self.employers, lambda e: _same_org(employer, e)):
                gain += W_HINT_EMPLOYER
                evidence.append(f"Employer hint '{employer}' matches '{hit}': +{W_HINT_EMPLOYER:.2f}")
            elif _phrase_in(employer, blob):
                gain += W_HINT_INDIRECT
                evidence.append(f"Employer hint '{employer}' appears in the profile text: +{W_HINT_INDIRECT:.2f}")
            elif self.employers:
                gain -= P_EMPLOYER_MISMATCH
                evidence.append(f"Employer hint '{employer}' not among stated employers "
                                f"({', '.join(self.employers[:3])}): -{P_EMPLOYER_MISMATCH:.2f}")

        if city := hints.get("city"):
            if hit := _first(self.locations, lambda loc: _phrase_in(city, loc)):
                gain += W_HINT_CITY
                evidence.append(f"City hint '{city}' matches location '{hit}': +{W_HINT_CITY:.2f}")
            elif hit := _first(self.employers + self.education, lambda e: _phrase_in(city, e)):
                gain += W_HINT_INDIRECT
                evidence.append(f"City hint '{city}' appears in '{hit}': +{W_HINT_INDIRECT:.2f}")
            elif [loc for loc in self.locations if len(loc) > 3]:
                gain -= P_CITY_MISMATCH
                evidence.append(f"City hint '{city}' differs from stated location "
                                f"({', '.join(self.locations[:2])}): -{P_CITY_MISMATCH:.2f}")

        if school := hints.get("school"):
            if hit := _first(self.education, lambda e: _same_org(school, e)):
                gain += W_HINT_SCHOOL
                evidence.append(f"School hint '{school}' matches education '{hit}': +{W_HINT_SCHOOL:.2f}")
            elif hit := _first(self.employers, lambda e: _same_org(school, e)):
                gain += W_HINT_INDIRECT
                evidence.append(f"School hint '{school}' matches affiliation '{hit}': +{W_HINT_INDIRECT:.2f}")
            elif self.education:
                gain -= P_SCHOOL_MISMATCH
                evidence.append(f"School hint '{school}' not among stated education "
                                f"({', '.join(self.education[:3])}): -{P_SCHOOL_MISMATCH:.2f}")

        keywords = hints.get("keywords") or []
        if isinstance(keywords, str):
            keywords = _list(keywords)
        context = " ".join([blob, *self.topics, *self.employers, *self.education])
        matched = [k for k in keywords if isinstance(k, str) and _phrase_in(k, context)]
        if matched:
            kw_gain = min(W_HINT_KEYWORD_CAP, W_HINT_KEYWORD * len(matched))
            gain += kw_gain
            evidence.append("Keyword hint(s) " + ", ".join(f"'{k}'" for k in matched)
                            + f" found in topics or profile text: +{kw_gain:.2f}")
        return gain


def _attach_mentions(clusters: list[_Cluster], mentions: list[_Rec]) -> None:
    """Give each news / mention page to the one candidate whose own terms it names, if unambiguous."""
    term_lists = [c.terms() for c in clusters]
    for m in mentions:
        hits = []
        for c, terms in zip(clusters, term_lists, strict=True):
            found = [t for t in terms if _phrase_in(t, m.text)]
            hits.append((len(found), found[0] if found else "", c))
        hits.sort(key=lambda h: -h[0])
        if hits and hits[0][0] >= 1 and (len(hits) == 1 or hits[0][0] > hits[1][0]):
            hits[0][2].mentions.append((m, hits[0][1]))


def _relate(clusters: list[_Cluster]) -> None:
    """Weak signals between separate candidates: reported, lightly scored, never merged."""
    for i, a in enumerate(clusters):
        for b in clusters[i + 1:]:
            why = None
            if org := _first(a.employers, lambda e: any(_same_org(e, x) for x in b.employers)):  # noqa: B023
                why = f"Shares employer '{org}'"
            else:
                shared = [t for t in a.topics if fold(t) in {fold(x) for x in b.topics}]
                cities = [x for x in a.locations if len(x) > 3 and fold(x) in {fold(y) for y in b.locations}]
                if len(shared) >= 2:
                    why = f"Shares topics '{shared[0]}' and '{shared[1]}'"
                elif cities and shared:
                    why = f"Shares location '{cities[0]}' and topic '{shared[0]}'"
            if why:
                a.related.append((b, why))
                b.related.append((a, why))
