"""Deterministic correlation engine. Pure functions over normalized findings.

Rules (plan Section 6 Phase 3):
  username_reuse      same username string on N+ platforms
  shared_bio_text     same/highly-similar bio text on two accounts
  shared_email_platform  email and username both resolve on same platform
  breach_overlap      same identifier in same breach via two collectors

Every correlation: {case_id, correlation_id, type, entities_involved,
confidence, evidence, priority, reviewed}. priority = confidence * platform_reach.
"""
import difflib
import uuid

from collections import defaultdict

BIO_FIELDS = ("bio", "about", "description", "profile_text", "intro")

MIN_USERNAME_REUSE = 2
BIO_EXACT_CONF = 0.8
BIO_FUZZY_CONF = 0.7   # ratio >= 0.9
BIO_LOOSE_CONF = 0.6   # ratio >= 0.8
EMAIL_PLATFORM_CONF = 0.75
BREACH_OVERLAP_CONF = 0.9


def _new_corr(case_id, ctype, entities, confidence, evidence):
    return {
        "case_id": case_id,
        "correlation_id": str(uuid.uuid4()),
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
    mk = lambda it, iv, plat, bio="": {
        "case_id": "c1", "identifier_type": it, "identifier_value": iv,
        "source_tool": "user-scanner", "platform": plat, "status": "found",
        "extra_metadata": {"bio": bio, "breach_name": None, "stealer_family": None,
                           "extra": {}, "media": {}}, "collected_at": "",
    }
    f = [
        mk("username", "alice", "github", "Security researcher, bug bounty"),
        mk("username", "alice", "twitter", "Security researcher, bug bounty"),
        mk("username", "alice", "linkedin"),
        mk("username", "bob", "twitter", "Hello world I am a bot"),
        mk("username", "bob", "instagram", "Hello world I am a bot"),
        mk("email", "alice@x.com", "github"),
    ]
    breach = [mk("email", "alice@x.com", "breach"),
              {**mk("email", "alice@x.com", "hudson-rock"),
               "extra_metadata": {**mk("email", "alice@x.com", "hudson-rock")["extra_metadata"],
                                  "breach_name": "Adobe", "stealer_family": "Adobe"}}]
    # patch breach_name into the first breach finding too
    breach[0]["extra_metadata"]["breach_name"] = "Adobe"
    f += breach

    corrs = correlate("c1", f)
    types = {c["type"] for c in corrs}
    assert "username_reuse" in types and "shared_bio_text" in types and "shared_email_platform" in types and "breach_overlap" in types
    ur = next(c for c in corrs if c["type"] == "username_reuse" and len(c["entities_involved"]) == 3)
    assert ur["confidence"] == 0.6 and ur["priority"] == 1.8  # 3 platforms
    assert next(c for c in corrs if c["type"] == "breach_overlap")["confidence"] == 0.9
    assert all(c["reviewed"] is False for c in corrs)
    assert corrs == sorted(corrs, key=lambda c: -c["priority"])
    print("correlate OK")
