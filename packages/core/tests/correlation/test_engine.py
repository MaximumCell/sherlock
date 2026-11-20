"""corr_key stability, review survival through the store, scale, and the report."""
import random
import time

import pytest
from sherlock_core.correlation import corr_key, correlate, extract_entities, summarize
from sherlock_core.report import generate_markdown
from sherlock_core.store import MemoryStore

CASE = "case-1"
BIO = "Kite designer from Lisbon. Coffee, maps and long walks."


def _keys(corrs):
    return {c["type"]: c["corr_key"] for c in corrs}


def test_corr_key_is_keyed_on_the_matched_value():
    assert corr_key("shared_email", "a@b.io") == corr_key("shared_email", "a@b.io")
    assert corr_key("shared_email", "a@b.io") != corr_key("shared_url", "a@b.io")


def test_corr_key_stable_when_a_third_member_joins(S):
    extra = {"email": "edith@acme.io", "blog": "https://edith.dev", "name": "Edith Finch", "bio": BIO,
             "twitter": "edith_tw", "avatar_phash": "ffee000011112222"}
    target = S.site("edith_tw", "X", {})
    two = [target, S.site("edith", "GitHub", extra), S.site("efinch", "GitLab", extra)]
    # the newcomer sorts BEFORE the others by id and finding_key, to prove neither is part of the key
    third = {**S.site("e.f", "Keybase", extra), "id": "a0000", "finding_key": "a0000"}
    before, after = correlate(CASE, two), correlate(CASE, [*two, third])
    assert set(_keys(before)) == {"shared_email", "shared_url", "shared_display_name", "shared_bio_text",
                                  "shared_external_handle", "avatar_match"}
    assert _keys(before) == _keys(after)
    for c in after:
        assert third["id"] in c["entities_involved"]


def test_breach_and_email_platform_keys_are_stable_too(S):
    two = [S.breach("a@acme.io", "Adobe"), S.breach("b@acme.io", "Adobe")]
    k1 = correlate(CASE, two)[0]["corr_key"]
    assert correlate(CASE, [*two, S.breach("c@acme.io", "adobe ")])[0]["corr_key"] == k1


def test_approval_survives_rerun_with_memory_store(S):
    store = MemoryStore()
    cid = store.create_case([{"type": "username", "value": "edith"}], owner_id="u1")["id"]
    store.upsert_findings([
        S.site("edith", "GitHub", {"email": "edith@acme.io", "name": "Edith Finch"}),
        S.site("efinch", "GitLab", {"email": "edith@acme.io", "name": "Edith Finch"}),
    ], cid)
    rows = store.sync_correlations(cid, correlate(cid, store.list_findings(cid)))
    assert {r["type"] for r in rows} == {"shared_email", "shared_display_name"}
    assert all(r["status"] == "pending" for r in rows)
    email = next(r for r in rows if r["type"] == "shared_email")
    name = next(r for r in rows if r["type"] == "shared_display_name")
    store.set_correlation_status(email["id"], "approved", "same person, confirmed")
    store.set_correlation_status(name["id"], "rejected")

    store.upsert_findings([S.site("e.f", "Keybase", {"email": "Edith@Acme.io", "name": "Edith Finch"})], cid)
    findings = store.list_findings(cid)
    after = {r["type"]: r for r in store.sync_correlations(cid, correlate(cid, findings))}

    assert len(after) == 2
    assert after["shared_email"]["id"] == email["id"]
    assert after["shared_email"]["status"] == "approved"
    assert after["shared_email"]["review_note"] == "same person, confirmed"
    assert after["shared_email"]["entities_involved"] == sorted(f["id"] for f in findings)   # new member joined
    assert after["shared_display_name"]["status"] == "rejected"                               # not re-proposed
    # entities for the pivot list go straight into the store
    store.upsert_entities(cid, extract_entities(findings))
    assert {(e["kind"], e["value"]) for e in store.list_entities(cid)} == {("email", "edith@acme.io"),
                                                                           ("domain", "acme.io")}


WORDS = ["kite", "designer", "lisbon", "coffee", "maps", "walks", "engineer", "rust", "postgres", "systems", "photographer", "runner", "writer", "music", "vinyl", "climbing", "security", "researcher", "bounty", "open", "source", "maintainer", "gardener", "chess", "tea", "books", "cyclist", "painter", "teacher", "student", "founder", "analyst", "pilot", "sailor", "baker", "coder", "gamer"]


