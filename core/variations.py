"""Generate username variations for broader OSINT coverage.

Approach: deterministic transformations applied to the original username. The LLM
just picks WHICH transformations to apply (which combination of edits a real
person would naturally make on social media). Code does the actual edits. This
is more reliable than asking the LLM to generate variations directly (which it
does poorly, often hallucinating example outputs).

Social-media context: people rarely register the same exact string across
platforms. They decorate, truncate, prefix and suffix with platform conventions:
- separators in the middle: `max_cell`, `max-cell`, `max.cell`
- decorative edges: `_max_`, `.max`, `max_`
- short prefixes: `the_`, `im_`, `its_`, `real_`, `iam_`
- short suffixes: `_official`, `_real`, `_yt`, `_hq`, `_tv`
- numbers / years: `max1`, `max123`, `max2024`
- truncation: `max` from `maximumcell`
- leet: `m4x1mumc3ll`
- word re-ordering: `cell_max` from `max_cell`
"""
import json
import re
from typing import Optional

from agent.llm import LLMClient, GeminiLLM


def _to_pascal(s: str) -> str:
    """maximum_cell -> MaximumCell; james.smith -> JamesSmith; j-smith -> JSmith"""
    parts = re.split(r"[._\-\s]+", s)
    return "".join(p[:1].upper() + p[1:].lower() for p in parts if p)


def _to_title(s: str, sep: str) -> str:
    """maximum_cell + '_' -> Maximum_Cell; james.smith + '_' -> James_Smith"""
    s = re.sub(r"[._-]+", sep, s)
    parts = s.split(sep)
    return sep.join(p[:1].upper() + p[1:].lower() for p in parts if p)


def _split_words(s: str) -> list[str]:
    """Split a handle into its constituent words.

    Handles 3 input shapes:
      - "max_cell"   -> ["max", "cell"]          (already separated)
      - "MaximumCell"-> ["Maximum", "Cell"]      (camelCase / PascalCase)
      - "maximumcell"-> ["max", "imumcell"]      (no separators — try common
                                                   English word splits, fall
                                                   back to a 3/3 heuristic)
    Returns at least one element; never the empty list.
    """
    if not s:
        return [""]
    # 1. separator split
    if re.search(r"[._\-\s]", s):
        parts = [p for p in re.split(r"[._\-\s]+", s) if p]
        if parts:
            return parts
    # 2. camelCase / PascalCase split (any uppercase letter not at index 0
    #    that is preceded by a lowercase letter is a word boundary).
    parts = re.sub(r"([a-z])([A-Z])", r"\1_\2", s).split("_")
    if len(parts) > 1:
        return [p for p in parts if p]
    # 3. all-lowercase, no separators — try a small dictionary of common
    #    English fragments people use in handles. First match wins (greedy
    #    from the left). If nothing matches, fall back to a 3-char split.
    fragments = [
        "max", "cel", "the", "real", "dev", "pro", "lab", "art", "bot",
        "guy", "gal", "man", "boy", "kid", "fan", "fox", "cat", "dog",
        "ace", "neo", "zen", "rex", "sky", "sun", "sea", "war", "red",
        "big", "old", "new", "top", "iam", "its", "mr", "ms", "im",
    ]
    lower = s.lower()
    for frag in fragments:
        idx = lower.find(frag)
        if idx == 0 and len(frag) < len(lower):
            head, tail = s[:len(frag)], s[len(frag):]
            if tail:
                return [head, tail]
    # 4. fallback: 3/3 split (e.g. "maximumcell" -> ["max", "imumcell"])
    if len(s) >= 6:
        return [s[:3], s[3:]]
    return [s]


def _join_words(parts: list[str], sep: str) -> str:
    return sep.join(parts)


def _first_word(s: str) -> str:
    return _split_words(s)[0]


def _last_word(s: str) -> str:
    parts = _split_words(s)
    return parts[-1] if parts else s


def _swap_words(s: str) -> str:
    parts = _split_words(s)
    if len(parts) < 2:
        return s
    out = list(parts)
    out[0], out[-1] = out[-1], out[0]
    return "".join(out) if all("_" not in p and "." not in p and "-" not in p for p in out) else _join_words(out, "_")


def _split_at(s: str, pos: int) -> str:
    """Insert an underscore at the given position (clamped to [1, len-1])."""
    pos = max(1, min(pos, len(s) - 1))
    return s[:pos] + "_" + s[pos:]


