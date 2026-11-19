"""GET /cases/{id}/exposure: the deterministic exposure score, owner-checked."""
from gateway.schemas import ExposureOut
from sherlock_core.models import make_finding


def _seed(store, case_id):
    rows = [
        make_finding(case_id=case_id, identifier_type="username", identifier_value="octocat", source_tool="handles",
                     platform=p, url=f"https://{p}.example/octocat") for p in ("github", "gitlab")
    ] + [
        make_finding(case_id=case_id, identifier_type="email", identifier_value="octo@example.org",
                     source_tool="mailcheck", platform="breach", discriminator="Adobe",
                     meta={"breach_name": "Adobe", "breach_date": "2013-10-04", "data_classes": ["Passwords"]}),
    ]
    return store.upsert_findings(rows, case_id)


def test_exposure_returns_the_score_model(client, store, make_case, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    empty = client.get(f"/cases/{cid}/exposure", headers=as_anon)
    assert empty.status_code == 200
    assert empty.json()["score"] == 0 and empty.json()["factors"] == []

    github, gitlab, _ = _seed(store, cid)
    link = {"type": "shared_email", "corr_key": "k1", "matched_value": "octo@example.org",
            "entities_involved": [github["id"], gitlab["id"]], "confidence": 0.9, "evidence": [], "priority": 1.0}
    store.insert_correlation(link, cid)  # pending
    pending = client.get(f"/cases/{cid}/exposure", headers=as_anon).json()
    assert pending["computed_from"] == {"findings": 3, "approved_correlations": 0}

    store.insert_correlation({**link, "corr_key": "k2", "status": "approved"}, cid)
    r = client.get(f"/cases/{cid}/exposure", headers=as_anon)
    assert r.status_code == 200
    body = r.json()
    ExposureOut.model_validate(body)
    assert set(body) == {"score", "band", "factors", "computed_from", "method"}
    assert body["computed_from"] == {"findings": 3, "approved_correlations": 1}
    assert pending["score"] < body["score"] <= 100 and body["band"] in ("low", "moderate", "high", "severe")
    keys = {f["key"] for f in body["factors"]}
    assert {"breach_exposure", "account_footprint", "identity_linkability", "handle_reuse"} <= keys
    for f in body["factors"]:
        assert set(f) == {"key", "label", "points", "max_points", "detail", "evidence_finding_ids", "remediation"}
    assert client.get(f"/cases/{cid}/exposure", headers=as_anon).json() == body
    assert not [a for a in store.list_audit(cid) if "exposure" in a["action"]]  # a read, nothing is written


def test_exposure_auth_and_ownership(client, store, make_case, as_anon, as_other):
    cid = make_case(scan=False)["case"]["id"]
    assert client.get(f"/cases/{cid}/exposure").status_code == 401
    foreign = client.get(f"/cases/{cid}/exposure", headers=as_other)
    assert foreign.status_code == 403 and isinstance(foreign.json()["detail"], str)
    for missing in ("00000000-0000-4000-8000-000000000001", "not-a-uuid"):
        r = client.get(f"/cases/{missing}/exposure", headers=as_anon)
        assert r.status_code == 404 and r.json() == {"detail": "case not found"}

    demo = store.create_case([{"type": "username", "value": "demo"}], owner_id=None, title="Demo")
    store.cases[demo["id"]]["is_demo"] = True
    assert client.get(f"/cases/{demo['id']}/exposure", headers=as_other).status_code == 200  # demo: readable
