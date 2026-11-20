"""Normalisation and fact extraction: the layer every rule depends on."""
from sherlock_core.correlation import extract_entities, facts_for, norm


def _values(ff, kind):
    return {(f.platform, f.value) if kind == "handle" else f.value for f in ff.of(kind)}


# ----------------------------------------------------------------------------- norm
def test_dropbox_url_is_not_a_twitter_handle():
    # legacy matched the substring "x.com/" inside "dropbox.com/"
    assert norm.handle_from_url("https://www.dropbox.com/s/abc123/file.pdf") is None
    assert norm.handle_from_url("https://notx.com/edith") is None
    assert norm.handle_from_url("https://x.com/Edith") == ("twitter", "edith")
    assert norm.handle_from_url("twitter.com/@edith/") == ("twitter", "edith")


def test_reserved_path_words_are_not_handles():
    for url in ("https://youtube.com/channel", "https://twitter.com/intent/tweet?text=hi",
                "https://twitter.com/share", "https://x.com/home", "https://instagram.com/p/Cabc/",
                "https://t.me/s/somechannel", "https://linkedin.com/company/acme",
                "https://reddit.com/r/python", "https://github.com/", "https://youtu.be/dQw4w9WgXcQ",
                "https://imdb.com/title/tt0111161", "https://medium.com/some-publication"):
        assert norm.handle_from_url(url) is None, url
    assert norm.handle_from_url("https://youtube.com/@edith") == ("youtube", "edith")
    assert norm.handle_from_url("https://youtube.com/channel/UCkgdJXUOWG") == ("youtube", "UCkgdJXUOWG")
    assert norm.handle_from_url("https://www.linkedin.com/in/edith-finch/") == ("linkedin", "edith-finch")
    assert norm.handle_from_url("https://old.reddit.com/user/edith") == ("reddit", "edith")


def test_canonical_platform_aliases_cover_names_and_hosts():
    assert {norm.canonical_platform(n) for n in ("X", "x", "Twitter", "x.com", "www.twitter.com",
                                                 "scraped:x.com", "X (Twitter)")} == {"twitter"}
    assert norm.canonical_platform("GitHub") == norm.canonical_platform("scraped:github.com") == "github"
    assert norm.canonical_platform("hudson-rock") == "hudsonrock"
    assert norm.canonical_platform("scraped:www.edith.dev") == "edith.dev"
    assert norm.canonical_platform(None) == ""


def test_url_normalisation():
    same = {norm.norm_url(u) for u in (
        "https://www.Edith.dev/about/", "http://edith.dev/about", "edith.dev/about#team",
        "https://edith.dev/about?utm_source=tw&fbclid=1",
    )}
    assert same == {"edith.dev/about"}
    assert norm.norm_url("https://a.io/p?b=2&a=1") == "a.io/p?a=1&b=2"
    for junk in (None, 5, "", "not a url", "mailto:a@b.c", "javascript:void(0)", "http://"):
        assert norm.norm_url(junk) is None


def test_email_normalisation():
    assert norm.norm_email(" Edith@Acme.IO. ") == "edith@acme.io"
    assert norm.norm_email("mailto:Edith@acme.io?subject=hi") == "edith@acme.io"
    for junk in (None, 1, "edith", "edith@", "1+noreply@users.noreply.github.com", "noreply@acme.io"):
        assert norm.norm_email(junk) is None


def test_handles_from_free_text_need_an_explicit_pattern():
    text = "Maker. Twitter: @edith_real, find me as @edith.ig on Instagram or github.com/edith-dev"
    assert norm.handles_from_text(text) == [("twitter", "edith_real"), ("instagram", "edith.ig")]
    assert norm.find_bare_profile_urls(text) == ["github.com/edith-dev"]
    # bare words, emails and prose never become handles
    for prose in ("I love twitter and instagram", "twitter is great", "mail ig@acme.io", "github: see below",
                  "Follow me on twitter"):
        assert norm.handles_from_text(prose) == [], prose


def test_phash_helpers():
    assert norm.norm_phash("0xFFEE000011112222") == "ffee000011112222"
    assert norm.norm_phash("0" * 16) is None and norm.norm_phash("xyz") is None and norm.norm_phash(None) is None
    assert norm.hamming_hex("ffee000011112222", "ffee000011112223") == 1