def _big_case(S, n=1000):
    rng = random.Random(7)
    rows = []
    for i in range(n):
        kind = i % 10
        if kind < 6:      # profiles with rich extras, many sharing values
            rows.append(S.site(f"user{i % 40}", f"Site{i % 250}", {
                "name": f"Person {i % 30} Example",
                "bio": " ".join(rng.choice(WORDS) for _ in range(14)) if i % 3 else "Kite designer from Lisbon, coffee and maps.",
                "email": f"user{i % 50}@acme.io",
                "links": f"https://site{i % 60}.dev, https://twitter.com/user{i % 40}",
                "avatar_phash": f"{rng.getrandbits(64):016x}",
            }, url=f"https://site{i % 250}.example/user{i % 40}"))
        elif kind == 6:
            rows.append(S.breach(f"user{i % 50}@acme.io", f"Breach{i % 20}"))
        elif kind == 7:
            rows.append(S.scrape(f"https://site{i % 60}.dev/page{i}", description=" ".join(rng.choice(WORDS) for _ in range(20)),
                                 emails=f"user{i % 50}@acme.io", urls=f"https://github.com/user{i % 40}"))
        elif kind == 8:
            rows.append(S.site(f"user{i % 40}", f"Site{i % 250}", {}, status="not_found"))
        else:
            rows.append(S.hudson(f"user{i % 50}@acme.io", date=f"2024-01-{1 + i % 28:02d}T00:00:00.000Z"))
    return rows


def test_thousand_findings_under_two_seconds(S):
    rows = _big_case(S)
    assert len(rows) == 1000
    t0 = time.perf_counter()
    corrs = correlate(CASE, rows)
    summarize(rows)
    extract_entities(rows)
    elapsed = time.perf_counter() - t0
    assert elapsed < 2.0, f"took {elapsed:.2f}s"
    assert corrs and len({c["corr_key"] for c in corrs}) == len(corrs)
    assert all(0 <= c["confidence"] <= 1 and len(c["entities_involved"]) >= 2 for c in corrs)
    assert corrs == sorted(corrs, key=lambda c: -c["priority"])


def test_worst_case_bios_stay_bounded(S):
    # 1,000 distinct but near-identical bios: blocking must not degrade to all-pairs ratio()
    rows = [S.site(f"u{i}", f"Site{i}", {"bio": f"Kite designer from Lisbon, coffee and maps. Member number {i:04d}"})
            for i in range(1000)]
    t0 = time.perf_counter()
    corrs = correlate(CASE, rows)
    assert time.perf_counter() - t0 < 2.0
    assert len(corrs) <= 1000


# ----------------------------------------------------------------------------- report
def test_report_lists_only_approved_correlations_and_found_rows(S):
    store = MemoryStore()
    cid = store.create_case([{"type": "username", "value": "edith"}], owner_id="u1", title="Edith")["id"]
    store.upsert_findings([
        S.site("edith", "GitHub", {"email": "edith@acme.io", "name": "Edith Finch"}, url="https://github.com/edith"),
        S.site("efinch", "GitLab", {"email": "edith@acme.io", "name": "Edith Finch"}),
        S.breach("edith@acme.io", "Adobe"),
        *[S.site("edith", f"Missing{i}", {}, status="not_found") for i in range(300)],
        S.site("edith", "Broken", {}, status="error"),
    ], cid)
    rows = store.sync_correlations(cid, correlate(cid, store.list_findings(cid)))
    email = next(r for r in rows if r["type"] == "shared_email")
    store.set_correlation_status(email["id"], "approved", "checked by hand")

    md = generate_markdown(cid, store)
    assert "shared_email: edith@acme.io" in md and "checked by hand" in md
    assert "shared_display_name" not in md                    # pending: not reported
    assert "extra.email" in md and "GitHub: `edith`" in md    # evidence and linked findings
    assert "303 found" not in md and "(3 found, 300 not found, 1 errors)" in md
    assert "Missing" not in md and "Broken" not in md         # not_found / error rows never listed
    assert "Adobe" in md and "<https://github.com/edith>" in md
    assert "not a probability and not certainty" in md
    assert len(md.splitlines()) < 60

    with pytest.raises(ValueError):
        generate_markdown("nope", store)


def test_report_without_approved_correlations(S):
    store = MemoryStore()
    cid = store.create_case([{"type": "email", "value": "a@b.io"}], owner_id="u1")["id"]
    md = generate_markdown(cid, store)
    assert "No correlation has been approved yet" in md and "Method and limitations" in md
