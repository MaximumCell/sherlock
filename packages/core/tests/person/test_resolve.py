"""Candidate resolution: findings of a name search -> distinct people, ranked and explained."""
import itertools
import random

import pytest
from sherlock_core.models import make_finding
from sherlock_core.modules.person_util import person_extra
from sherlock_core.resolve import match_name, name_tokens, resolve_candidates, unassigned_finding_ids
from sherlock_core.resolve.names import SINGLE_TOKEN, best_match, text_mentions_name

NAME = "Ada Lovelace"


def rec(fid, platform, url, *, status="found", module=None, **kw):
    """A person-module finding with an id, built exactly as the modules build them."""
    kw.setdefault("fullname", NAME)
    f = make_finding(case_id="c1", identifier_type="name", identifier_value=NAME, source_tool=module or f"person_{platform}",
                     platform=platform, status=status, url=url, extra=person_extra(**kw), discriminator=fid)
    f["id"] = fid
    return f


def web(fid, url, kind, title, snippet="", **kw):
    kw.setdefault("fullname", NAME)
    f = make_finding(case_id="c1", identifier_type="name", identifier_value=NAME, source_tool="person_web",
                     platform="web", url=url, discriminator=fid,
                     extra=person_extra(kind=kind, title=title, snippet=snippet, result_kind=kind, **kw))
    f["id"] = fid
    return f


def one_person_four_sources():
    return [
        rec("wd", "wikidata", "https://www.wikidata.org/wiki/Q7259", ids={"wikidata": "Q7259", "orcid": "0000-0001-2345-6789"},
            handles={"github": "adalove"}, employers=["Analytical Engines Ltd"], topics=["mathematician"],
            description="English mathematician", links=["https://github.com/adalove", "https://ada.example.org"]),
        rec("or", "orcid", "https://orcid.org/0000-0001-2345-6789", ids={"orcid": "0000-0001-2345-6789"},
            fullname="Augusta Ada King", aliases=["Ada Lovelace"], employers=["Analytical Engines Ltd"],
            locations=["London, GB"]),
        rec("oa", "openalex", "https://openalex.org/A1", ids={"openalex": "A1", "orcid": "0000-0001-2345-6789"},
            fullname="A. Lovelace", aliases=["Ada Lovelace"], topics=["Computing"], locations=["GB"]),
        rec("gh", "github", "https://github.com/adalove", kind="profile", handles={"github": "adalove"},
            locations=["London"], employers=["Analytical Engines Ltd"]),
    ]


def other_ada():
    return [
        rec("gh2", "github", "https://github.com/ada-l", kind="profile", handles={"github": "ada-l"},
            employers=["Corner Bakery"], locations=["Melbourne, Australia"]),
        web("li2", "https://au.linkedin.com/in/ada-lovelace-baker", "profile", "Ada Lovelace - Corner Bakery | LinkedIn",
            handles={"linkedin": "ada-lovelace-baker"}, employers=["Corner Bakery"], locations=["Melbourne"]),
    ]


def _by(cands, fid):
    return next(c for c in cands if fid in c.finding_ids)


# ------------------------------------------------------------------ names
@pytest.mark.parametrize("a,b,kind", [
    ("Tim Berners-Lee", "Berners-Lee, Tim", "exact"),
    ("Tim Berners-Lee", "TIM BERNERS LEE", "exact"),
    ("Tim Berners-Lee", "Tim Berners‐Lee", "exact"),               # U+2010 hyphen (OpenAlex)
    ("Tim Berners-Lee", "Sir Tim Berners-Lee", "exact"),
    ("José García", "jose garcia", "exact"),
    ("Tim Berners-Lee", "Tim John Berners-Lee", "middle-name"),
    ("Tim Berners-Lee", "Tim J. Berners-Lee", "middle-name"),
    ("Tim Berners-Lee", "Timothy Berners-Lee", "short-form"),
    ("Tim Berners-Lee", "T. Berners-Lee", "initials"),
])
def test_name_variants_match(a, b, kind):
    m = match_name(a, b)
    assert m.kind == kind and m.score >= 0.5
    assert match_name(b, a) == m                                     # symmetric