# ----------------------------------------------------------------------------- facts
def test_user_scanner_site_row(S):
    ff = facts_for(S.site("Edith", "GitHub", {
        "name": "Edith Finch", "bio": "Engineer. Twitter: @edith_tw https://edith.dev",
        "location": "Lisbon", "email": "Edith@Acme.io", "blog": "edith.dev/", "twitter": "@Edith_TW",
        "followers": 12, "hireable": True,
    }, url="https://github.com/Edith"))
    assert ff.kind == "account" and ff.platform == "github" and ff.handle == "edith"
    assert ff.url == "github.com/Edith" and ff.account == ("github", "edith")
    assert _values(ff, "email") == {"edith@acme.io"}
    assert _values(ff, "url") == {"edith.dev"}
    assert _values(ff, "handle") == {("twitter", "edith_tw")}
    assert _values(ff, "display_name") == {"edith finch"}
    assert _values(ff, "location") == {"lisbon"}
    assert [f.field for f in ff.of("bio")] == ["extra.bio"]


def test_bio_is_read_from_the_bio_field_not_the_first_long_string(S):
    # legacy `_bio` returned the first long string in extra: a full name or a page title
    ff = facts_for(S.site("edith", "GitHub", {"fullname": "Edith Margaret Finch", "title": "Edith on GitHub",
                                              "about": "Kite designer from Lisbon"}))
    assert _values(ff, "bio") == {"kite designer from lisbon"}
    assert facts_for(S.site("edith", "GitHub", {"fullname": "Edith Margaret Finch"})).of("bio") == []


def test_display_name_echoing_the_handle_is_dropped(S):
    assert facts_for(S.site("edith", "GitHub", {"name": "Edith"})).of("display_name") == []


def test_hudson_rock_is_an_infostealer_fact_not_a_platform(S):
    ff = facts_for(S.hudson("edith@acme.io", family="RedLine"))
    assert ff.kind == "infostealer" and ff.handle == "" and ff.account is None
    (fact,) = ff.of("breach")
    assert fact.value.startswith("infostealer:redline") and fact.subject == "edith@acme.io"
    # a username looked up on hudson-rock is not an account either
    assert facts_for(S.hudson("edith", itype="username")).handle == ""


def test_xposedornot_breach_row(S):
    ff = facts_for(S.breach("Edith@Acme.io", "Adobe"))
    (fact,) = ff.facts
    assert (ff.kind, fact.kind, fact.value, fact.raw, fact.subject) == ("breach", "breach", "adobe", "Adobe",
                                                                       "edith@acme.io")


def test_gravatar_row(S):
    ff = facts_for(S.gravatar("edith@acme.io", username="edithf", fullname="Edith Finch", bio="Kites, mostly.",
                              location="Lisbon", image="https://gravatar.com/avatar/0",
                              emails="edith@acme.io, e.finch@proton.me",
                              links="https://twitter.com/edith_tw, https://edith.dev"))
    assert ff.email == "edith@acme.io" and ff.account == ("gravatar", "edithf") and ff.is_rich
    assert _values(ff, "email") == {"edith@acme.io", "e.finch@proton.me"}
    assert _values(ff, "url") == {"twitter.com/edith_tw", "edith.dev"}
    assert _values(ff, "handle") == {("twitter", "edith_tw")}


def test_spiderfoot_rows(S):
    assert _values(facts_for(S.spiderfoot("acme.io", "EMAILADDR", "Edith@acme.io")), "email") == {"edith@acme.io"}
    ff = facts_for(S.spiderfoot("acme.io", "EMAILADDR_COMPROMISED", "edith@acme.io [Adobe]"))
    assert ff.platform == "spiderfoot"
    assert [(f.value, f.subject) for f in ff.of("breach")] == [("adobe", "edith@acme.io")]
    ff = facts_for(S.spiderfoot("acme.io", "SOCIAL_MEDIA", "Twitter: <SFURL>https://twitter.com/edith_tw</SFURL>"))
    assert _values(ff, "handle") == {("twitter", "edith_tw")}
    assert facts_for(S.spiderfoot("acme.io", "RAW_RIR_DATA", "{}")).facts == []


def test_firecrawl_in_page_fields_become_facts(S):
    ff = facts_for(S.scrape(
        "https://edith.dev/about", description="Edith Finch designs kites in Lisbon.",
        emails="Edith@acme.io, press@edith.dev", handles="@edith_tw, @someone",
        urls="https://github.com/edith, https://www.dropbox.com/s/abc/cv.pdf",
    ))
    assert ff.kind == "scrape" and ff.platform == "edith.dev" and ff.url == "edith.dev/about"
    assert _values(ff, "email") == {"edith@acme.io", "press@edith.dev"}
    assert _values(ff, "url") == {"github.com/edith", "dropbox.com/s/abc/cv.pdf"}
    # github link -> github handle; dropbox link -> nothing; bare @mentions have no platform
    assert _values(ff, "handle") == {("github", "edith"), ("", "edith_tw"), ("", "someone")}
    assert _values(ff, "bio") == {"edith finch designs kites in lisbon."}
    assert ff.of("display_name") == []          # a page title is not a display name


