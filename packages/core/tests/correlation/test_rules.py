"""One positive and one negative case per rule, on real collector shapes."""
import math

from sherlock_core.correlation import correlate, summarize

CASE = "case-1"
BIO = "Kite designer from Lisbon. Coffee, maps and long walks."


def _ids(*rows):
    return sorted(r["id"] for r in rows)


def _review(corrs):
    """Review items only: `same_account` rows are automatic merges, not questions."""
    return [c for c in corrs if c["type"] != "same_account"]


def _only(corrs, rule):
    matches = [c for c in corrs if c["type"] == rule]
    assert len(matches) == 1, [(c["type"], c["matched_value"]) for c in corrs]
    return matches[0]


# ----------------------------------------------------------------------------- row contract
def test_row_shape_and_contract(S):
    a = S.site("edith", "GitHub", {"email": "Edith@Acme.io"})
    b = S.site("edith_f", "GitLab", {"public_email": "edith@acme.io"})
    (c,) = correlate(CASE, [b, a, a])
    assert set(c) == {"case_id", "type", "corr_key", "matched_value", "entities_involved", "confidence",
                      "evidence", "priority"}                    # never status / review fields
    assert c["entities_involved"] == _ids(a, b)                  # finding ids, sorted, unique
    assert c["type"] == "shared_email" and c["matched_value"] == "edith@acme.io" and c["confidence"] == 0.9
    assert c["priority"] == round(0.9 * math.log(1 + 2), 4)
    assert isinstance(c["evidence"][0], str)
    assert all(set(e) == {"finding_id", "platform", "field", "value", "account_key"} for e in c["evidence"][1:])
    assert {e["account_key"] for e in c["evidence"][1:]} == {"github:edith", "gitlab:edith_f"}
    assert {e["finding_id"] for e in c["evidence"][1:]} == set(_ids(a, b))
    assert len(c["corr_key"]) == 64
    assert correlate(CASE, [a, b]) == correlate(CASE, [b, a])    # deterministic


def test_only_found_rows_are_input(S):
    a = S.site("edith", "GitHub", {"email": "edith@acme.io", "bio": BIO, "name": "Edith Finch"})
    for status in ("not_found", "error"):
        b = S.site("edith_f", "GitLab", {"email": "edith@acme.io", "bio": BIO, "name": "Edith Finch"}, status=status)
        assert correlate(CASE, [a, b]) == []
    assert correlate(CASE, []) == [] and correlate(CASE, [None, "x", {}]) == []


# ----------------------------------------------------------------------------- shared_email
def test_shared_email_positive_from_firecrawl_emails_in_page(S):
    profile = S.site("edith", "GitHub", {"email": "edith@acme.io"}, url="https://github.com/edith")
    page = S.scrape("https://edith.dev/contact", emails="press@edith.dev, Edith@Acme.io")
    c = _only(correlate(CASE, [profile, page]), "shared_email")
    assert c["entities_involved"] == _ids(profile, page)
    assert {"finding_id": page["id"], "platform": "scraped:edith.dev", "field": "extra.emails_in_page",
            "value": "Edith@Acme.io", "account_key": "edith.dev:url:edith.dev/contact"} in c["evidence"]


def test_shared_email_negative(S):
    # same platform twice, and a profile next to its own scrape
    rows = [S.site("edith", "GitHub", {"email": "edith@acme.io"}),
            S.scrape("https://github.com/edith", emails="edith@acme.io"),
            S.site("other", "GitLab", {"email": "other@acme.io"})]
    assert _review(correlate(CASE, rows)) == []
    # an email that is merely REGISTERED on many sites is the seed, not a discovery
    seed = [S.site("edith@acme.io", p, {}, itype="email") for p in ("Spotify", "Adobe", "Duolingo")]
    assert correlate(CASE, seed) == []
    # ... and those registration rows do not join a real cluster either
    profile = S.site("edith", "GitHub", {"email": "edith@acme.io"})
    grav = S.gravatar("edith@acme.io", fullname="Edith Finch")
    c = _only(correlate(CASE, [*seed, profile, grav]), "shared_email")
    assert c["entities_involved"] == _ids(profile, grav)


# ----------------------------------------------------------------------------- shared_url
def test_shared_url_positive(S):
    a = S.site("edith", "GitHub", {"blog": "http://www.edith.dev/"})
    b = S.site("edith_tw", "X", {"links": "https://edith.dev#top, https://linktr.ee/edith"})
    g = S.gravatar("e@acme.io", links="https://linktr.ee/edith?utm_source=gravatar")
    corrs = [c for c in correlate(CASE, [a, b, g]) if c["type"] == "shared_url"]
    assert {c["matched_value"]: c["entities_involved"] for c in corrs} == {
        "edith.dev": _ids(a, b), "linktr.ee/edith": _ids(b, g)}
    assert all(c["confidence"] == 0.8 for c in corrs)