def test_name_scores_are_ordered():
    s = {b: match_name("Tim Berners-Lee", b).score for b in
         ("Tim Berners-Lee", "Tim John Berners-Lee", "Timothy Berners-Lee", "T. Berners-Lee", "Tim")}
    assert s["Tim Berners-Lee"] == 1.0
    assert 1.0 > s["Tim John Berners-Lee"] > s["T. Berners-Lee"] > s["Tim"]
    assert s["Timothy Berners-Lee"] > s["T. Berners-Lee"]


def test_common_single_token_is_penalised_and_mismatches_score_zero():
    single = match_name("Ada Lovelace", "Ada")
    assert single.kind == SINGLE_TOKEN and single.score <= 0.25
    assert match_name("Ada Lovelace", "Ada Smith").score == 0
    assert match_name("Ada Lovelace", "A. L.").score == 0           # initials alone prove nothing
    assert match_name("", "Ada").score == 0
    assert best_match("Ada Lovelace", ["Ada", "Lovelace, Ada"])[1] == "Lovelace, Ada"
    assert name_tokens("Lovelace, Dr Ada (Countess)") == ["ada", "lovelace"]
    assert text_mentions_name("Ada Lovelace", "A talk by LOVELACE, Ada.") and not text_mentions_name(NAME, "Ada L.")


# ------------------------------------------------------------------ clustering
def test_one_person_across_four_sources_merges():
    [c] = resolve_candidates(one_person_four_sources(), NAME)
    assert sorted(c.finding_ids) == ["gh", "oa", "or", "wd"]
    assert c.attributes["sources"] == ["wikidata", "orcid", "openalex", "github"]
    assert c.attributes["identifiers"]["orcid"] == "0000-0001-2345-6789"
    assert c.attributes["identifiers"]["wikidata"] == "Q7259"
    assert {"platform": "github", "handle": "adalove"} in c.attributes["handles"]
    assert c.attributes["employers"] == ["Analytical Engines Ltd"]
    assert "London, GB" in c.attributes["locations"]
    assert c.attributes["domains"] == ["ada.example.org"]
    assert c.score >= 0.7
    joined = "\n".join(c.evidence)
    assert "same ORCID iD 0000-0001-2345-6789" in joined and "same GitHub account 'adalove'" in joined
    assert "Confirmed by 4 independent sources" in joined
    assert c.label == "Ada Lovelace (English mathematician)"


def test_two_people_with_the_same_name_stay_separate():
    cands = resolve_candidates(one_person_four_sources() + other_ada(), NAME)
    assert sorted(cands[0].finding_ids) == ["gh", "oa", "or", "wd"]
    assert sorted(c.finding_ids[0] for c in cands[1:]) == ["gh2", "li2"]
    assert len({c.candidate_id for c in cands}) == 3
    assert cands[0].score > cands[1].score


def test_same_name_alone_never_merges():
    cands = resolve_candidates(other_ada(), NAME)
    assert len(cands) == 2                                         # GitHub ada-l and LinkedIn: no strong key shared
    assert all(c.score < 0.5 for c in cands)
    assert any("Shares employer 'Corner Bakery'" in e for c in cands for e in c.evidence)   # weak signal, reported


def test_cross_link_merges_only_when_the_names_agree():
    gh = rec("gh", "github", "https://github.com/adalove", kind="profile", handles={"github": "adalove"})
    linking = rec("or", "orcid", "https://orcid.org/0000-0001-2345-6789", ids={"orcid": "0000-0001-2345-6789"},
                  links=["https://github.com/adalove"])
    [merged] = resolve_candidates([gh, linking], NAME)
    assert "The ORCID record links to the GitHub account 'adalove' found on GitHub" in "\n".join(merged.evidence)
    stranger = rec("or2", "orcid", "https://orcid.org/0000-0009-9999-9999", ids={"orcid": "0000-0009-9999-9999"},
                   fullname="Charles Babbage", links=["https://github.com/adalove"])
    assert len(resolve_candidates([gh, stranger], NAME)) == 2


