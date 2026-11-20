"""Correlation rules. Each rule reads facts (never raw findings) and yields one
`Match` per CLUSTER of findings, never one per pair.

To add a rule: subclass `Rule`, implement `matches`, append an instance to `RULES`.

`Match.key` becomes the correlation's identity (`corr_key = sha256(rule|key)`).
It is the matched VALUE (the email, the URL, the name, `handle@platform`, ...),
not the member list, so the key stays the same as more findings join the cluster
and a reviewer's decision survives re-runs. Two rules have no single value:

* shared_bio_text: the key is the cluster's representative bio (most frequent
  normalised text, ties broken alphabetically). For identical bios that is simply
  the bio, so it never changes; a fuzzy cluster keeps its key unless a new member
  changes which text is most frequent.
* avatar_match: the key is the smallest hash in the cluster. For identical avatars
  that is the hash itself; a near-match cluster keeps its key unless a
  numerically smaller near-duplicate joins.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Any, ClassVar

from sherlock_core.correlation import norm
from sherlock_core.correlation.facts import Fact, FindingFacts


@dataclass(slots=True)
class Match:
    rule: str
    key: str                       # normalised matched value -> corr_key
    matched_value: str             # as shown to the reviewer
    confidence: float
    summary: str                   # one human-readable sentence
    members: list[FindingFacts]
    evidence: list[tuple[FindingFacts, str, Any]] = field(default_factory=list)  # (finding, field, value)


class Context:
    """Facts for one case, indexed once and shared by all rules."""

    def __init__(self, findings: list[FindingFacts], unit_of: dict[str, str] | None = None) -> None:
        self.findings = findings
        # finding id -> account key (see correlation.accounts); a finding outside any
        # account is its own unit
        self.unit_of = unit_of or {}
        self._by_value: dict[str, dict[str, list[tuple[FindingFacts, Fact]]]] = defaultdict(lambda: defaultdict(list))
        self.by_email: dict[str, list[FindingFacts]] = defaultdict(list)       # looked up BY this email
        self.by_account: dict[tuple[str, str], list[FindingFacts]] = defaultdict(list)  # found accounts
        for ff in findings:
            for fact in ff.facts:
                self._by_value[fact.kind][fact.value].append((ff, fact))
            if ff.email:
                self.by_email[ff.email].append(ff)
            if ff.kind == "account" and ff.handle:
                self.by_account[(ff.platform, ff.handle)].append(ff)

    def unit(self, ff: FindingFacts) -> str:
        return self.unit_of.get(ff.finding_id) or f"finding:{ff.finding_id}"

    def by_value(self, kind: str) -> dict[str, list[tuple[FindingFacts, Fact]]]:
        return self._by_value.get(kind, {})


class UnionFind:
    def __init__(self, n: int) -> None:
        self.parent = list(range(n))

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> int:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[max(ra, rb)] = min(ra, rb)
        return min(ra, rb)

    def groups(self) -> list[list[int]]:
        out: dict[int, list[int]] = defaultdict(list)
        for i in range(len(self.parent)):
            out[self.find(i)].append(i)
        return list(out.values())


def platforms(members: Iterable[FindingFacts]) -> list[str]:
    return sorted({m.platform for m in members if m.platform})


def _labels(members: Iterable[FindingFacts]) -> str:
    seen: dict[str, str] = {}
    for m in members:
        seen.setdefault(m.platform, m.label)
    names = sorted(seen.values(), key=str.casefold)
    return ", ".join(names[:8]) + (f" and {len(names) - 8} more" if len(names) > 8 else "")


def _unique(members: Iterable[FindingFacts]) -> list[FindingFacts]:
    return sorted({m.finding_id: m for m in members}.values(), key=lambda m: m.finding_id)


class Rule:
    name: ClassVar[str]

    def matches(self, ctx: Context) -> Iterator[Match]:
        raise NotImplementedError


# ----------------------------------------------------------------------------- circular evidence
def restates_lookup(ff: FindingFacts, email: str) -> bool:
    """True when `ff` only restates the email it was LOOKED UP BY and adds nothing independent.

    "E is registered on Spotify" exists only because E was searched, and E was usually
    discovered on another profile; pairing the two would cite one fact twice. A finding
    looked up by E that carries its own profile data (the Gravatar profile of E: name,
    bio, links) is independent evidence and is NOT a restatement.
    """
    return ff.email == email and not (ff.kind == "account" and ff.is_rich)


# ----------------------------------------------------------------------------- shared_email
class SharedEmail(Rule):
    """The same email is published by profiles on 2+ platforms.

    A finding that was merely looked up BY the email ("this email is registered on
    Spotify") is not evidence: it only joins when it carries profile data (e.g. the
    Gravatar profile of that email), and never forms a correlation on its own.
    """

    name = "shared_email"
    confidence = 0.9

    def matches(self, ctx):
        for email, pairs in ctx.by_value("email").items():
            ev: dict[str, tuple[FindingFacts, str, Any]] = {}
            for ff, fact in pairs:
                if restates_lookup(ff, email):
                    continue
                ev.setdefault(ff.finding_id, (ff, fact.field, fact.raw))
            for ff in ctx.by_email.get(email, ()):
                if not restates_lookup(ff, email):
                    ev.setdefault(ff.finding_id, (ff, "identifier_value", ff.identifier_value))
            members = _unique(e[0] for e in ev.values())
            if not any(m.email != email for m in members):
                continue
            plats = platforms(members)
            if len(plats) < 2:
                continue
            yield Match(self.name, email, email, self.confidence,
                        f"Email {email} appears on {len(plats)} platforms: {_labels(members)}",
                        members, list(ev.values()))


# ----------------------------------------------------------------------------- shared_url
# Ignored whatever the path: page furniture that scraped pages share by accident.
_NOISE_HOSTS = frozenset({
    "schema.org", "w3.org", "gmpg.org", "fonts.googleapis.com", "fonts.gstatic.com", "ajax.googleapis.com",
    "creativecommons.org", "wordpress.org", "wordpress.com", "cloudflare.com", "cdnjs.cloudflare.com",
    "googletagmanager.com", "google-analytics.com", "gstatic.com", "jsdelivr.net", "cdn.jsdelivr.net",
    "unpkg.com", "ogp.me", "purl.org", "xmlns.com",
})
# Ignored at the root only (link hubs, search engines, stores): `linktr.ee` says
# nothing, `linktr.ee/edith` does. Every known platform host is treated the same way.
_GENERIC_HOSTS = frozenset({
    "google.com", "bing.com", "duckduckgo.com", "yahoo.com", "linktr.ee", "bit.ly", "t.co", "goo.gl",
    "tinyurl.com", "example.com", "wikipedia.org", "en.wikipedia.org", "apple.com", "apps.apple.com",
    "play.google.com", "microsoft.com", "amazon.com", "wa.me", "whatsapp.com", "paypal.com", "paypal.me",
    "ko-fi.com", "buymeacoffee.com", "beacons.ai", "carrd.co", "bio.link", "lnk.bio", "spotify.com",
    "open.spotify.com", "maps.google.com", "docs.google.com", "drive.google.com", "dropbox.com",
    "notion.so", "substack.com", "blogspot.com", "wixsite.com", "github.io", "netlify.app", "vercel.app",
    "googleusercontent.com", "gmail.com", "outlook.com", "icloud.com", "zoom.us", "calendly.com",
    "cash.app", "venmo.com", "opensea.io", "onlyfans.com", "msn.com", "live.com",
})
_FURNITURE = frozenset({
    "login", "logout", "signup", "signin", "join", "register", "home", "privacy", "terms", "tos", "help",
    "about", "explore", "search", "settings", "share", "sharer", "intent", "legal", "policies", "policy",
    "support", "contact", "download", "pricing", "features", "careers", "jobs", "press", "cookies",
})
_ASSET = re.compile(r"\.(?:css|js|ico|woff2?|ttf|map|json|xml)$")


def ignorable_url(url: str) -> bool:
    """True for normalised URLs that many unrelated profiles link to."""
    host, _, rest = url.partition("/")
    host = host.partition("?")[0]
    path = rest.partition("?")[0]
    if host in _NOISE_HOSTS or _ASSET.search(path):
        return True
    if host in _GENERIC_HOSTS or host in norm.HOST_PLATFORM:
        first = path.split("/", 1)[0].lower()
        return not first or first in _FURNITURE
    return False


class SharedUrl(Rule):
    """The same (path-specific) URL is linked from 2+ platforms."""

    name = "shared_url"
    confidence = 0.8

    def matches(self, ctx):
        for url, pairs in ctx.by_value("url").items():
            if len(pairs) < 2 or ignorable_url(url):
                continue
            ev: dict[str, tuple[FindingFacts, str, Any]] = {}
            for ff, fact in pairs:
                ev.setdefault(ff.finding_id, (ff, fact.field, fact.raw))
            members = _unique(e[0] for e in ev.values())
            plats = platforms(members)
            # two scraped pages sharing a link is page furniture more often than identity
            if len(plats) < 2 or all(m.kind == "scrape" for m in members):
                continue
            yield Match(self.name, url, url, self.confidence,
                        f"Link {url} appears on {len(plats)} platforms: {_labels(members)}",
                        members, list(ev.values()))


# ----------------------------------------------------------------------------- shared_external_handle
class SharedExternalHandle(Rule):
    """Finding A links to / names handle H on platform P, and an account H was
    found on P. Platform names are canonical, so GitHub's `twitter: edith` matches
    a finding stored under platform "X"."""

    name = "shared_external_handle"
    confidence = 0.95
    weak_confidence = 0.7       # only scraped pages / crawler events point at the account

    def matches(self, ctx):
        groups: dict[tuple[str, str], dict[str, tuple[FindingFacts, str, Any]]] = defaultdict(dict)
        for handle, pairs in ctx.by_value("handle").items():
            for ff, fact in pairs:
                target = (fact.platform, handle)
                if not fact.platform or target not in ctx.by_account or ff.account == target:
                    continue
                groups[target].setdefault(ff.finding_id, (ff, fact.field, fact.raw))
        for (plat, handle), ev in groups.items():
            targets = ctx.by_account[(plat, handle)]
            sources = _unique(e[0] for e in ev.values())
            strong = any(s.kind == "account" for s in sources)
            evidence = [(t, "identifier_value", t.identifier_value) for t in _unique(targets)] + list(ev.values())
            members = _unique([*targets, *sources])
            label = targets[0].label
            yield Match(self.name, f"{handle}@{plat}", f"{handle}@{plat}",
                        self.confidence if strong else self.weak_confidence,
                        f"{label} account {handle} is referenced by {len(sources)} other "
                        f"finding(s): {_labels(sources)}",
                        members, evidence)


# ----------------------------------------------------------------------------- shared_display_name
class SharedDisplayName(Rule):
    """The same display name (casefolded, whitespace-collapsed) on 2+ platforms.
    0.6 for two platforms, +0.05 per extra platform, capped at 0.85; single-token
    or very short names are common, so they score 0.2 lower."""

    name = "shared_display_name"
    base, step, cap, weak_penalty = 0.6, 0.05, 0.85, 0.2

    def matches(self, ctx):
        for name, pairs in ctx.by_value("display_name").items():
            ev: dict[str, tuple[FindingFacts, str, Any]] = {}
            for ff, fact in pairs:
                if ff.kind == "account":
                    ev.setdefault(ff.finding_id, (ff, fact.field, fact.raw))
            members = _unique(e[0] for e in ev.values())
            plats = platforms(members)       # de-duplicated per platform
            if len(plats) < 2:
                continue
            conf = min(self.base + self.step * (len(plats) - 2), self.cap)
            if len(name.split()) < 2 or len(name) < 6:
                conf -= self.weak_penalty
            shown = str(next(iter(ev.values()))[2])
            yield Match(self.name, name, shown, round(conf, 2),
                        f"Display name '{shown}' appears on {len(plats)} platforms: {_labels(members)}",
                        members, list(ev.values()))


# ----------------------------------------------------------------------------- shared_bio_text
_TOKEN = re.compile(r"\w+")


class SharedBioText(Rule):
    """Identical or near-identical bios (>= 20 chars) on different accounts.

    Exact matches are grouped by hashing. Near matches are found by blocking on
    each bio's rarest tokens, then token overlap, then `quick_ratio()` before the
    expensive `ratio()`. A profile and its own scrape are one account, so a cluster
    needs two distinct accounts to count.
    """

    name = "shared_bio_text"
    min_len = 20
    exact, close, loose = 0.8, 0.7, 0.6      # identical / ratio >= 0.9 / ratio >= 0.8
    rare_tokens = 4
    max_bucket = 50
    window = 5
    max_compare_chars = 600

    def matches(self, ctx):
        by_text: dict[str, list[tuple[FindingFacts, Fact]]] = {}
        for text, pairs in ctx.by_value("bio").items():
            if len(text) < self.min_len:
                continue
            keep = [(ff, fact) for ff, fact in pairs if ff.kind in ("account", "scrape")]
            if keep:
                by_text[text] = keep
        texts = sorted(by_text)
        if not texts:
            return
        uf = UnionFind(len(texts))
        weakest = [self.exact] * len(texts)       # per root: weakest link that built the cluster
        for i, j, conf in self._near_pairs(texts):
            ri, rj = uf.find(i), uf.find(j)
            if ri == rj:
                continue
            root = uf.union(ri, rj)
            weakest[root] = min(weakest[ri], weakest[rj], conf)
        for group in uf.groups():
            pairs = [p for i in group for p in by_text[texts[i]]]
            ev: dict[str, tuple[FindingFacts, str, Any]] = {}
            for ff, fact in pairs:
                ev.setdefault(ff.finding_id, (ff, fact.field, fact.raw))
            members = _unique(e[0] for e in ev.values())
            if len({ctx.unit(m) for m in members}) < 2:
                continue
            counts = Counter({texts[i]: len(by_text[texts[i]]) for i in group})
            rep = min(counts, key=lambda t: (-counts[t], t))
            conf = weakest[uf.find(group[0])]
            how = "identical" if len(group) == 1 else "near-identical"
            shown = str(by_text[rep][0][1].raw)
            n_accounts = len({ctx.unit(m) for m in members})
            yield Match(self.name, rep, shown[:200], conf,
                        f"Bio text is {how} on {n_accounts} accounts: {_labels(members)}",
                        members, list(ev.values()))

    def _near_pairs(self, texts: list[str]) -> Iterator[tuple[int, int, float]]:
        if len(texts) < 2:
            return
        tokens = [frozenset(_TOKEN.findall(t)) for t in texts]
        df: Counter[str] = Counter(tok for ts in tokens for tok in ts)
        buckets: dict[str, list[int]] = defaultdict(list)
        for i, ts in enumerate(tokens):
            for tok in sorted(ts, key=lambda t: (df[t], t))[: self.rare_tokens]:
                buckets[tok].append(i)
        seen: set[tuple[int, int]] = set()
        for bucket in buckets.values():
            if len(bucket) < 2:
                continue
            if len(bucket) <= self.max_bucket:
                cand = ((a, b) for x, a in enumerate(bucket) for b in bucket[x + 1:])
            else:  # texts are sorted, so neighbours in a huge bucket are the likeliest matches
                cand = ((a, b) for x, a in enumerate(bucket) for b in bucket[x + 1: x + 1 + self.window])
            for a, b in cand:
                if (a, b) in seen:
                    continue
                seen.add((a, b))
                ratio = self._ratio(texts[a], texts[b], tokens[a], tokens[b])
                if ratio >= 0.9:
                    yield a, b, self.close
                elif ratio >= 0.8:
                    yield a, b, self.loose

    def _ratio(self, a: str, b: str, ta: frozenset[str], tb: frozenset[str]) -> float:
        la, lb = len(a), len(b)
        if min(la, lb) / max(la, lb) < 0.66:           # ratio() cannot reach 0.8
            return 0.0
        if len(ta & tb) < 0.6 * min(len(ta), len(tb)):
            return 0.0
        sm = SequenceMatcher(None, a[: self.max_compare_chars], b[: self.max_compare_chars], autojunk=False)
        if sm.real_quick_ratio() < 0.8 or sm.quick_ratio() < 0.8:
            return 0.0
        return sm.ratio()


# ----------------------------------------------------------------------------- breach_overlap
class BreachOverlap(Rule):
    """2+ distinct identifiers of the case appear in the same named breach or the
    same infostealer log. Exposure metadata only: breach name and who was in it."""

    name = "breach_overlap"
    confidence = 0.9

    def matches(self, ctx):
        for value, pairs in ctx.by_value("breach").items():
            subjects = sorted({fact.subject for _, fact in pairs if fact.subject})
            if len(subjects) < 2:
                continue
            ev: dict[str, tuple[FindingFacts, str, Any]] = {}
            for ff, fact in pairs:
                ev.setdefault(ff.finding_id, (ff, fact.field, fact.subject))
            members = _unique(e[0] for e in ev.values())
            shown = str(pairs[0][1].raw)
            yield Match(self.name, value, shown, self.confidence,
                        f"{len(subjects)} identifiers appear in '{shown}': {', '.join(subjects[:8])}",
                        members, list(ev.values()))


# ----------------------------------------------------------------------------- avatar_match
class AvatarMatch(Rule):
    """Profile images on 2+ platforms whose 64-bit perceptual hashes are within
    Hamming distance 6. Compares hashes only; no image is read and no face is
    recognised."""

    name = "avatar_match"
    max_distance = 6
    identical, near = 0.95, 0.85
    # 7 bands over 64 bits: hashes within distance 6 agree on at least one whole band
    bands = ((0, 10), (10, 9), (19, 9), (28, 9), (37, 9), (46, 9), (55, 9))

    def matches(self, ctx):
        by_hash = {h: [(ff, fact) for ff, fact in pairs if ff.kind == "account"]
                   for h, pairs in ctx.by_value("avatar_hash").items()}
        hashes = sorted(h for h, pairs in by_hash.items() if pairs)
        if not hashes:
            return
        ints = [int(h, 16) for h in hashes]
        uf = UnionFind(len(hashes))
        buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
        for i, v in enumerate(ints):
            for b, (shift, width) in enumerate(self.bands):
                buckets[(b, (v >> shift) & ((1 << width) - 1))].append(i)
        for bucket in buckets.values():
            for x, a in enumerate(bucket):
                for b in bucket[x + 1:]:
                    if (ints[a] ^ ints[b]).bit_count() <= self.max_distance:
                        uf.union(a, b)
        for group in uf.groups():
            ev: dict[str, tuple[FindingFacts, str, Any]] = {}
            for i in group:
                for ff, fact in by_hash[hashes[i]]:
                    ev.setdefault(ff.finding_id, (ff, fact.field, fact.value))
            members = _unique(e[0] for e in ev.values())
            plats = platforms(members)
            if len(plats) < 2:
                continue
            rep = min(hashes[i] for i in group)
            same = len(group) == 1
            yield Match(self.name, rep, rep, self.identical if same else self.near,
                        f"Profile image is {'identical' if same else 'near-identical'} "
                        f"on {len(plats)} platforms: {_labels(members)}",
                        members, list(ev.values()))


RULES: list[Rule] = [
    SharedExternalHandle(),
    SharedEmail(),
    BreachOverlap(),
    AvatarMatch(),
    SharedUrl(),
    SharedBioText(),
    SharedDisplayName(),
]
