"""Deterministic correlation engine. Pure functions over normalized findings.

Rules (plan Section 6 Phase 3 + v2 pivots):
  username_reuse          same username string on N+ platforms
  shared_bio_text         same/highly-similar bio text on two accounts
  shared_email_platform   email and username both resolve on same platform
  breach_overlap          same identifier in same breach via two collectors
  shared_display_name     same display name on 2+ platforms (likely same person)
  shared_email            same email address found in extras on 2+ platforms
  shared_url              same website URL in extras on 2+ platforms
  shared_external_handle  bio/extra of one platform references a handle that
                          resolves on another platform (e.g., GitHub lists Twitter @foo,
                          Twitter finding exists for @foo) — strongest cross-link signal

Every correlation: {case_id, id, type, entities_involved,
confidence, evidence, priority, reviewed}. priority = confidence * platform_reach.
"""
import difflib
import uuid

from collections import defaultdict

from sherlock_core.extract import extract_pivots_batch

BIO_FIELDS = ("bio", "about", "description", "profile_text", "intro")
DISPLAY_NAME_FIELDS = ("display_name", "fullname", "name")

MIN_USERNAME_REUSE = 2
BIO_EXACT_CONF = 0.8
BIO_FUZZY_CONF = 0.7   # ratio >= 0.9
BIO_LOOSE_CONF = 0.6   # ratio >= 0.8
EMAIL_PLATFORM_CONF = 0.75
BREACH_OVERLAP_CONF = 0.9
DISPLAY_NAME_CONF = 0.85
SHARED_EMAIL_CONF = 0.9
SHARED_URL_CONF = 0.8
SHARED_EXTERNAL_HANDLE_CONF = 0.95  # direct cross-reference, near-certain


def _new_corr(case_id, ctype, entities, confidence, evidence):
    return {
        "case_id": case_id,
        "id": str(uuid.uuid4()),
        "type": ctype,
        "entities_involved": entities,
        "confidence": round(confidence, 2),
        "evidence": evidence,
        "priority": 0.0,
        "reviewed": False,
    }


def _reach(corr, findings_by_entity):
    ctype = corr["type"]
    if ctype == "username_reuse":
        return len(corr["entities_involved"])
    if ctype == "breach_overlap":
        return len({e["extra_metadata"].get("breach_name")
                    for e in corr["_breaches"]})
    if ctype == "shared_email":
        return len(corr["entities_involved"])
    if ctype == "shared_url":
        return len(corr["entities_involved"])
    if ctype == "shared_external_handle":
        return len(corr["entities_involved"])
    return 1  # ponytail: pair rules get reach 1, low flat priority


