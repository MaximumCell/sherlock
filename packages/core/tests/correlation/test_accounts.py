"""Accounts, not rows: the owner's GitHub scenario end to end, on real collector shapes."""
import random

from sherlock_core.correlation import correlate, extract_entities, group_accounts, summarize
from sherlock_core.correlation.facts import facts_for
from sherlock_core.correlation.rules import restates_lookup
from sherlock_core.jobs import recorrelate, split_account_keys
from sherlock_core.models import make_finding
from sherlock_core.report import generate_markdown
from sherlock_core.scoring import score_exposure
from sherlock_core.store import MemoryStore

HANDLE = "kitewright"
EMAIL = "kit@example.net"  # example.com is ignored by norm_email
GH_URL = f"https://github.com/{HANDLE}"


def _f(cid, itype, value, tool, platform, *, module=None, url=None, extra=None, meta=None, disc="", status="found"):
    return make_finding(case_id=cid, identifier_type=itype, identifier_value=value, source_tool=tool,
                        platform=platform, status=status, url=url, extra=extra, meta=meta, discriminator=disc,
                        module=module)


def username_scan(cid):
    """`github`, `user_scanner` and `whatsmyname` each report the same GitHub account."""
    return [
        _f(cid, "username", HANDLE, "github", "github", url=GH_URL, extra={
            "username": HANDLE, "fullname": "Kit Wright", "bio": "Kites, maps and slow coffee.",
            "location": "Lisbon", "email": EMAIL, "emails": EMAIL, "links": "https://kitewright.example.com",
            "avatar_url": "https://avatars.example.com/u/1", "created_at": "2015-04-01T10:00:00Z"}),
        _f(cid, "username", HANDLE, "user-scanner", "Github", module="user_scanner", url=GH_URL,
           meta={"category": "dev", "reason": None, "media": {}}),
        _f(cid, "username", HANDLE, "user-scanner", "user-scanner", module="user_scanner",
           url="https://github.com/kaifcodec/user-scanner", meta={"summary": True, "checked": 2500, "found": 1}),
        _f(cid, "username", HANDLE, "whatsmyname", "GitHub", url=GH_URL, extra={"username": HANDLE},
           meta={"category": "coding"}),
        _f(cid, "username", HANDLE, "whatsmyname", "whatsmyname", meta={"summary": True, "checked": 600}),
    ]


def email_scan(cid):
    """The follow-up search for the email the GitHub profile publishes."""
    return [
        _f(cid, "email", EMAIL, "user-scanner", "github", module="user_scanner",
           meta={"category": "dev", "reason": None, "media": {}}),
        _f(cid, "email", EMAIL, "gravatar", "gravatar", url="https://gravatar.com/kw", extra={
            "gravatar_id": "0" * 32, "username": "kw-avatar", "fullname": "K. W.",
            "bio": "Paper kites and long walks by the river.", "avatar_url": "https://gravatar.example.com/a"}),
    ]


def _ids(rows):
    return {(r["platform"], r["identifier_type"], r["module"]): r for r in rows}


def _store_case():
    store = MemoryStore()
    cid = store.create_case([{"type": "username", "value": HANDLE}], owner_id="u1", title="Kit")["id"]
    return store, cid


def _scenario():
    store, cid = _store_case()
    store.upsert_findings(username_scan(cid), cid)
    store.upsert_findings(email_scan(cid), cid)
    recorrelate(cid, store)
    return store, cid


def _github(accounts):
    return next(a for a in accounts if a.account_key == f"github:{HANDLE}")


# ----------------------------------------------------------------------------- the owner's scenario
def test_owner_scenario_is_one_github_account_and_one_real_question():
    store, cid = _scenario()
    findings = store.list_findings(cid)
    by = _ids(findings)
    accounts = group_accounts(findings)
    gh = _github(accounts)
    expected = sorted(by[k]["id"] for k in [("github", "username", "github"), ("Github", "username", "user_scanner"),
                                            ("GitHub", "username", "whatsmyname"), ("github", "email", "user_scanner")])
    assert gh.finding_ids == expected                                   # ONE account, 4 findings
    assert gh.label == "GitHub" and gh.handle == HANDLE and gh.url == GH_URL
    assert gh.sources == ["github", "user_scanner", "whatsmyname"]
    assert gh.primary_finding_id == by[("github", "username", "github")]["id"]
    assert gh.profile["fullname"] == {"value": "Kit Wright", "finding_id": gh.primary_finding_id}
    assert gh.profile["emails"] == [{"value": EMAIL, "finding_id": gh.primary_finding_id}]
    assert gh.profile["created_at"]["value"].startswith("2015") and gh.profile["avatar_url"]
    assert gh.joined_by == [f"The GitHub profile {HANDLE} publishes {EMAIL}, and {EMAIL} is registered on GitHub"]
    assert [a.account_key for a in accounts] == [f"github:{HANDLE}", "gravatar:kw-avatar"]

    corrs = store.list_correlations(cid)
    merges = [c for c in corrs if c["type"] == "same_account"]
    assert len(merges) == 1
    (m,) = merges
    assert (m["status"], m["matched_value"], m["confidence"], m["priority"]) == ("approved", f"github:{HANDLE}", 1.0, 0)
    assert m["entities_involved"] == expected and m["reviewed_at"]
    assert "registered on GitHub" in m["evidence"][0]
    assert {e["module"] for e in m["evidence"][1:]} == {"github", "user_scanner", "whatsmyname"}

    pending = [c for c in corrs if c["status"] == "pending"]
    hit, profile = by[("github", "email", "user_scanner")]["id"], by[("github", "username", "github")]["id"]
    # no circular question between the registration hit and the profile that published the email
    assert not any({hit, profile} <= set(c["entities_involved"]) and len(set(c["entities_involved"])) == 2
                   for c in pending)
    assert all(c["type"] != "shared_email_platform" for c in corrs)
    (link,) = pending
    grav = by[("gravatar", "email", "gravatar")]["id"]
    assert link["type"] == "shared_email" and link["matched_value"] == EMAIL
    assert link["entities_involved"] == sorted([*expected, grav])        # every finding of both accounts
    assert {e["account_key"] for e in link["evidence"][1:]} == {f"github:{HANDLE}", "gravatar:kw-avatar"}