def test_scrape_of_a_profile_is_the_same_account_as_the_profile(S):
    scrape = facts_for(S.scrape("https://github.com/Edith"))
    profile = facts_for(S.site("edith", "GitHub", {}, url="https://api.github.com/users/edith"))
    assert scrape.account == profile.account == ("github", "edith")
    assert scrape.identity == profile.identity


def test_v2_canonical_row(S):
    ff = facts_for(S.v2("username", "edith", "x.com", {
        "fullname": "Edith Finch", "bio": "Kite designer from Lisbon", "emails": ["a@b.io", "c@d.io"],
        "links": "https://edith.dev, https://github.com/edith", "avatar_phash": "FFEE000011112222",
    }, url="https://x.com/edith"))
    assert ff.platform == "twitter" and ff.account == ("twitter", "edith")
    assert _values(ff, "email") == {"a@b.io", "c@d.io"}
    assert _values(ff, "handle") == {("github", "edith")}
    assert _values(ff, "avatar_hash") == {"ffee000011112222"}


def test_odd_data_never_raises(S):
    rows = [
        S.site("edith", "GitHub", None),
        S.site("edith", "GitLab", {"bio": 5, "email": ["a@b.io", None, 3, {"x": "c@d.io"}], "links": {"a": 1},
                                   "name": ["x"], "twitter": 12, "avatar_phash": 1.5, "location": None}),
        {**S.site("edith", "X"), "extra_metadata": None},
        {**S.site("edith", "Y"), "extra_metadata": "oops"},
        {**S.site("edith", "Z"), "extra_metadata": {"extra": "oops", "url": 7, "media": []}},
        {**S.site(None, None), "source_tool": None},
        {**S.breach("a@b.io", "Adobe"), "extra_metadata": {"breach_name": ["x"]}},
        {**S.hudson("a@b.io"), "extra_metadata": {"stealer_family": None, "date_compromised": None}},
        {**S.spiderfoot("a.io", "EMAILADDR", None)},
        S.scrape("https://edith.dev", emails=["a@b.io"], handles=5, urls={"k": "https://a.io"}),
    ]
    for r in rows:
        assert facts_for(r) is not None
    assert facts_for("nope") is None and facts_for({"status": "found"}) is None
    assert _values(facts_for(rows[1]), "email") == {"a@b.io", "c@d.io"}


def test_extract_entities(S):
    rows = [
        S.site("edith", "GitHub", {"email": "Edith@Acme.io", "blog": "https://edith.dev", "twitter": "edith_tw",
                                   "links": "https://linktr.ee, https://github.com/login"},
               url="https://github.com/edith"),
        S.scrape("https://edith.dev", emails="edith@acme.io, e.finch@gmail.com", handles="@edith_tw"),
        S.site("ghost", "GitLab", {"email": "ghost@nowhere.io"}, status="not_found"),
        S.gravatar("seed@acme.io", emails="seed@acme.io"),
    ]
    ents = extract_entities(rows)
    got = {(e["kind"], e["value"], e["platform"]) for e in ents}
    # edith.dev was scraped (scanned) already, and seed@acme.io was searched: neither is suggested
    assert got == {
        ("email", "edith@acme.io", None), ("domain", "acme.io", None),
        ("domain", "edith.dev", None), ("username", "edith_tw", "twitter"), ("email", "e.finch@gmail.com", None),
    }
    assert len(ents) == len({(e["kind"], e["value"]) for e in ents})          # store key is (kind, value)
    assert all(set(e) == {"kind", "value", "platform", "source_finding_id"} for e in ents)
    assert next(e for e in ents if e["kind"] == "username")["source_finding_id"] == rows[0]["id"]
    # without the scrape row the link is new again, with its provenance
    ents = extract_entities([rows[0]])
    assert next(e for e in ents if e["kind"] == "url")["source_finding_id"] == rows[0]["id"]
    # a username that was itself scanned (even with no hit) is never suggested back
    probe = S.site("edith_tw", "X", {}, status="not_found")
    assert ("username", "edith_tw") not in {(e["kind"], e["value"]) for e in extract_entities([rows[0], probe])}