def correlate(case_id: str, findings: list[dict]) -> list[dict]:
    found = [f for f in findings if f["status"] == "found"]
    out = []

    # rule 1: username reuse
    by_user = defaultdict(list)
    for f in found:
        if f["identifier_type"] == "username":
            by_user[f["identifier_value"]].append(f)
    for user, fs in by_user.items():
        if len(fs) >= MIN_USERNAME_REUSE:
            platforms = sorted({f["platform"] for f in fs})
            conf = min(0.5 + 0.1 * (len(platforms) - MIN_USERNAME_REUSE), 0.95)
            c = _new_corr(
                case_id, "username_reuse",
                [f"{p}:{user}" for p in platforms], conf,
                [f"Username '{user}' found on {len(platforms)} platforms: {', '.join(platforms)}"],
            )
            out.append(c)

    # rule 2: shared bio text
    bios = [(f, _bio(f)) for f in found if _bio(f)]
    for i in range(len(bios)):
        for j in range(i + 1, len(bios)):
            fi, bi = bios[i]
            fj, bj = bios[j]
            if bi == bj:
                conf, desc = BIO_EXACT_CONF, "identical"
            else:
                ratio = difflib.SequenceMatcher(None, bi, bj).ratio()
                if ratio < 0.8:
                    continue
                conf, desc = (BIO_FUZZY_CONF if ratio >= 0.9 else BIO_LOOSE_CONF), f"similar ({ratio:.2f})"
            out.append(_new_corr(
                case_id, "shared_bio_text",
                [f"{fi['platform']}:{fi['identifier_value']}", f"{fj['platform']}:{fj['identifier_value']}"],
                conf,
                [f"Profile text {desc} on {fi['platform']} and {fj['platform']}"],
            ))

    # rule 3: email + username on same platform
    emails = {f["platform"]: f for f in found if f["identifier_type"] == "email"}
    for f in found:
        if f["identifier_type"] == "username" and f["platform"] in emails:
            e = emails[f["platform"]]
            out.append(_new_corr(
                case_id, "shared_email_platform",
                [f"{f['platform']}:{f['identifier_value']}", f"{e['platform']}:{e['identifier_value']}"],
                EMAIL_PLATFORM_CONF,
                [f"Both username '{f['identifier_value']}' and email '{e['identifier_value']}' resolve on {f['platform']}"],
            ))

    # rule 5: shared display name (display_name / fullname / name in extra) across platforms
    by_display: dict[str, list[Finding]] = defaultdict(list)
    for f in found:
        for k in DISPLAY_NAME_FIELDS:
            v = (f.get("extra_metadata") or {}).get("extra", {}).get(k)
            if isinstance(v, str) and 2 <= len(v) <= 60:
                by_display[v].append(f)
                break
    for name, fs in by_display.items():
        platforms = sorted({f["platform"] for f in fs})
        if len(platforms) < 2:
            continue
        # confidence scales with platform count, capped at 0.95
        conf = min(0.7 + 0.1 * (len(platforms) - 2), 0.95)
        out.append(_new_corr(
            case_id, "shared_display_name",
            [f"{f['platform']}:{f['identifier_value']}" for f in fs],
            conf,
            [f"Display name '{name}' found on {len(platforms)} platforms: {', '.join(platforms)}"],
        ))

    # rule 4: breach overlap
    breaches = defaultdict(list)
    for f in found:
        if f["platform"] == "breach" or f["platform"] == "hudson-rock":
            name = f["extra_metadata"].get("breach_name") or f["extra_metadata"].get("stealer_family")
            if name:
                breaches[name].append(f)
    for name, fs in breaches.items():
        if len(fs) >= 2:
            c = _new_corr(
                case_id, "breach_overlap",
                [f"{f['source_tool']}:{f['identifier_value']}" for f in fs],
                BREACH_OVERLAP_CONF,
                [f"'{name}' exposure confirmed by {len(fs)} collectors: {', '.join(sorted({f['source_tool'] for f in fs}))}"],
            )
            c["_breaches"] = fs
            out.append(c)

    # rules 6-8: pivot-based correlations (extract emails, urls, handles from each finding)
    pivots = extract_pivots_batch(found)
    fid_to_finding = {f.get("id", ""): f for f in found}

    # rule 6: shared email — same email address on 2+ platforms
    for email, fids in pivots["emails"].items():
        if len(fids) < 2:
            continue
        fs = [fid_to_finding[fid] for fid in fids if fid in fid_to_finding]
        platforms = sorted({f["platform"] for f in fs})
        if len(platforms) < 2:
            continue
        out.append(_new_corr(
            case_id, "shared_email",
            [f"{f['platform']}:{f['identifier_value']}" for f in fs],
            SHARED_EMAIL_CONF,
            [f"Email '{email}' appears on {len(platforms)} platforms: {', '.join(platforms)}"],
        ))

    # rule 7: shared url — same website URL in 2+ places
    for url, fids in pivots["urls"].items():
        if len(fids) < 2:
            continue
        fs = [fid_to_finding[fid] for fid in fids if fid in fid_to_finding]
        platforms = sorted({f["platform"] for f in fs})
        if len(platforms) < 2:
            continue
        out.append(_new_corr(
            case_id, "shared_url",
            [f"{f['platform']}:{f['identifier_value']}" for f in fs],
            SHARED_URL_CONF,
            [f"Website '{url}' appears on {len(platforms)} platforms: {', '.join(platforms)}"],
        ))

    # rule 8: shared external handle — one platform's bio/extra references a handle
    # that resolves as a real finding on another platform. Strongest cross-link signal.
    # First, build the lookup: (platform, handle) -> finding with that exact identifier
    real_handles: dict[tuple[str, str], dict] = {}
    for f in found:
        if f["identifier_type"] != "username":
            continue
        key = (f["platform"].lower(), f["identifier_value"].lower())
        real_handles.setdefault(key, f)
    for (plat, handle), source_fids in pivots["handles"].items():
        target = real_handles.get((plat, handle.lower()))
        if not target:
            continue
        # find every finding that mentioned this handle (in its extras/bio)
        source_findings = [fid_to_finding[fid] for fid in source_fids if fid in fid_to_finding]
        # skip if the only mention is the target itself
        source_findings = [f for f in source_findings if f.get("id") != target.get("id")]
        if not source_findings:
            continue
        ref_platforms = sorted({f["platform"] for f in source_findings})
        out.append(_new_corr(
            case_id, "shared_external_handle",
            [f"{target['platform']}:{target['identifier_value']}"] +
            [f"{f['platform']}:{f['identifier_value']}" for f in source_findings],
            SHARED_EXTERNAL_HANDLE_CONF,
            [f"'{target['platform']}:{target['identifier_value']}' is referenced as @{handle} "
             f"in {len(source_findings)} other profile(s): {', '.join(ref_platforms)}"],
        ))

    for c in out:
        c["priority"] = round(c["confidence"] * _reach(c, {}), 2)
        c.pop("_breaches", None)
    out.sort(key=lambda c: -c["priority"])
    return out