def _truncate(s: str, n: int) -> str:
    return s[:n] if len(s) > n else s


def _with_number(s: str, n: str) -> str:
    return f"{s}{n}"


# Each transformation: name -> (description, function).
# The descriptions show what the function does to "Maximumcell" so the LLM
# can pick intelligently without having to infer from the function body.
TRANSFORMATIONS: dict[str, tuple[str, callable]] = {
    # ---- Case + separator swaps (the classics) ----
    "PascalCase":    ("MaximumCell",     lambda s: _to_pascal(s)),
    "lowercase":     ("maximumcell",     lambda s: re.sub(r"[._-]", "", s).lower()),
    "UPPERCASE":     ("MAXIMUMCELL",     lambda s: re.sub(r"[._-]", "", s).upper()),
    "Title_Case":    ("Maximum_Cell",    lambda s: _to_title(s, "_")),
    "UPPER_Snake":   ("MAXIMUM_CELL",    lambda s: _to_title(s, "_").upper()),
    "dot_sep":       ("maximum.cell",    lambda s: re.sub(r"[._-]", ".", s)),
    "hyphen_sep":    ("maximum-cell",    lambda s: re.sub(r"[._-]", "-", s)),
    "Title_dot":     ("Maximum.Cell",    lambda s: _to_pascal(s).replace("_", ".")),
    "Title_hyphen":  ("Maximum-Cell",    lambda s: _to_pascal(s).replace("_", "-")),
    "UPPER_dot":     ("MAXIMUM.CELL",    lambda s: re.sub(r"[._-]", ".", s).upper()),
    "UPPER_hyphen":  ("MAXIMUM-CELL",    lambda s: re.sub(r"[._-]", "-", s).upper()),

    # ---- Decorative edges (leading/trailing punctuation) ----
    "prefix_underscore": ("_maximumcell",  lambda s: f"_{s}"),
    "suffix_underscore": ("maximumcell_",  lambda s: f"{s}_"),
    "prefix_period":     (".maximumcell",  lambda s: f".{s}"),
    "suffix_period":     ("maximumcell.",  lambda s: f"{s}."),

    # ---- Common short prefixes (used as branding/identity marker) ----
    "prefix_the":   ("themaximumcell",  lambda s: f"the{s}"),
    "prefix_im":    ("immaximumcell",   lambda s: f"im{s}"),
    "prefix_its":   ("itsmaximumcell",  lambda s: f"its{s}"),
    "prefix_iam":   ("iammaximumcell",  lambda s: f"iam{s}"),
    "prefix_real":  ("realmaximumcell", lambda s: f"real{s}"),
    "prefix_mr":    ("mrmaximumcell",   lambda s: f"mr{s}"),

    # ---- Common short suffixes (channel / role markers) ----
    "suffix_official": ("maximumcellofficial", lambda s: f"{s}official"),
    "suffix_real":     ("maximumcellreal",     lambda s: f"{s}real"),
    "suffix_yt":       ("maximumcellyt",       lambda s: f"{s}yt"),
    "suffix_tv":       ("maximumcelltv",       lambda s: f"{s}tv"),
    "suffix_hq":       ("maximumcellhq",       lambda s: f"{s}hq"),
    "suffix_pro":      ("maximumcellpro",      lambda s: f"{s}pro"),
    "suffix_x":        ("maximumcellx",        lambda s: f"{s}x"),

    # ---- Numeric / year suffixes (very common when a handle is taken) ----
    "with_1":           ("maximumcell1",    lambda s: _with_number(s, "1")),
    "with_2":           ("maximumcell2",    lambda s: _with_number(s, "2")),
    "with_3":           ("maximumcell3",    lambda s: _with_number(s, "3")),
    "with_99":          ("maximumcell99",   lambda s: _with_number(s, "99")),
    "with_123":         ("maximumcell123",  lambda s: _with_number(s, "123")),
    "with_year_2024":   ("maximumcell2024", lambda s: _with_number(s, "2024")),
    "with_year_2023":   ("maximumcell2023", lambda s: _with_number(s, "2023")),
    "with_year_2020":   ("maximumcell2020", lambda s: _with_number(s, "2020")),

    # ---- Truncation (handles longer than ~10 chars often get shortened) ----
    "truncate_8":  ("maximumc",  lambda s: _truncate(s, 8)),
    "truncate_10": ("maximumcel", lambda s: _truncate(s, 10)),
    "truncate_6":  ("maximu",    lambda s: _truncate(s, 6)),

    # ---- Word-level edits (use the smart word splitter) ----
    "first_word":       ("max",         lambda s: _first_word(s).lower()),
    "last_word":        ("cell",        lambda s: _last_word(s).lower()),
    "first_word_title": ("Max",         lambda s: _first_word(s)[:1].upper() + _first_word(s)[1:].lower()),
    "swap_words":       ("cellmaximum", lambda s: _swap_words(s).lower()),
    "first_then_under": ("max_imumcell", lambda s: _split_at(_first_word(s), len(_first_word(s))) + _last_word(s) if len(_first_word(s)) >= 3 else _split_at(s, 3)),
    "split_at_3_under": ("max_imumcell", lambda s: _split_at(s, 3) if len(s) > 4 else s),
    "split_at_4_under": ("maxi_mumcell", lambda s: _split_at(s, 4) if len(s) > 5 else s),
    "split_at_5_under": ("maxim_umcell", lambda s: _split_at(s, 5) if len(s) > 6 else s),
    "split_at_3_hyphen": ("max-imumcell", lambda s: s[:3] + "-" + s[3:] if len(s) > 4 else s),
    "split_at_4_hyphen": ("maxi-mumcell", lambda s: s[:4] + "-" + s[4:] if len(s) > 5 else s),
    "split_at_3_dot":    ("max.imumcell", lambda s: s[:3] + "." + s[3:] if len(s) > 4 else s),
    "split_at_4_dot":    ("maxi.mumcell", lambda s: s[:4] + "." + s[4:] if len(s) > 5 else s),
}


