"""Name searches: `hints` pass-through, GET /cases/{id}/candidates, POST .../candidates/{cid}/confirm."""
from gateway.schemas import CandidateConfirmed, CandidatesOut
from sherlock_core.models import make_finding
from sherlock_core.modules.person_util import person_extra

NAME = "Ada Lovelace"
HINTS = {"city": "London", "employer": "Analytical Engines Ltd", "keywords": ["mathematics"]}


def _person(case_id, fid, platform, url, **kw):
    kw.setdefault("fullname", NAME)
    return make_finding(case_id=case_id, identifier_type="name", identifier_value=NAME, source_tool=f"person_{platform}",
                        platform=platform, url=url, extra=person_extra(**kw), discriminator=fid)


def _seed(store, case_id):
    rows = [
        _person(case_id, "wd", "wikidata", "https://www.wikidata.org/wiki/Q7259",
                ids={"wikidata": "Q7259", "orcid": "0000-0001-2345-6789"}, handles={"github": "adalove"},
                links=["https://github.com/adalove", "https://ada.example.org/about"], description="English mathematician"),
        _person(case_id, "or", "orcid", "https://orcid.org/0000-0001-2345-6789", ids={"orcid": "0000-0001-2345-6789"},
                employers=["Analytical Engines Ltd"], locations=["London, GB"], emails=["ada@lovelace.dev"]),
        _person(case_id, "gh", "github", "https://github.com/adalove", kind="profile", handles={"github": "adalove"}),
        _person(case_id, "gh2", "github", "https://github.com/ada-baker", kind="profile", handles={"github": "ada-baker"},
                employers=["Corner Bakery"], locations=["Melbourne, Australia"]),
        make_finding(case_id=case_id, identifier_type="name", identifier_value=NAME, source_tool="person_orcid",
                     platform="orcid", status="error", meta={"reason": "HTTP 429"}),
        make_finding(case_id=case_id, identifier_type="username", identifier_value="adalove", source_tool="handles",
                     platform="gitlab", url="https://gitlab.com/adalove"),
    ]
    return store.upsert_findings(rows, case_id)


def _name_case(client, headers, hints=HINTS):
    body = {"identifiers": [{"type": "name", "value": "  Ada   Lovelace "}]}
    if hints is not None:
        body["hints"] = hints
    r = client.post("/cases", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


# ------------------------------------------------------------------ hints
def test_create_case_passes_hints_to_name_jobs_and_audits_the_search(client, store, as_user):
    created = _name_case(client, as_user)
    cid = created["case"]["id"]
    assert created["jobs"] and all(j["params"] == HINTS for j in created["jobs"])
    assert all(j["target_value"] == NAME for j in created["jobs"])
    [audit] = [a for a in store.list_audit(cid) if a["action"] == "name_search"]
    assert audit["detail"]["user"] == "00000000-0000-4000-8000-00000000000b"
    assert audit["detail"]["value"] == NAME and audit["detail"]["hints"] == HINTS


def test_scan_passes_hints_and_drops_empty_ones(client, store, make_case, as_user):
    cid = make_case(headers=as_user, scan=False)["case"]["id"]
    r = client.post(f"/cases/{cid}/scan", headers=as_user,
                    json={"type": "name", "value": NAME, "hints": {"city": " Oxford ", "employer": "", "keywords": []}})
    assert r.status_code == 202, r.text
    assert all(j["params"] == {"city": "Oxford"} for j in r.json()["jobs"])
    plain = client.post(f"/cases/{cid}/scan", headers=as_user, json={"type": "name", "value": "Grace Hopper"})
    assert all(j["params"] == {} for j in plain.json()["jobs"])
    assert len([a for a in store.list_audit(cid) if a["action"] == "name_search"]) == 2


def test_hints_are_validated(client, make_case, as_user):
    cid = make_case(headers=as_user, scan=False)["case"]["id"]
    wrong_type = client.post(f"/cases/{cid}/scan", headers=as_user,
                             json={"type": "username", "value": "octocat", "hints": {"city": "Oxford"}})
    assert wrong_type.status_code == 400 and "name" in wrong_type.json()["detail"]
    for bad in ({"street": "1 High St"}, {"phone": "+441234"}, {"city": "x" * 121}, {"keywords": ["k"] * 9}):
        r = client.post(f"/cases/{cid}/scan", headers=as_user, json={"type": "name", "value": NAME, "hints": bad})
        assert r.status_code == 422, bad
    no_name = client.post("/cases", headers=as_user, json={
        "identifiers": [{"type": "username", "value": "octocat"}], "hints": {"city": "Oxford"}})
    assert no_name.status_code == 400


def test_anonymous_sessions_cannot_search_names_even_with_hints(client, store, make_case, as_anon):
    cid = make_case()["case"]["id"]
    r = client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "name", "value": NAME, "hints": HINTS})
    assert r.status_code == 403
    r = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "name", "value": NAME}], "hints": HINTS})
    assert r.status_code == 403
    assert not [a for a in store.list_audit(cid) if a["action"] == "name_search"]