def test_shared_url_negative_hubs_and_generic_hosts(S):
    links = "https://linktr.ee, https://www.google.com/, https://twitter.com, https://github.com/login"
    a = S.site("edith", "GitHub", {"links": links})
    b = S.site("someone", "GitLab", {"links": links})
    assert correlate(CASE, [a, b]) == []
    # the same link twice on one platform is not cross-platform
    assert correlate(CASE, [S.site("a", "GitHub", {"blog": "https://edith.dev"}),
                            S.site("b", "GitHub", {"blog": "https://edith.dev"})]) == []


# ----------------------------------------------------------------------------- shared_external_handle
def test_github_twitter_field_matches_platform_x(S):
    gh = S.site("edith", "GitHub", {"twitter": "Edith"})
    tw = S.site("edith", "X", {})
    c = _only(correlate(CASE, [gh, tw]), "shared_external_handle")
    assert c["matched_value"] == "edith@twitter" and c["confidence"] == 0.95
    assert c["entities_involved"] == _ids(gh, tw)
    assert c["priority"] == round(0.95 * math.log(3), 4)


def test_external_handle_from_links_and_bio_is_one_cluster(S):
    tw = S.site("Edith_TW", "Twitter", {})
    gh = S.site("edith", "GitHub", {"blog": "https://x.com/edith_tw"})
    ig = S.site("edith.f", "Instagram", {"bio": "kites and maps. twitter: @edith_tw"})
    gr = S.gravatar("e@acme.io", links="https://twitter.com/Edith_TW/")
    c = _only(correlate(CASE, [tw, gh, ig, gr]), "shared_external_handle")
    assert c["entities_involved"] == _ids(tw, gh, ig, gr)          # one per cluster, not one per pair


def test_external_handle_negative(S):
    # dropbox link is not a twitter handle, even though an X account named "s" exists
    assert correlate(CASE, [S.site("edith", "GitHub", {"blog": "https://www.dropbox.com/s/abc"}),
                            S.site("s", "X", {})]) == []
    # handle named on a platform where nothing was found / where it was not_found
    assert correlate(CASE, [S.site("edith", "GitHub", {"twitter": "edith_tw"}),
                            S.site("edith_tw", "X", {}, status="not_found"),
                            S.site("edith_tw", "Instagram", {})]) == []
    # a profile linking to itself, and bare @mentions on a scraped page
    assert _review(correlate(CASE, [S.site("edith", "GitHub", {"links": "https://github.com/edith"}),
                                    S.scrape("https://edith.dev", handles="@edith"),
                                    S.scrape("https://github.com/edith",
                                             urls="https://github.com/edith?tab=repositories")])) == []


def test_external_handle_from_scrape_only_is_weaker(S):
    tw = S.site("edith_tw", "X", {})
    page = S.scrape("https://edith.dev", urls="https://twitter.com/edith_tw")
    assert _only(correlate(CASE, [tw, page]), "shared_external_handle")["confidence"] == 0.7


# ----------------------------------------------------------------------------- shared_display_name
def test_shared_display_name_positive(S):
    rows = [S.site("edith", "GitHub", {"name": "Edith  Finch"}),
            S.site("efinch", "X", {"fullname": "edith finch"}),
            S.site("efinch2", "X", {"fullname": "Edith Finch"}),      # same platform: no extra credit
            S.gravatar("e@acme.io", fullname="EDITH FINCH")]
    c = _only(correlate(CASE, rows), "shared_display_name")
    assert c["entities_involved"] == _ids(*rows)
    assert c["confidence"] == 0.65                                    # 0.6 + 0.05 for the 3rd platform
    assert c["priority"] == round(0.65 * math.log(4), 4)
    many = [S.site(f"u{i}", f"Site{i}", {"name": "Edith Finch"}) for i in range(12)]
    assert _only(correlate(CASE, many), "shared_display_name")["confidence"] == 0.85   # capped


def test_shared_display_name_negative_and_weak_names(S):
    assert correlate(CASE, [S.site("a", "GitHub", {"name": "Edith Finch"}),
                            S.site("b", "GitHub", {"name": "Edith Finch"}),
                            S.site("c", "X", {"name": "Edith Flinch"})]) == []
    # a display name that just repeats the handle is username reuse, not a correlation
    assert correlate(CASE, [S.site("edith", "GitHub", {"name": "edith"}), S.site("edith", "X", {"name": "Edith"})]) == []
    single = [S.site("a", "GitHub", {"name": "Edith"}), S.site("b", "X", {"name": "Edith"})]
    assert _only(correlate(CASE, single), "shared_display_name")["confidence"] == 0.4