def _bio(f: dict) -> str:
    meta = f.get("extra_metadata", {})
    for k in BIO_FIELDS:
        v = meta.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    if "extra" in meta:
        for v in meta["extra"].values():
            if isinstance(v, str) and len(v) > 10 and " " in v:
                return v.strip()
    return ""


if __name__ == "__main__":
    def mk(it, iv, plat, bio="", extra=None):
        return {
            "id": f"f-{it}-{iv}-{plat}",
            "case_id": "c1", "identifier_type": it, "identifier_value": iv,
            "source_tool": "user-scanner", "platform": plat, "status": "found",
            "extra_metadata": {"bio": bio, "breach_name": None, "stealer_family": None,
                               "extra": extra or {}, "media": {}}, "collected_at": "",
        }
    f = [
        mk("username", "alice", "github", "Security researcher, bug bounty"),
        mk("username", "alice", "twitter", "Security researcher, bug bounty"),
        mk("username", "alice", "linkedin"),
        mk("username", "bob", "twitter", "Hello world I am a bot"),
        mk("username", "bob", "instagram", "Hello world I am a bot"),
        mk("email", "alice@x.com", "github"),
        # shared email: same email in GitHub extras and Instagram business_email
        mk("username", "carol", "github", "Engineer at Acme",
           extra={"email": "carol@acme.io"}),
        mk("username", "carol", "instagram", "Engineer at Acme",
           extra={"business_email": "carol@acme.io"}),
        # shared url
        mk("username", "dave", "github", "Personal site below",
           extra={"website": "https://dave.dev"}),
        mk("username", "dave", "twitter", "Personal site below",
           extra={"links": "https://dave.dev, https://other.com"}),
        # shared external handle: GitHub lists twitter: alice_real, Twitter has alice_real
        mk("username", "edith", "github", "Engineer",
           extra={"twitter": "edith_real"}),
        mk("username", "edith_real", "twitter", "Designer"),
    ]
    breach = [mk("email", "alice@x.com", "breach"),
              {**mk("email", "alice@x.com", "hudson-rock"),
               "extra_metadata": {**mk("email", "alice@x.com", "hudson-rock")["extra_metadata"],
                                  "breach_name": "Adobe", "stealer_family": "Adobe"}}]
    breach[0]["extra_metadata"]["breach_name"] = "Adobe"
    f += breach

    corrs = correlate("c1", f)
    types = {c["type"] for c in corrs}
    assert "username_reuse" in types
    assert "shared_bio_text" in types
    assert "shared_email_platform" in types
    assert "breach_overlap" in types
    assert "shared_email" in types, f"missing shared_email; got {types}"
    assert "shared_url" in types, f"missing shared_url; got {types}"
    assert "shared_external_handle" in types, f"missing shared_external_handle; got {types}"
    ur = next(c for c in corrs if c["type"] == "username_reuse" and len(c["entities_involved"]) == 3)
    assert ur["confidence"] == 0.6 and ur["priority"] == 1.8
    assert next(c for c in corrs if c["type"] == "breach_overlap")["confidence"] == 0.9
    se = next(c for c in corrs if c["type"] == "shared_email")
    assert se["confidence"] == 0.9
    assert "carol@acme.io" in se["evidence"][0]
    su = next(c for c in corrs if c["type"] == "shared_url")
    assert su["confidence"] == 0.8
    assert "dave.dev" in su["evidence"][0]
    sh = next(c for c in corrs if c["type"] == "shared_external_handle")
    assert sh["confidence"] == 0.95
    assert "edith_real" in sh["evidence"][0]
    assert all(c["reviewed"] is False for c in corrs)
    assert corrs == sorted(corrs, key=lambda c: -c["priority"])
    print("correlate OK")
