"""Pivot extraction: pull emails, URLs, and cross-platform handles from a finding.

A "pivot" is any value inside a finding's extra_metadata or bio text that hints at
another account or identifier worth investigating. Used by:
  - correlation engine (new rules: shared_email, shared_url, shared_external_handle)
  - UI ("External accounts & links" section in finding details)
  - agent (suggested next scans)
"""
import re

# Ponytail: keep regexes permissive-but-practical; not an email RFC parser, just triage.
EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")
URL_RE = re.compile(r"https?://[^\s<>\"',;]+")

# "Twitter: foo" / "follow me on IG @bar" / "(at) baz on mastodon" — the cheap version.
SOCIAL_PATTERNS = [
    ("twitter", re.compile(r"\btwitter[:\s]+@?([A-Za-z0-9_]{1,15})\b", re.I)),
    ("x", re.compile(r"\bx\.com\/@?([A-Za-z0-9_]{1,15})\b", re.I)),
    ("instagram", re.compile(r"\binstagram[:\s]+@?([A-Za-z0-9._]{1,30})\b", re.I)),
    ("github", re.compile(r"\bgithub(?:\.com)?[:\s/]+@?([A-Za-z0-9\-]{1,39})\b", re.I)),
    ("linkedin", re.compile(r"\blinkedin\.com\/in\/([A-Za-z0-9\-]{3,100})\b", re.I)),
    ("youtube", re.compile(r"\byoutube(?:\.com)?[:\s/@]+([A-Za-z0-9._\-]{1,30})\b", re.I)),
    ("tiktok", re.compile(r"\btiktok(?:\.com)?[:\s/@]+@?([A-Za-z0-9._]{2,24})\b", re.I)),
    ("telegram", re.compile(r"\btelegram[:\s/]+@?([A-Za-z0-9_]{4,32})\b", re.I)),
    ("mastodon", re.compile(r"\bmastodon\.social\/@([A-Za-z0-9._\-]{1,30})\b", re.I)),
]

# Structured field names per finding where we KNOW pivots live.
KNOWN_EMAIL_FIELDS = ("email", "business_email", "emails", "gravatar_email")
KNOWN_URL_FIELDS = ("website", "external_url", "links", "blog", "url", "channel_url")
KNOWN_HANDLE_FIELDS = {
    "twitter": "twitter",
    "twitter_username": "twitter",
    "github": "github",
    "instagram": "instagram",
    "youtube": "youtube",
    "tiktok": "tiktok",
    "linkedin": "linkedin",
}

# Domains that map a website URL to a social platform for cross-reference.
URL_TO_PLATFORM = [
    ("twitter.com/", "twitter"),
    ("x.com/", "twitter"),
    ("instagram.com/", "instagram"),
    ("github.com/", "github"),
    ("gitlab.com/", "gitlab"),
    ("linkedin.com/in/", "linkedin"),
    ("youtube.com/", "youtube"),
    ("youtu.be/", "youtube"),
    ("tiktok.com/", "tiktok"),
    ("medium.com/", "medium"),
    ("hackerone.com/", "hackerone"),
    ("reddit.com/user/", "reddit"),
    ("gravatar.com/", "gravatar"),
]

# URL path segments that are NOT handles (generic nouns in URLs).
# When we see e.g. /channel/UC... we skip the literal "channel" but keep the next segment.
GENERIC_URL_SEGMENTS = {
    "channel", "user", "users", "in", "share", "intent", "home",
    "about", "explore", "search", "settings", "p", "reel", "reels",
    "stories", "story", "post", "posts", "status", "video", "videos",
}


def _clean_url(u: str) -> str:
    """Strip trailing punctuation that's rarely part of a real URL."""
    return u.rstrip(".,;:!?)>'\"")


def _bio_text(finding: dict) -> str:
    meta = finding.get("extra_metadata", {}) or {}
    extra = meta.get("extra", {}) or {}
    for k in ("bio", "about", "description", "intro", "profile_text"):
        v = extra.get(k) or meta.get(k)
        if isinstance(v, str) and v.strip():
            return v
    return ""