PICK_PROMPT = """You are an OSINT assistant. Given a username "{username}", pick exactly {count} transformation names from the list that a real person would most likely use to register the same identity on other social-media platforms.

Think about how people ACTUALLY use handles in the wild — they don't just change case or separators, they decorate:
- Add short prefixes: "the_", "im_", "its_", "real_", "iam_", "mr_"
- Add short suffixes: "_official", "_real", "_yt", "_hq", "_tv", "_pro"
- Add decorative edges: "_name", "name_", ".name"
- Add a number when the bare name is taken: "name1", "name99", "name123", "name2024"
- Truncate a long name to its first 6-10 chars: "maximu" from "maximumcell"
- Split a single word at a likely boundary with a separator: "max_cell" from "maximumcell"
- Pick just one word: "max" or "cell" instead of the full "maxcell"
- Reorder the words: "cellmax" from "maxcell"
- Mixed case + separator combos

Available transformations (the example shown is the result applied to "Maximumcell"):
{available}

Rules:
- ALWAYS return exactly {count} entries — repeat patterns if you must
- Mix categories: don't return 5 of the same kind
- Bias toward patterns people actually use on Instagram, Twitter/X, TikTok, GitHub, YouTube
- For long single-word handles, include truncation + smart-split + with_year_*
- Output ONLY a JSON array of transformation names, no prose, no markdown

JSON:"""


def _parse_json_array(text: str) -> list:
    m = re.search(r"\[.*?\]", text, re.DOTALL)
    if not m:
        return []
    try:
        v = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    return v if isinstance(v, list) else []


def _apply_and_validate(
    picks: list,
    original: str,
    count: int,
    exclude: Optional[set[str]] = None,
) -> list[str]:
    """Apply each picked transformation to `original`, validate, and dedup.

    - case-sensitive dedup: "octocat" and "Octocat" are distinct usernames
      on most platforms
    - `exclude`: variations the caller has already seen (e.g. from a prior
      "Get more" rerun) — we never re-emit any of these, even if the LLM
      picks the same transformation again. This is what makes a "load 5
      more" button actually return 5 *new* variations.
    """
    seen = {original}
    if exclude:
        # case-sensitive: matches the rest of this function
        seen.update(exclude)
    out: list[str] = []
    for name in picks:
        if not isinstance(name, str):
            continue
        name = name.strip()
        if name not in TRANSFORMATIONS:
            continue
        _, fn = TRANSFORMATIONS[name]
        try:
            result = fn(original)
        except Exception:
            continue
        if not isinstance(result, str):
            continue
        result = result.strip()
        if not result or len(result) < 3 or len(result) > 30:
            continue
        if not re.match(r"^[a-zA-Z0-9._-]+$", result):
            continue
        if result in seen:
            continue
        seen.add(result)
        out.append(result)
        if len(out) >= count:
            break
    return out