def test_summary_scoring_and_report_count_accounts():
    store, cid = _scenario()
    findings = store.list_findings(cid)
    stats = summarize(findings)
    assert stats["account_count"] == 2 and stats["platforms_found"] == 2
    assert stats["handles"][0] == {"handle": HANDLE, "platform_count": 1, "platforms": ["GitHub"]}
    gh = next(a for a in stats["accounts"] if a["account_key"] == f"github:{HANDLE}")
    assert gh["finding_count"] == 4 and gh["sources"] == ["github", "user_scanner", "whatsmyname"]

    corrs = store.list_correlations(cid)
    out = score_exposure(findings, corrs)
    foot = next(f for f in out["factors"] if f["key"] == "account_footprint")
    assert "2 distinct platforms (GitHub and gravatar)" in foot["detail"]
    # the automatic merge is not a link; the pending link is not counted
    assert out["computed_from"]["approved_correlations"] == 0
    link = next(c for c in corrs if c["type"] == "shared_email")
    store.set_correlation_status(link["id"], "approved")
    assert score_exposure(findings, store.list_correlations(cid))["computed_from"]["approved_correlations"] == 1

    md = generate_markdown(cid, store)
    assert md.count(f"GitHub `{HANDLE}`") == 1
    assert f"GitHub `{HANDLE}` (<{GH_URL}>), confirmed by: github, user_scanner, whatsmyname" in md
    assert "## Approved links between accounts (1)" in md and "### shared_email" in md
    assert "same_account" not in md
    assert "## Other found findings by platform (0)" in md          # scan coverage rows are not listed


def test_entities_keep_provenance_and_skip_scanned_identifiers():
    store, cid = _scenario()
    ents = extract_entities(store.list_findings(cid))
    values = {(e["kind"], e["value"]) for e in ents}
    assert ("email", EMAIL) not in values                    # already searched
    profile = next(f for f in store.list_findings(cid) if f["module"] == "github")
    site = next(e for e in ents if e["kind"] == "url")
    assert site["value"] == "kitewright.example.com" and site["source_finding_id"] == profile["id"]


# ----------------------------------------------------------------------------- merge rules
def test_platform_name_casing_is_one_account():
    rows = [_f("c", "username", "Edith", "a", "Github"), _f("c", "username", "edith", "b", "GitHub"),
            _f("c", "username", "EDITH", "c", "github")]
    (acc,) = group_accounts(rows)
    assert acc.account_key == "github:edith" and acc.label == "GitHub" and acc.sources == ["a", "b", "c"]
    assert acc.joined_by == []                       # same handle: a trivial merge needs no reason


def test_ambiguous_registration_hit_is_not_merged():
    rows = [_f("c", "username", "kit", "github", "github", extra={"email": EMAIL}),
            _f("c", "username", "kit2", "github", "github", extra={"email": EMAIL}),
            _f("c", "email", EMAIL, "user-scanner", "Github", module="user_scanner")]
    keys = {a.account_key: a.finding_ids for a in group_accounts(rows)}
    assert set(keys) == {"github:kit", "github:kit2", f"github:email:{EMAIL}"}
    assert all(c["type"] != "same_account" for c in correlate("c", [{**r, "id": f"f{i}"} for i, r in enumerate(rows)]))


def test_email_lookup_that_returns_the_profile_url_joins_it():
    # the github module's email search returns the account's own URL
    rows = [_f("c", "username", HANDLE, "github", "github", url=GH_URL, extra={"fullname": "Kit Wright"}),
            _f("c", "email", "other@example.org", "github", "github", url=GH_URL, extra={"username": HANDLE},
               disc=HANDLE)]
    (acc,) = group_accounts([{**r, "id": f"f{i}"} for i, r in enumerate(rows)])
    assert acc.finding_ids == ["f0", "f1"] and "found by looking up other@example.org" in acc.joined_by[0]