def extract_pivots(finding: dict) -> dict:
    """Returns {'emails': [...], 'urls': [...], 'handles': [(platform, handle), ...]}.

    The 'handles' list is a list of tuples so the order of detection is preserved
    (relevant for evidence strings).
    """
    meta = finding.get("extra_metadata", {}) or {}
    extra = meta.get("extra", {}) or {}
    bio = _bio_text(finding)

    emails: set[str] = set()
    urls: set[str] = set()
    handles: list[tuple[str, str]] = []

    # 1. Known structured fields
    for f in KNOWN_EMAIL_FIELDS:
        v = extra.get(f)
        if isinstance(v, str) and "@" in v:
            for e in v.split(","):
                e = e.strip().lower()
                if e:
                    emails.add(e)
        elif isinstance(v, list):
            for e in v:
                if isinstance(e, str) and "@" in e:
                    emails.add(e.strip().lower())

    for f in KNOWN_URL_FIELDS:
        v = extra.get(f)
        if isinstance(v, str):
            for piece in v.split(","):
                piece = piece.strip()
                if piece.startswith("http"):
                    urls.add(_clean_url(piece))
            urls.update(_clean_url(u) for u in URL_RE.findall(v))
        elif isinstance(v, list):
            for u in v:
                if isinstance(u, str):
                    urls.add(_clean_url(u))

    for field, plat in KNOWN_HANDLE_FIELDS.items():
        v = extra.get(field)
        if isinstance(v, str) and v.strip():
            handles.append((plat, v.strip().lstrip("@")))

    # 2. Bio text — sweep for emails, URLs, and "platform: handle" patterns
    if bio:
        for e in EMAIL_RE.findall(bio):
            emails.add(e.lower())
        for u in URL_RE.findall(bio):
            urls.add(_clean_url(u))
        for plat, pat in SOCIAL_PATTERNS:
            for m in pat.finditer(bio):
                handles.append((plat, m.group(1).strip().lstrip("@")))

    # 3. URL → platform inference (e.g., a website link to twitter.com means Twitter handle)
    inferred_handles: list[tuple[str, str]] = []
    for u in list(urls):
        for needle, plat in URL_TO_PLATFORM:
            if needle not in u:
                continue
            after = u.split(needle, 1)[1] if needle in u else ""
            parts = [p for p in after.split("/") if p]
            if not parts:
                break
            # YouTube /channel/UC... → use the channel ID, not "channel"
            if needle == "youtube.com/" and parts and parts[0].lower() == "channel" and len(parts) >= 2:
                channel_id = parts[1].split("?")[0].split("#")[0]
                if channel_id.startswith("UC"):
                    inferred_handles.append((plat, channel_id))
                break
            # YouTube /@handle → use the handle (the @user format)
            if needle == "youtube.com/" and parts and parts[0].startswith("@"):
                inferred_handles.append((plat, parts[0].lstrip("@")))
                break
            # For most platforms, the first path segment is the handle
            seg = parts[0].split("?")[0].split("#")[0].lstrip("@").strip()
            if seg and seg.lower() not in GENERIC_URL_SEGMENTS:
                inferred_handles.append((plat, seg))
            break
    handles.extend(inferred_handles)

    return {
        "emails": sorted(emails),
        "urls": sorted(urls),
        "handles": handles,
    }


def extract_pivots_batch(findings: list[dict]) -> dict:
    """Aggregate pivots across many findings.

    Returns:
      {
        'emails': {email: [finding_id, ...]},
        'urls':   {url:   [finding_id, ...]},
        'handles': {(platform, handle): [finding_id, ...]},
      }
    """
    emails: dict[str, list[str]] = {}
    urls: dict[str, list[str]] = {}
    handles: dict[tuple[str, str], list[str]] = {}
    for f in findings:
        if f.get("status") != "found":
            continue
        piv = extract_pivots(f)
        fid = f.get("id", "")
        for e in piv["emails"]:
            emails.setdefault(e, []).append(fid)
        for u in piv["urls"]:
            urls.setdefault(u, []).append(fid)
        for plat, h in piv["handles"]:
            handles.setdefault((plat, h.lower()), []).append(fid)
    return {"emails": emails, "urls": urls, "handles": handles}


if __name__ == "__main__":
    f = {
        "id": "1",
        "platform": "github",
        "extra_metadata": {
            "extra": {
                "bio": "Security researcher. Twitter: @octocat, also at octo@example.com https://octo.dev",
                "website": "https://octo.dev",
                "twitter": "octocat",
                "email": "octo@example.com",
            }
        },
    }
    out = extract_pivots(f)
    assert "octo@example.com" in out["emails"]
    assert "https://octo.dev" in out["urls"]
    assert ("twitter", "octocat") in out["handles"]
    # URL → handle inference: links in bio should be turned into handle chips
    f2 = {
        "id": "2",
        "platform": "github",
        "extra_metadata": {"extra": {
            "links": "https://twitter.com/octocat_real, https://instagram.com/octocat_ig",
        }},
    }
    out2 = extract_pivots(f2)
    handles2 = {(p, h) for p, h in out2["handles"]}
    assert ("twitter", "octocat_real") in handles2
    assert ("instagram", "octocat_ig") in handles2
    # Generic URL segments should NOT be turned into handles
    f3 = {
        "id": "3",
        "platform": "github",
        "extra_metadata": {"extra": {
            "links": "https://youtube.com/channel/UCkgdJXUOWG, https://linkedin.com/in/octocat",
        }},
    }
    out3 = extract_pivots(f3)
    handles3 = {(p, h) for p, h in out3["handles"]}
    # Should extract the YouTube channel ID (UC...) and the LinkedIn slug
    assert ("youtube", "UCkgdJXUOWG") in handles3
    assert ("linkedin", "octocat") in handles3
    # Should NOT have a "channel" handle
    assert ("youtube", "channel") not in handles3
    print(out)
    print("extract OK")