def generate_variations(
    username: str,
    count: int = 5,
    llm: Optional[LLMClient] = None,
    exclude: Optional[set[str] | list[str]] = None,
    max_attempts: int = 3,
) -> list[str]:
    """Return up to `count` close variations of `username`. LLM picks, code applies.

    `exclude` — variations the caller has already seen; we won't return them
    again. Used by the "Get 5 more" button in the UI so each rerun returns
    *fresh* variations rather than the same ones. If the LLM can't come up
    with enough new ones in one pass, we'll ask it again (up to `max_attempts`)
    with the still-missing slots filled in, so the caller always gets the
    requested count as long as the transformation space has enough variety.
    """
    llm = llm or GeminiLLM()
    exclude_set: set[str] = set(exclude or [])
    available_list = "\n".join(f"- {n}: {desc}" for n, (desc, _) in TRANSFORMATIONS.items())

    all_out: list[str] = []
    remaining = count
    for _ in range(max_attempts):
        if remaining <= 0:
            break
        prompt = PICK_PROMPT.format(username=username, count=remaining, available=available_list)
        if exclude_set:
            prompt += (
                "\n\nIMPORTANT: The user has already seen these variations and "
                "wants NEW ones. Do NOT pick transformations that produce any "
                "of these (the code will filter them out, but wasting picks "
                "on them means fewer new results): "
                + ", ".join(sorted(exclude_set))
            )
        try:
            response = llm.send(
                [{"role": "user", "parts": [{"text": prompt}]}],
                "Output only valid JSON. No markdown, no prose.",
                [],
            )
        except Exception:
            break
        text = response.get("text", "")
        picks = _parse_json_array(text)
        new = _apply_and_validate(picks, username, remaining, exclude=exclude_set)
        if not new:
            # LLM ran out of new ideas — stop early
            break
        all_out.extend(new)
        exclude_set.update(new)
        remaining -= len(new)
    return all_out


# ---------- email variations ----------

# Most common providers a real person might use the same handle on.
# Order matters: we try the original domain first, then fall back to these.
COMMON_EMAIL_PROVIDERS = [
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "protonmail.com",
]


def _split_email(email: str) -> tuple[str, str] | None:
    """Return (local, domain) or None if invalid."""
    if "@" not in email:
        return None
    local, domain = email.rsplit("@", 1)
    local, domain = local.strip(), domain.strip().lower()
    if not local or not domain or "." not in domain:
        return None
    return local, domain


def generate_email_variations(
    email: str,
    count: int = 5,
    llm: Optional[LLMClient] = None,
    exclude: Optional[set[str] | list[str]] = None,
) -> list[str]:
    """Generate close email variations: same handle on common providers + local-part permutations.

    Approach: LLM picks local-part transformations; code applies them across the
    original domain + 2-3 most common providers. Cross-product, capped at `count`.

    `exclude` — full email strings the caller has already seen; we won't
    re-emit any of them. Used by the "Get 5 more" rerun button.
    """
    parts = _split_email(email)
    if not parts:
        return []
    local, original_domain = parts
    llm = llm or GeminiLLM()
    exclude_set: set[str] = {e.lower() for e in (exclude or [])}

    # 1. LLM picks local-part transformations
    available_list = "\n".join(f"- {n}: {desc}" for n, (desc, _) in TRANSFORMATIONS.items())
    prompt = PICK_PROMPT.format(username=local, count=count, available=available_list)
    try:
        response = llm.send(
            [{"role": "user", "parts": [{"text": prompt}]}],
            "Output only valid JSON. No markdown, no prose.",
            [],
        )
    except Exception:
        return []
    picks = _parse_json_array(response.get("text", ""))
    # local_variations always includes the original local
    local_variations = [local] + _apply_and_validate(picks, local, count)

    # 2. providers: original first, then 2 most common (dedup, preserve order)
    providers = list(dict.fromkeys([original_domain] + COMMON_EMAIL_PROVIDERS[:2]))

    # 3. cross product, dedup, cap
    out: list[str] = []
    seen = {email.lower()} | exclude_set
    for lp in local_variations:
        for p in providers:
            if lp == local and p == original_domain:
                continue  # skip the input itself
            candidate = f"{lp}@{p}"
            if candidate.lower() in seen:
                continue
            seen.add(candidate.lower())
            out.append(candidate)
            if len(out) >= count:
                return out
    return out