def test_scrape_of_own_profile_belongs_to_the_account(S):
    profile = S.site("edith", "GitHub", {"bio": "Kites and maps and slow coffee every day."},
                     url="https://github.com/edith")
    scrape = S.scrape("https://github.com/edith/")
    (acc,) = group_accounts([profile, scrape])
    assert acc.finding_ids == sorted([profile["id"], scrape["id"]]) and acc.primary_finding_id == profile["id"]
    assert acc.joined_by == ["A copy of the GitHub profile page of edith was read"]


def test_breaches_and_summaries_are_not_accounts(S):
    rows = [S.breach("a@acme.io", "Adobe"), S.hudson("a@acme.io"),
            _f("c", "username", "x", "whatsmyname", "whatsmyname", meta={"summary": True})]
    assert group_accounts(rows) == []


# ----------------------------------------------------------------------------- circular evidence
def test_registration_hit_never_links_to_the_profile_it_was_discovered_from(S):
    profile = S.site("edith", "GitHub", {"email": "edith@acme.io"})
    elsewhere = S.site("edith@acme.io", "Spotify", {}, itype="email")
    assert correlate("c", [profile, elsewhere]) == []
    ff = facts_for(elsewhere)
    assert restates_lookup(ff, "edith@acme.io")


def test_independent_profile_for_the_email_is_a_real_link(S):
    profile = S.site("edith", "GitHub", {"email": "edith@acme.io"})
    grav = S.gravatar("edith@acme.io", fullname="Edith F")
    assert not restates_lookup(facts_for(grav), "edith@acme.io")
    (c,) = correlate("c", [profile, grav])
    assert c["type"] == "shared_email" and "status" not in c


# ----------------------------------------------------------------------------- split / human decisions
def test_split_is_respected_and_survives_recorrelate():
    store, cid = _scenario()
    merge = next(c for c in store.list_correlations(cid) if c["type"] == "same_account")
    store.set_correlation_status(merge["id"], "rejected", "two different people")
    assert split_account_keys(store.list_correlations(cid)) == {f"github:{HANDLE}"}
    recorrelate(cid, store)
    recorrelate(cid, store)
    after = store.get_correlation(merge["id"])
    assert after["status"] == "rejected" and after["review_note"] == "two different people"

    findings = store.list_findings(cid)
    split = group_accounts(findings, {f"github:{HANDLE}"})
    gh_items = [a for a in split if a.account_key.startswith(f"github:{HANDLE}#")]
    assert len(gh_items) == 4 and all(len(a.finding_ids) == 1 for a in gh_items)
    assert summarize(findings, {f"github:{HANDLE}"})["account_count"] == 4   # 3 handle rows + the email hit
    # the split is reversible: merging again restores one account
    store.set_correlation_status(merge["id"], "approved")
    recorrelate(cid, store)
    assert store.get_correlation(merge["id"])["status"] == "approved"


def test_split_changes_links_between_accounts(S):
    a = S.site("edith", "GitHub", {"email": "edith@acme.io"})
    b = S.site("edith", "github", {"name": "Edith Finch"})
    c = S.site("efinch", "GitLab", {"name": "Edith Finch"})
    merged = correlate("c", [a, b, c])
    link = next(r for r in merged if r["type"] == "shared_display_name")
    assert link["entities_involved"] == sorted([a["id"], b["id"], c["id"]])
    split = correlate("c", [a, b, c], split_keys={"github:edith"})
    link = next(r for r in split if r["type"] == "shared_display_name")
    assert link["entities_involved"] == sorted([b["id"], c["id"]])
    # the merge row itself is still produced, so the store keeps the human's "split" on it
    assert any(r["type"] == "same_account" for r in split)


def test_approved_cross_account_link_survives_a_change_of_grouping():
    store, cid = _store_case()
    rows = username_scan(cid)
    store.upsert_findings([rows[0], *email_scan(cid)[1:]], cid)          # profile + Gravatar only
    recorrelate(cid, store)
    link = next(c for c in store.list_correlations(cid) if c["type"] == "shared_email")
    store.set_correlation_status(link["id"], "approved", "same person")
    store.upsert_findings([*rows[1:], email_scan(cid)[0]], cid)           # more sources join the account
    recorrelate(cid, store)
    after = store.get_correlation(link["id"])
    assert after["status"] == "approved" and after["review_note"] == "same person"
    assert len(after["entities_involved"]) == 5                          # 4 GitHub findings + Gravatar


# ----------------------------------------------------------------------------- determinism
def test_accounts_and_rows_are_order_independent():
    cid = "c"
    rows = [{**r, "id": f"f{i:03d}"} for i, r in enumerate([*username_scan(cid), *email_scan(cid)])]
    want_acc = [a.as_dict() for a in group_accounts(rows)]
    want_rows = correlate(cid, rows)
    rng = random.Random(3)
    for _ in range(5):
        shuffled = rows[:]
        rng.shuffle(shuffled)
        assert [a.as_dict() for a in group_accounts(shuffled)] == want_acc
        assert correlate(cid, shuffled) == want_rows