# ----------------------------------------------------------------------------- shared_bio_text
def test_identical_bios_make_one_correlation_not_one_per_pair(S):
    rows = [S.site(f"user{i}", f"Site{i}", {"bio": BIO}) for i in range(6)]
    c = _only(correlate(CASE, rows), "shared_bio_text")                # 1, not 6*5/2 = 15
    assert c["entities_involved"] == _ids(*rows) and c["confidence"] == 0.8


def test_similar_bios_fuzzy_levels(S):
    a = S.site("a", "GitHub", {"bio": BIO})
    b = S.site("b", "X", {"about": BIO.replace("long walks.", "long walks!!")})
    assert _only(correlate(CASE, [a, b]), "shared_bio_text")["confidence"] == 0.7
    c = S.site("c", "Mastodon", {"description": "Kite designer from Lisbon. Coffee, maps, bikes and long hikes too."})
    assert _only(correlate(CASE, [a, c]), "shared_bio_text")["confidence"] == 0.6


def test_shared_bio_negative(S):
    assert correlate(CASE, [S.site("a", "GitHub", {"bio": BIO}),
                            S.site("b", "X", {"bio": "Backend engineer. Rust, Postgres and distributed systems."}),
                            S.site("c", "GitLab", {"bio": "short bio"}),
                            S.site("d", "Keybase", {"bio": "short bio"})]) == []
    # legacy read the first long string: identical full names / titles are NOT bios
    assert [c["type"] for c in correlate(CASE, [
        S.site("a", "GitHub", {"fullname": "Edith Margaret Finch-Okafor", "title": "Profile page of the user"}),
        S.site("b", "X", {"fullname": "Edith Margaret Finch-Okafor", "title": "Profile page of the user"}),
    ])] == ["shared_display_name"]


def test_profile_is_not_correlated_with_its_own_scrape(S):
    profile = S.site("edith", "GitHub", {"bio": BIO}, url="https://github.com/edith")
    scrape = S.scrape("https://github.com/edith/", description=BIO)
    assert _review(correlate(CASE, [profile, scrape])) == []
    # same account even when the collector stored an API url
    api = S.site("edith", "GitHub", {"bio": BIO}, url="https://api.github.com/users/edith")
    assert _review(correlate(CASE, [api, scrape])) == []
    # a second, different account with that bio makes it a real cluster
    other = S.site("edith_tw", "X", {"bio": BIO})
    c = _only(correlate(CASE, [profile, scrape, other]), "shared_bio_text")
    assert c["entities_involved"] == _ids(profile, scrape, other)


# ----------------------------------------------------------------------------- breach_overlap
def test_two_breaches_per_email_and_overlap_for_two_emails(S):
    rows = [S.breach("edith@acme.io", "Adobe"), S.breach("edith@acme.io", "LinkedIn"),
            S.breach("e.finch@proton.me", "Adobe"), S.breach("e.finch@proton.me", "Canva")]
    stats = summarize(rows)
    assert stats["breach_count"] == 3
    assert {b["name"]: b["identifiers"] for b in stats["breaches"]}["Adobe"] == ["e.finch@proton.me", "edith@acme.io"]
    c = _only(correlate(CASE, rows), "breach_overlap")
    assert c["matched_value"] == "Adobe" and c["confidence"] == 0.9
    assert c["entities_involved"] == _ids(rows[0], rows[2])
    assert {e["value"] for e in c["evidence"][1:]} == {"edith@acme.io", "e.finch@proton.me"}


def test_breach_overlap_across_sources_and_infostealer_logs(S):
    rows = [S.breach("edith@acme.io", "Adobe"),
            S.spiderfoot("acme.io", "EMAILADDR_COMPROMISED", "press@acme.io [ADOBE]")]
    assert _only(correlate(CASE, rows), "breach_overlap")["entities_involved"] == _ids(*rows)
    same_log = [S.hudson("edith@acme.io"), S.hudson("edith", itype="username")]
    c = _only(correlate(CASE, same_log), "breach_overlap")
    assert c["matched_value"].startswith("infostealer:redline")


def test_breach_overlap_negative(S):
    # one identifier seen by two collectors is not an overlap of identifiers
    assert correlate(CASE, [S.breach("edith@acme.io", "Adobe"),
                            S.breach("Edith@Acme.io", "Adobe", tool="hibp"),
                            S.breach("other@acme.io", "LinkedIn")]) == []
    # same stealer family, different machines / dates
    assert correlate(CASE, [S.hudson("edith@acme.io", date="2024-03-01T10:00:00.000Z"),
                            S.hudson("other@acme.io", date="2022-11-20T08:30:00.000Z")]) == []