def test_linking_to_the_same_third_page_does_not_merge():
    a = rec("a", "orcid", "https://orcid.org/0000-0001-0000-0001", ids={"orcid": "0000-0001-0000-0001"},
            links=["https://www.example-university.edu/"])
    b = rec("b", "orcid", "https://orcid.org/0000-0001-0000-0002", ids={"orcid": "0000-0001-0000-0002"},
            links=["https://www.example-university.edu/"])
    assert len(resolve_candidates([a, b], NAME)) == 2


def test_same_profile_url_from_two_modules_merges():
    gh = rec("gh", "github", "https://github.com/adalove", kind="profile", handles={"github": "adalove"})
    hit = web("w", "https://github.com/adalove", "profile", "adalove (Ada Lovelace) · GitHub", handles={"github": "adalove"})
    [c] = resolve_candidates([gh, hit], NAME)
    assert sorted(c.finding_ids) == ["gh", "w"]
    assert c.attributes["sources"] == ["github"]                   # the same site twice is one source


def test_wikidata_qid_and_handle_case_are_normalised():
    a = rec("a", "wikidata", "https://www.wikidata.org/wiki/Q7259", ids={"wikidata": "Q7259"}, handles={"twitter": "AdaLove"})
    b = web("b", "https://x.com/adalove", "profile", "Ada Lovelace (@adalove) / X", handles={"twitter": "adalove"})
    assert len(resolve_candidates([a, b], NAME)) == 1


# ------------------------------------------------------------------ scoring
def test_hints_change_the_ranking():
    findings = [
        rec("p1", "github", "https://github.com/ada-one", kind="profile", handles={"github": "ada-one"},
            employers=["Acme Corp"], locations=["Paris, France"]),
        rec("p2", "github", "https://github.com/ada-two", kind="profile", handles={"github": "ada-two"},
            employers=["Globex"], locations=["Oslo, Norway"]),
    ]
    base = resolve_candidates(findings, NAME)
    assert base[0].score == base[1].score
    by_employer = resolve_candidates(findings, NAME, {"employer": "Globex"})
    assert by_employer[0].finding_ids == ["p2"]
    assert any("Employer hint 'Globex' matches 'Globex'" in e for e in by_employer[0].evidence)
    assert any("not among stated employers" in e for e in by_employer[1].evidence)
    by_city = resolve_candidates(findings, NAME, {"city": "Paris"})
    assert by_city[0].finding_ids == ["p1"] and by_city[0].score > by_city[1].score
    by_kw = resolve_candidates(findings + [rec("p3", "openalex", "https://openalex.org/A9", ids={"openalex": "A9"},
                                               topics=["Number theory"])], NAME, {"keywords": ["number theory"]})
    assert by_kw[0].finding_ids == ["p3"]


def test_no_evidence_gives_a_low_score():
    lone = rec("x", "github", "https://github.com/someada", kind="profile", handles={"github": "someada"},
               fullname="A. Lovelace")
    [c] = resolve_candidates([lone], NAME)
    assert c.score < 0.3
    assert any("one source only" in e for e in c.evidence)
    assert any("initials" in e for e in c.evidence)


def test_more_independent_evidence_scores_higher():
    full = resolve_candidates(one_person_four_sources(), NAME)[0].score
    two = resolve_candidates(one_person_four_sources()[:2], NAME)[0].score
    one = resolve_candidates(one_person_four_sources()[:1], NAME)[0].score
    assert 0 <= one < two < full <= 1


def test_every_contribution_is_explained_in_plain_english():
    [c] = resolve_candidates(one_person_four_sources(), NAME, {"employer": "Analytical Engines", "city": "London"})
    assert all(isinstance(e, str) and e and not e.startswith("{") for e in c.evidence)
    assert any(e.startswith("Name 'Ada Lovelace'") for e in c.evidence)
    assert any("City hint 'London' matches location" in e for e in c.evidence)
    assert any("Employer hint 'Analytical Engines' matches" in e for e in c.evidence)