# ------------------------------------------------------------------ GET candidates
def test_candidates_are_resolved_from_the_name_findings(client, store, as_user):
    cid = _name_case(client, as_user)["case"]["id"]
    rows = _seed(store, cid)
    r = client.get(f"/cases/{cid}/candidates", headers=as_user)
    assert r.status_code == 200, r.text
    body = r.json()
    CandidatesOut.model_validate(body)
    assert body["name"] == NAME and body["hints"] == HINTS
    ids = {row["extra_metadata"].get("url"): row["id"] for row in rows}
    first, second = body["candidates"]
    assert set(first["finding_ids"]) == {ids["https://www.wikidata.org/wiki/Q7259"], ids["https://orcid.org/0000-0001-2345-6789"],
                                        ids["https://github.com/adalove"]}
    assert second["finding_ids"] == [ids["https://github.com/ada-baker"]]
    assert first["score"] > second["score"]
    assert any("Employer hint 'Analytical Engines Ltd' matches" in e for e in first["evidence"])   # stored hints used
    assert set(first) == {"candidate_id", "label", "score", "evidence", "finding_ids", "attributes", "related"}
    assert first["attributes"]["handles"] == [{"platform": "github", "handle": "adalove"}]
    assert body["unassigned_finding_ids"] == []
    assert client.get(f"/cases/{cid}/candidates", headers=as_user).json() == body              # deterministic
    assert client.get(f"/cases/{cid}/candidates", headers=as_user, params={"name": "ada lovelace"}).status_code == 404


def test_candidates_auth_ownership_and_missing_search(client, store, make_case, as_user, as_other):
    cid = _name_case(client, as_user)["case"]["id"]
    assert client.get(f"/cases/{cid}/candidates").status_code == 401
    assert client.get(f"/cases/{cid}/candidates", headers=as_other).status_code == 403
    assert client.get(f"/cases/{cid}/candidates", headers=as_user).json()["candidates"] == []
    plain = make_case(headers=as_user, scan=False)["case"]["id"]
    r = client.get(f"/cases/{plain}/candidates", headers=as_user)
    assert r.status_code == 404 and r.json() == {"detail": "this case has no name search"}
    assert client.get("/cases/not-a-uuid/candidates", headers=as_user).status_code == 404

    demo = store.create_case([{"type": "name", "value": NAME}], owner_id=None, title="Demo")
    store.cases[demo["id"]]["is_demo"] = True
    _seed(store, demo["id"])
    r = client.get(f"/cases/{demo['id']}/candidates", headers=as_other)
    assert r.status_code == 200 and len(r.json()["candidates"]) == 2 and r.json()["hints"] == {}


# ------------------------------------------------------------------ confirm
def test_confirm_adds_pivot_entities_and_starts_no_scan(client, store, as_user, woken):
    created = _name_case(client, as_user)
    cid = created["case"]["id"]
    _seed(store, cid)
    top = client.get(f"/cases/{cid}/candidates", headers=as_user).json()["candidates"][0]
    jobs_before, woken_before = len(store.list_jobs(cid)), list(woken)

    r = client.post(f"/cases/{cid}/candidates/{top['candidate_id']}/confirm", headers=as_user)
    assert r.status_code == 200, r.text
    body = r.json()
    CandidateConfirmed.model_validate(body)
    assert body["candidate"]["candidate_id"] == top["candidate_id"]
    got = {(e["kind"], e["value"], e["platform"]) for e in body["entities"]}
    assert ("username", "adalove", "github") in got
    assert ("email", "ada@lovelace.dev", None) in got
    assert ("domain", "ada.example.org", None) in got
    assert ("url", "https://ada.example.org/about", None) in got
    assert all(not e["scanned"] and not e["is_seed"] and e["source_finding_id"] in top["finding_ids"]
               for e in body["entities"])
    assert len(store.list_jobs(cid)) == jobs_before and woken == woken_before     # no scan started

    [audit] = [a for a in store.list_audit(cid) if a["action"] == "candidate_confirmed"]
    assert audit["detail"]["user"] == "00000000-0000-4000-8000-00000000000b"
    assert audit["detail"]["candidate_id"] == top["candidate_id"] and audit["detail"]["name"] == NAME
    assert {(e["kind"], e["value"]) for e in audit["detail"]["entities"]} == {(k, v) for k, v, _ in got}

    again = client.post(f"/cases/{cid}/candidates/{top['candidate_id']}/confirm", headers=as_user)
    assert again.status_code == 200 and again.json()["entities"] == []           # already there


def test_confirm_rules(client, store, make_case, as_user, as_other, as_anon):
    cid = _name_case(client, as_user)["case"]["id"]
    _seed(store, cid)
    top = client.get(f"/cases/{cid}/candidates", headers=as_user).json()["candidates"][0]["candidate_id"]
    assert client.post(f"/cases/{cid}/candidates/c_000000000000/confirm", headers=as_user).status_code == 404
    assert client.post(f"/cases/{cid}/candidates/{top}/confirm", headers=as_other).status_code == 403
    assert client.post(f"/cases/{cid}/candidates/{top}/confirm").status_code == 401

    demo = store.create_case([{"type": "name", "value": NAME}], owner_id=None, title="Demo")
    store.cases[demo["id"]]["is_demo"] = True
    _seed(store, demo["id"])
    demo_top = client.get(f"/cases/{demo['id']}/candidates", headers=as_user).json()["candidates"][0]["candidate_id"]
    assert client.post(f"/cases/{demo['id']}/candidates/{demo_top}/confirm", headers=as_user).status_code == 403

    anon_case = store.create_case([{"type": "name", "value": NAME}], owner_id="00000000-0000-4000-8000-00000000000a")
    _seed(store, anon_case["id"])
    anon_top = client.get(f"/cases/{anon_case['id']}/candidates", headers=as_anon).json()["candidates"][0]["candidate_id"]
    assert client.post(f"/cases/{anon_case['id']}/candidates/{anon_top}/confirm", headers=as_anon).status_code == 403