if __name__ == "__main__":
    import sys
    # Test 1: pure transformation correctness (no LLM)
    print("=== pure transforms ===")
    test_cases = [
        ("maximum_cell", {
            "PascalCase": "MaximumCell",
            "lowercase": "maximumcell",
            "UPPERCASE": "MAXIMUMCELL",
            "Title_Case": "Maximum_Cell",
            "UPPER_Snake": "MAXIMUM_CELL",
            "dot_sep": "maximum.cell",
            "hyphen_sep": "maximum-cell",
            "first_word": "maximum",     # separator split, not smart split
            "last_word": "cell",
            "prefix_underscore": "_maximum_cell",
            "suffix_official": "maximum_cellofficial",
            "with_1": "maximum_cell1",
            "with_year_2024": "maximum_cell2024",
        }),
        ("james.smith", {
            "PascalCase": "JamesSmith",
            "lowercase": "jamessmith",
            "UPPERCASE": "JAMESSMITH",
            "dot_sep": "james.smith",
            "hyphen_sep": "james-smith",
            "Title_Case": "James_Smith",
            "first_word": "james",
            "last_word": "smith",
            "swap_words": "smithjames",
        }),
        ("Maximumcell", {
            # single word, no separators, capitalized
            "lowercase": "maximumcell",
            "UPPERCASE": "MAXIMUMCELL",
            "first_word": "max",            # smart split picks "max"
            "split_at_3_under": "Max_imumcell",     # preserves case
            "split_at_4_under": "Maxi_mumcell",
            "split_at_3_hyphen": "Max-imumcell",
            "split_at_4_dot": "Maxi.mumcell",
            "truncate_8": "Maximumc",                # 8 chars
            "truncate_6": "Maximu",                  # 6 chars
            "with_1": "Maximumcell1",
            "with_year_2024": "Maximumcell2024",
            "prefix_the": "theMaximumcell",
            "suffix_official": "Maximumcellofficial",
            "prefix_underscore": "_Maximumcell",
            "suffix_underscore": "Maximumcell_",
        }),
    ]
    failures = []
    for username, expected in test_cases:
        for tname, want in expected.items():
            got = TRANSFORMATIONS[tname][1](username)
            if got != want:
                failures.append(f"{tname}({username!r}): got {got!r}, want {want!r}")
    if failures:
        for f in failures:
            print(f"  FAIL: {f}")
        raise SystemExit(1)
    print(f"  all {sum(len(e) for e in test_cases)} transforms correct")

    # Test 2: apply_and_validate logic (synthetic picks, no LLM)
    print("\n=== apply + validate ===")
    from core.variations import _apply_and_validate
    out = _apply_and_validate(
        ["lowercase", "PascalCase", "dot_sep", "hyphen_sep", "Title_Case"],
        "maximum_cell", 5,
    )
    assert "MaximumCell" in out
    assert "maximumcell" in out
    assert "maximum.cell" in out
    assert "maximum-cell" in out
    assert "Maximum_Cell" in out
    assert "maximum_cell" not in out
    assert len(out) == 5
    print(f"  synthetic picks -> {out}")

    # Test 3: LLM integration (skipped if no key or LLM flakes)
    print("\n=== LLM integration ===")
    for u in ["Maximumcell", "maximum_cell", "james_smith"]:
        try:
            vs = generate_variations(u, count=5)
        except Exception as e:
            print(f"  {u}: SKIP (LLM error: {e})")
            continue
        if not vs:
            print(f"  {u}: 0 variations (LLM returned empty, possible rate limit)")
            continue
        for v in vs:
            assert v != u, f"exact duplicate of original: {v}"
            assert re.match(r"^[a-zA-Z0-9._-]+$", v), f"invalid: {v!r}"
            assert 3 <= len(v) <= 30, f"bad length: {v!r}"
        print(f"  {u} ({len(vs)}): {vs}")

    # Test 4: email variations (LLM)
    print("\n=== email variations ===")
    for e in ["james.smith@gmail.com", "maximumcell@protonmail.com"]:
        try:
            vs = generate_email_variations(e, count=5)
        except Exception as e2:
            print(f"  {e}: SKIP (LLM error: {e2})")
            continue
        if not vs:
            print(f"  {e}: 0 variations")
            continue
        for v in vs:
            assert "@" in v, f"not an email: {v}"
            assert v.lower() != e.lower(), f"exact duplicate: {v}"
        print(f"  {e} ({len(vs)}): {vs}")

    print("\nvariations OK")