# ------------------------------------------------------------------ mentions and inputs
def test_mentions_attach_to_the_only_fitting_candidate():
    news = web("n1", "https://www.bbc.co.uk/news/1", "news", "Ada Lovelace of Analytical Engines Ltd speaks",
               "Ada Lovelace, of Analytical Engines Ltd, said...")
    vague = web("n2", "https://blog.example.org/post", "mention", "Ada Lovelace", "A post that names Ada Lovelace.")
    findings = one_person_four_sources() + other_ada() + [news, vague]
    cands = resolve_candidates(findings, NAME)
    assert "n1" in _by(cands, "wd").finding_ids
    assert unassigned_finding_ids(findings, cands) == ["n2"]
    assert any("mention the name together with 'Analytical Engines Ltd'" in e for e in _by(cands, "wd").evidence)


def test_a_handle_that_only_spells_the_name_does_not_capture_mentions():
    li = web("li", "https://www.linkedin.com/in/ada-lovelace", "profile", "Ada Lovelace | LinkedIn",
             handles={"linkedin": "ada-lovelace"})
    page = web("m", "https://example.org/a", "mention", "About Ada Lovelace", "ada-lovelace ada lovelace")
    cands = resolve_candidates([li, page], NAME)
    assert cands[0].finding_ids == ["li"]


def test_non_found_and_foreign_rows_are_ignored():
    err = rec("e", "orcid", None, status="error")
    nf = rec("n", "github", "https://github.com/x", status="not_found")
    other = make_finding(case_id="c1", identifier_type="username", identifier_value="x", source_tool="handles",
                         platform="github", url="https://github.com/x")
    other["id"] = "u"
    assert resolve_candidates([err, nf, other, None, "junk"], NAME) == []      # type: ignore[list-item]
    assert resolve_candidates([], NAME, None) == []


def test_locations_stay_city_level():
    f = rec("x", "github", "https://github.com/a1", kind="profile", handles={"github": "a1"},
            locations=["12 Sample Street, London", "London, GB"])
    [c] = resolve_candidates([f], NAME)
    assert c.attributes["locations"] == ["London, GB"]


# ------------------------------------------------------------------ determinism
def test_deterministic_and_order_independent():
    findings = one_person_four_sources() + other_ada() + [
        web("n1", "https://www.bbc.co.uk/news/1", "news", "Ada Lovelace at Corner Bakery", "Corner Bakery owner Ada Lovelace"),
    ]
    hints = {"city": "Melbourne"}
    expected = [c.to_dict() for c in resolve_candidates(findings, NAME, hints)]
    rng = random.Random(7)
    for _ in range(25):
        shuffled = findings[:]
        rng.shuffle(shuffled)
        assert [c.to_dict() for c in resolve_candidates(shuffled, NAME, hints)] == expected
    assert expected == sorted(expected, key=lambda c: (-c["score"], -len(c["finding_ids"]), c["candidate_id"]))


def test_candidate_id_is_stable_and_follows_the_strongest_key():
    four = one_person_four_sources()
    ids = {resolve_candidates(list(p), NAME)[0].candidate_id for p in itertools.permutations(four)}
    assert len(ids) == 1
    # adding or dropping weaker records does not change the id while the ORCID iD is present
    assert resolve_candidates(four[1:], NAME)[0].candidate_id in ids
    assert resolve_candidates(four[3:], NAME)[0].candidate_id not in ids    # GitHub only: a different key


def test_scores_are_bounded():
    many = one_person_four_sources() + [
        web(f"w{i}", f"https://{p}/adalove", "profile", f"Ada Lovelace on {p}", handles={k: "adalove"})
        for i, (p, k) in enumerate([("x.com", "twitter"), ("www.linkedin.com/in", "linkedin")])
    ]
    for c in resolve_candidates(many, NAME, {"employer": "Analytical Engines Ltd", "city": "London",
                                             "keywords": ["mathematician", "computing"]}):
        assert 0.0 <= c.score <= 1.0
