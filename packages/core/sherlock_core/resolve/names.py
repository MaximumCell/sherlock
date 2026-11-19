"""Person-name comparison. Pure, stdlib only, deterministic.

`match_name(query, candidate)` answers "could these two strings name the same person"
with a score in 0..1 and the reason, tolerant of:

    order            "Berners-Lee, Tim"  ==  "Tim Berners-Lee"
    case, diacritics "JOSÉ GARCÍA"       ==  "Jose Garcia"
    hyphen variants  "Berners‐Lee"       ==  "Berners-Lee" == "Berners Lee"
    middle names     "Tim John Berners-Lee", "Tim J. Berners-Lee"
    initials         "T. Berners-Lee"                      (weaker)
    short forms      "Tim" / "Timothy"                     (prefix, weaker)
    titles           "Sir Tim Berners-Lee", "Dr", "PhD", "Jr"

A candidate that shares only ONE name token with a multi-token query ("Tim") is
reported as `single-token` with a low score: common given names match thousands of people.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

_TITLES = frozenset({
    "sir", "dame", "dr", "prof", "professor", "mr", "mrs", "ms", "miss", "mx", "lord", "lady", "rev",
    "jr", "sr", "ii", "iii", "iv", "phd", "md", "msc", "bsc", "mba", "esq", "obe", "mbe", "cbe", "kbe",
    "om", "frs", "freng", "ing", "eng",
})
_SPLIT = re.compile(r"[^a-z0-9]+")
_SPECIAL = str.maketrans({"ß": "ss", "ø": "o", "đ": "d", "ł": "l", "æ": "ae", "œ": "oe", "ı": "i", "þ": "th"})

EXACT, MIDDLE, SHORT_FORM, INITIALS, SINGLE_TOKEN, NONE = (
    "exact", "middle-name", "short-form", "initials", "single-token", "none")


@dataclass(frozen=True)
class NameMatch:
    score: float   # 0..1
    kind: str      # exact | middle-name | short-form | initials | single-token | none

    def __bool__(self) -> bool:
        return self.score > 0


def fold(text: str) -> str:
    """Lower-case ASCII skeleton of a string (diacritics removed)."""
    s = unicodedata.normalize("NFKD", str(text or "").casefold().translate(_SPECIAL))
    return "".join(ch for ch in s if not unicodedata.combining(ch))


def name_tokens(name: str) -> list[str]:
    """Comparable tokens of a personal name, order-insensitive use intended.

    'Berners-Lee, Sir Tim J.' -> ['tim', 'j', 'berners', 'lee'].
    """
    s = str(name or "")
    s = re.sub(r"\([^)]*\)", " ", s)                      # "Tim (TimBL) Berners-Lee"
    if s.count(",") == 1:                                 # "Family, Given"
        family, given = s.split(",")
        if given.strip() and fold(given).strip(" .") not in _TITLES:
            s = f"{given} {family}"
    tokens = [t for t in _SPLIT.split(fold(s)) if t and not t.isdigit()]
    kept = [t for t in tokens if t not in _TITLES]
    return kept or tokens


def _pair(a: str, b: str) -> float:
    """How well two single tokens agree."""
    if a == b:
        return 1.0
    short, long_ = sorted((a, b), key=len)
    if len(short) == 1:
        return 0.6 if long_.startswith(short) else 0.0
    if len(short) >= 3 and long_.startswith(short):
        return 0.8                                         # Tim / Timothy, Alex / Alexander
    return 0.0


def match_name(query: str, candidate: str) -> NameMatch:
    q, c = name_tokens(query), name_tokens(candidate)
    if not q or not c:
        return NameMatch(0.0, NONE)
    needles, hay = (q, list(c)) if len(q) <= len(c) else (c, list(q))
    scores: list[float] = []
    for n in sorted(needles, key=len, reverse=True):       # match full tokens before initials
        best_i, best = -1, 0.0
        for i, h in enumerate(hay):
            s = _pair(n, h)
            if s > best:
                best_i, best = i, s
        if best_i < 0:
            return NameMatch(0.0, NONE)
        hay.pop(best_i)
        scores.append(best)
    full = sum(1 for s in scores if s == 1.0)
    if full == 0:
        return NameMatch(0.0, NONE)                         # initials / prefixes alone prove nothing
    extra_full = sum(1 for h in hay if len(h) > 1)
    score = (sum(scores) / len(scores)) * (0.93 ** extra_full) * (0.98 ** (len(hay) - extra_full))
    if len(needles) == 1 and max(len(q), len(c)) > 1:
        return NameMatch(round(min(score, 1.0) * 0.25, 3), SINGLE_TOKEN)
    if min(scores) == 1.0:
        kind = EXACT if not hay else MIDDLE
    elif min(scores) >= 0.8:
        kind = SHORT_FORM
    else:
        kind = INITIALS
    return NameMatch(round(score, 3), kind)


def best_match(query: str, names: list[str]) -> tuple[NameMatch, str]:
    """The best-matching name out of several spellings (ties: first wins)."""
    best, best_name = NameMatch(0.0, NONE), ""
    for n in names:
        m = match_name(query, n)
        if m.score > best.score:
            best, best_name = m, n
    return best, best_name


def text_mentions_name(query: str, text: str) -> bool:
    """True when every token of `query` appears as a whole word in `text` (any order)."""
    words = set(_SPLIT.split(fold(text)))
    tokens = name_tokens(query)
    return bool(tokens) and all(t in words for t in tokens)


def describe(match: NameMatch) -> str:
    return {
        EXACT: "matches exactly",
        MIDDLE: "matches with an extra middle name or initial",
        SHORT_FORM: "matches a short form of the given name",
        INITIALS: "matches on initials plus family name",
        SINGLE_TOKEN: "shares only one part of the name",
    }.get(match.kind, "does not match")