def test_hudson_rock_is_not_a_platform(S):
    rows = [S.site("edith", "GitHub", {}), S.hudson("edith", itype="username"),
            S.hudson("edith", itype="username", date="2023-01-01T00:00:00.000Z"), S.breach("e@acme.io", "Adobe")]
    stats = summarize(rows)
    assert stats["handles"] == [{"handle": "edith", "platform_count": 1, "platforms": ["GitHub"]}]
    assert stats["platforms_found"] == 1 and stats["infostealer_count"] == 2
    assert correlate(CASE, rows) == []


# ----------------------------------------------------------------------------- email registered on the same platform
def test_email_registered_where_the_profile_publishes_it_is_one_account(S):
    # formerly the review item `shared_email_platform`: now an automatic merge, never a question
    user = S.site("edith", "GitHub", {"email": "Edith@Acme.io"})
    email = S.site("edith@acme.io", "github", {}, itype="email")
    corrs = correlate(CASE, [user, email])
    assert _review(corrs) == []
    (merge,) = corrs
    assert merge["type"] == "same_account" and merge["matched_value"] == "github:edith"
    assert merge["entities_involved"] == _ids(user, email) and merge["status"] == "approved"


def test_email_registered_elsewhere_is_not_merged(S):
    # a username and an email that both merely exist on a site are not one account
    assert correlate(CASE, [S.site("edith", "GitHub", {}),
                            S.site("edith@acme.io", "GitHub", {}, itype="email")]) == []
    # profile publishes a DIFFERENT email, or the email is registered elsewhere
    assert correlate(CASE, [S.site("edith", "GitHub", {"email": "other@acme.io"}),
                            S.site("edith@acme.io", "GitHub", {}, itype="email"),
                            S.site("other@acme.io", "Spotify", {}, itype="email")]) == []


# ----------------------------------------------------------------------------- avatar_match
def test_avatar_match_positive(S):
    a = S.v2("username", "edith", "GitHub", {"avatar_phash": "ffee000011112222"})
    b = S.v2("username", "edith_tw", "X", {"avatar_phash": "FFEE000011112222"})
    c = _only(correlate(CASE, [a, b]), "avatar_match")
    assert c["confidence"] == 0.95 and c["entities_involved"] == _ids(a, b)
    near = S.v2("username", "e.f", "Instagram", {"avatar_phash": "ffee00001111223f"})   # 5 bits away
    c = _only(correlate(CASE, [a, b, near]), "avatar_match")
    assert c["confidence"] == 0.85 and c["entities_involved"] == _ids(a, b, near)
    assert c["matched_value"] == "ffee000011112222"


def test_avatar_match_negative(S):
    rows = [S.v2("username", "a", "GitHub", {"avatar_phash": "ffee000011112222"}),
            S.v2("username", "b", "X", {"avatar_phash": "ffee00001111ffff"}),          # 10 bits away
            S.v2("username", "c", "GitHub", {"avatar_phash": "ffee000011112222"}),     # same platform
            S.v2("username", "d", "GitLab", {"avatar_phash": "0000000000000000"}),     # blank image
            S.v2("username", "e", "Keybase", {"avatar_phash": "0000000000000000"}),
            S.v2("username", "f", "Reddit", {"avatar_phash": "not-a-hash"})]
    assert correlate(CASE, rows) == []


# ----------------------------------------------------------------------------- username reuse
def test_username_reuse_is_a_summary_stat_not_a_correlation(S):
    rows = [S.site("Edith" if i % 2 else "edith", f"Site{i:03d}", {}) for i in range(300)]
    rows += [S.site("edith", f"Missing{i}", {}, status="not_found") for i in range(40)]
    rows += [S.site("edith", f"Broken{i}", {}, status="error") for i in range(5)]
    corrs = correlate(CASE, rows)
    assert [c for c in corrs if c["type"] == "username_reuse"] == [] and corrs == []
    stats = summarize(rows)
    assert stats["username_reuse"] == {"edith": 300}                  # case-insensitive
    assert stats["handles"][0]["platform_count"] == 300
    assert (stats["total"], stats["found"], stats["not_found"], stats["error"]) == (345, 300, 40, 5)
    assert stats["by_source"]["user-scanner"] == {"found": 300, "not_found": 40, "error": 5, "unknown": 0}


def test_summarize_counts_platforms_canonically(S):
    rows = [S.site("edith", "X", {}), S.v2("username", "Edith", "twitter.com"),
            S.site("e@acme.io", "Spotify", {}, itype="email"), S.scrape("https://edith.dev")]
    stats = summarize(rows)
    assert stats["username_reuse"] == {"edith": 1} and stats["platforms_found"] == 2
    assert stats["emails"] == [{"email": "e@acme.io", "platform_count": 1, "platforms": ["Spotify"]}]
    assert stats["scraped_pages"] == 1
    assert summarize([])["total"] == 0 and summarize([None, 3])["handles"] == []
