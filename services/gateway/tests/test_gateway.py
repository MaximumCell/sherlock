"""Gateway API contract (docs/CONTRACTS.md). Offline: MemoryStore, fake auth, fake modules."""
import pytest
from sherlock_core import config
from sherlock_core.models import make_finding


def _finding(store, case_id, platform, value="octocat"):
    f = make_finding(case_id=case_id, identifier_type="username", identifier_value=value,
                     source_tool="handles", platform=platform, url=f"https://{platform}.example/{value}")
    return store.upsert_findings([f], case_id)[0]


def _demo_case(store):
    case = store.create_case([{"type": "username", "value": "demo"}], owner_id=None, title="Demo")
    store.cases[case["id"]]["is_demo"] = True
    return case["id"]


# ----------------------------------------------------------------------------- meta
def test_health_and_modules_are_public(client):
    assert client.get("/health").json() == {"ok": True, "service": "sherlock-gateway"}
    mods = client.get("/modules").json()
    assert {m["name"] for m in mods} == {"handles", "mailcheck", "dns", "people"}
    assert all(m["available"] and m["queue"] in ("identity", "infra", "media") for m in mods)


def test_platforms_is_public_and_cacheable(client):
    r = client.get("/platforms")
    assert r.status_code == 200
    assert "public" in r.headers["cache-control"] and "max-age" in r.headers["cache-control"]
    entries = r.json()
    assert len(entries) >= 120
    gh = next(e for e in entries if e["key"] == "github")
    assert gh["label"] == "GitHub" and gh["domain"] == "github.com" and gh["category"] == "dev"
    assert "github.com" in gh["hosts"] and "github user" in gh["aliases"]
    assert {e["category"] for e in entries} <= {"social", "dev", "video", "music", "gaming", "forum", "shopping",
                                                 "professional", "other"}


def test_cors_allows_configured_origin_only(client):
    ok = client.options("/cases", headers={"Origin": "https://sherlock.example",
                                           "Access-Control-Request-Method": "POST"})
    assert ok.headers["access-control-allow-origin"] == "https://sherlock.example"
    local = client.get("/health", headers={"Origin": "http://localhost:3000"})
    assert local.headers["access-control-allow-origin"] == "http://localhost:3000"
    bad = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


def test_removed_legacy_routes_are_gone(client, make_case, as_anon):
    cid = make_case()["case"]["id"]
    assert client.post(f"/cases/{cid}/run", headers=as_anon).status_code == 404
    assert client.post(f"/cases/{cid}/run-with-variations", headers=as_anon).status_code == 404
    assert client.get("/cases", headers=as_anon).status_code == 405  # reads go to Supabase


# ----------------------------------------------------------------------------- auth and ownership
@pytest.mark.parametrize("headers", [
    {},
    {"Authorization": "Bearer nope"},
    {"Authorization": "Basic anon"},
    {"Authorization": "Bearer "},
])
def test_401_without_a_valid_token(client, headers):
    r = client.post("/cases", json={"identifiers": [{"type": "username", "value": "octocat"}]}, headers=headers)
    assert r.status_code == 401 and isinstance(r.json()["detail"], str)


def test_every_command_requires_auth(client):
    cid = "00000000-0000-4000-8000-000000000001"
    calls = [
        ("patch", f"/cases/{cid}"), ("delete", f"/cases/{cid}"), ("post", f"/cases/{cid}/scan"),
        ("post", f"/cases/{cid}/wake"), ("post", f"/cases/{cid}/jobs/{cid}/cancel"),
        ("post", f"/cases/{cid}/correlate"), ("post", f"/cases/{cid}/findings/{cid}/curate"),
        ("post", f"/cases/{cid}/correlations"), ("post", f"/correlations/{cid}/review"),
        ("get", f"/cases/{cid}/report"), ("get", f"/cases/{cid}/variations?value=x"),
        ("post", f"/cases/{cid}/chat"),
    ]
    for method, path in calls:
        assert getattr(client, method)(path).status_code == 401, path


def test_unknown_case_is_404(client, as_anon):
    for cid in ("00000000-0000-4000-8000-000000000001", "not-a-uuid"):
        r = client.post(f"/cases/{cid}/scan", json={"type": "username", "value": "octocat"}, headers=as_anon)
        assert r.status_code == 404 and r.json() == {"detail": "case not found"}


def test_someone_elses_case_is_403(client, make_case, as_other, store):
    cid = make_case()["case"]["id"]
    assert client.patch(f"/cases/{cid}", json={"title": "mine now"}, headers=as_other).status_code == 403
    assert client.post(f"/cases/{cid}/scan", json={"type": "username", "value": "x1"}, headers=as_other).status_code == 403
    assert client.get(f"/cases/{cid}/report", headers=as_other).status_code == 403
    assert client.delete(f"/cases/{cid}", headers=as_other).status_code == 403
    assert store.get_case(cid)["title"] == "octocat"


def test_demo_cases_are_read_only(client, store, as_anon, monkeypatch):
    cid = _demo_case(store)
    fid = _finding(store, cid, "github")["id"]
    monkeypatch.setattr("sherlock_core.report.generate_markdown", lambda case_id, store=None: "# Demo", raising=False)
    assert client.get(f"/cases/{cid}/report", headers=as_anon).status_code == 200  # reading is fine

    writes = [
        client.patch(f"/cases/{cid}", json={"title": "x"}, headers=as_anon),
        client.delete(f"/cases/{cid}", headers=as_anon),
        client.post(f"/cases/{cid}/scan", json={"type": "username", "value": "octocat"}, headers=as_anon),
        client.post(f"/cases/{cid}/correlate", headers=as_anon),
        client.post(f"/cases/{cid}/findings/{fid}/curate", json={"curated": True}, headers=as_anon),
        client.post(f"/cases/{cid}/correlations", json={"finding_ids": [fid, fid]}, headers=as_anon),
        client.post(f"/cases/{cid}/chat", json={"message": "hi"}, headers=as_anon),
        client.post(f"/cases/{cid}/wake", headers=as_anon),
    ]
    assert [r.status_code for r in writes] == [403] * len(writes)
    assert all(r.json()["detail"] == "demo cases are read-only" for r in writes)
    assert store.get_case(cid) is not None and store.list_jobs(cid) == []


# ----------------------------------------------------------------------------- create case
def test_create_case_plans_jobs_seeds_entities_and_wakes_workers(client, store, woken, as_anon):
    r = client.post("/cases", headers=as_anon, json={
        "tags": ["self-check"],
        "identifiers": [{"type": "username", "value": "@octocat"}, {"type": "domain", "value": "Example.com"}],
    })
    assert r.status_code == 201
    body = r.json()
    case, jobs = body["case"], body["jobs"]
    assert case["title"] == "octocat" and case["tags"] == ["self-check"]
    assert case["owner_id"] == "00000000-0000-4000-8000-00000000000a"
    assert case["identifiers"] == [{"type": "username", "value": "octocat"}, {"type": "domain", "value": "example.com"}]

    assert sorted((j["module"], j["queue"], j["target_value"]) for j in jobs) == [
        ("dns", "infra", "example.com"), ("handles", "identity", "octocat"), ("mailcheck", "identity", "octocat"),
    ]
    assert all(j["status"] == "queued" and j["case_id"] == case["id"] for j in jobs)
    assert len({j["batch_id"] for j in jobs}) == 2  # one batch per identifier
    assert len(store.list_jobs(case["id"])) == 3

    entities = {(e["kind"], e["value"]): e for e in store.list_entities(case["id"])}
    assert set(entities) == {("username", "octocat"), ("domain", "example.com")}
    assert all(e["is_seed"] and not e["scanned"] for e in entities.values())
    assert woken == [["identity", "infra"]]


def test_create_case_without_scan(client, store, woken, as_anon):
    r = client.post("/cases", headers=as_anon, json={
        "title": "  My case ", "scan": False, "identifiers": [{"type": "email", "value": "A@Example.com"}],
    })
    body = r.json()
    assert r.status_code == 201 and body["jobs"] == [] and body["case"]["title"] == "My case"
    assert store.list_jobs(body["case"]["id"]) == [] and woken == []
    assert len(store.list_entities(body["case"]["id"])) == 1


def test_create_case_rejects_bad_input_and_writes_nothing(client, store, as_anon):
    bad_value = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "email", "value": "nope"}]})
    assert bad_value.status_code == 400 and "email" in bad_value.json()["detail"]
    no_module = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "ip", "value": "8.8.8.8"}]})
    assert no_module.status_code == 400 and "no module" in no_module.json()["detail"]
    empty = client.post("/cases", headers=as_anon, json={"identifiers": []})
    bad_type = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "ssn", "value": "1"}]})
    assert empty.status_code == bad_type.status_code == 422
    assert isinstance(bad_type.json()["detail"], str)
    assert store.cases == {} and store.jobs == {}


# ----------------------------------------------------------------------------- patch / delete
def test_patch_and_archive_case(client, make_case, as_anon):
    cid = make_case()["case"]["id"]
    r = client.patch(f"/cases/{cid}", headers=as_anon,
                     json={"title": "Renamed", "notes": "n", "tags": ["a"], "archived": True})
    body = r.json()
    assert r.status_code == 200
    assert (body["title"], body["notes"], body["tags"]) == ("Renamed", "n", ["a"]) and body["archived_at"]
    r = client.patch(f"/cases/{cid}", headers=as_anon, json={"archived": False})
    assert r.json()["archived_at"] is None and r.json()["title"] == "Renamed"
    assert client.patch(f"/cases/{cid}", headers=as_anon, json={}).status_code == 400


def test_delete_case(client, make_case, store, as_anon):
    cid = make_case()["case"]["id"]
    r = client.delete(f"/cases/{cid}", headers=as_anon)
    assert r.status_code == 204 and r.content == b""
    assert store.get_case(cid) is None and store.list_jobs(cid) == []


# ----------------------------------------------------------------------------- scan
def test_scan_enqueues_a_batch_and_wakes_the_queue(client, make_case, store, woken, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    r = client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "domain", "value": "example.com"})
    body = r.json()
    assert r.status_code == 202
    assert [j["module"] for j in body["jobs"]] == ["dns"] and body["jobs"][0]["batch_id"] == body["batch_id"]
    assert woken == [["infra"]]
    assert ("domain", "example.com") in {(e["kind"], e["value"]) for e in store.list_entities(cid)}
    assert store.list_audit(cid)[0]["action"] == "scan_queued"


def test_scan_module_selection_and_validation(client, make_case, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    one = client.post(f"/cases/{cid}/scan", headers=as_anon,
                      json={"type": "username", "value": "octocat", "modules": ["handles"]})
    assert [j["module"] for j in one.json()["jobs"]] == ["handles"]
    unknown = client.post(f"/cases/{cid}/scan", headers=as_anon,
                          json={"type": "username", "value": "octocat", "modules": ["dns"]})
    invalid = client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "username", "value": "no spaces"})
    assert unknown.status_code == invalid.status_code == 400
    assert "username" in invalid.json()["detail"]


def test_scan_session_rate_limit(client, make_case, store, as_anon, as_other, monkeypatch):
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 2)
    cid = make_case(scan=False)["case"]["id"]
    codes = [
        client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "username", "value": f"user{i}"}).status_code
        for i in range(3)
    ]
    assert codes == [202, 202, 429]
    blocked = client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "username", "value": "again"})
    assert blocked.status_code == 429 and "2 scans per session" in blocked.json()["detail"]
    assert len({j["batch_id"] for j in store.list_jobs(cid)}) == 2
    # invalid input does not burn quota, and another session is unaffected
    other = client.post("/cases", headers=as_other, json={"identifiers": [{"type": "username", "value": "octocat"}]})
    assert other.status_code == 201


def test_create_case_counts_one_scan_per_identifier(client, as_anon, store, monkeypatch):
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 1)
    r = client.post("/cases", headers=as_anon, json={"identifiers": [
        {"type": "username", "value": "octocat"}, {"type": "domain", "value": "example.com"}]})
    assert r.status_code == 429 and store.cases == {}


def test_scan_global_rate_limit(client, make_case, as_anon, as_other, monkeypatch):
    monkeypatch.setattr(config, "SCANS_GLOBAL_PER_DAY", 1)
    make_case()
    r = client.post("/cases", headers=as_other, json={"identifiers": [{"type": "username", "value": "octocat"}]})
    assert r.status_code == 429 and "capacity" in r.json()["detail"]


def test_name_scan_needs_a_signed_in_user(client, make_case, store, as_anon, as_user, monkeypatch):
    monkeypatch.setattr(config, "NAME_SEARCHES_PER_USER_PER_DAY", 1)
    anon_case = make_case(scan=False)["case"]["id"]
    r = client.post(f"/cases/{anon_case}/scan", headers=as_anon, json={"type": "name", "value": "Ada Lovelace"})
    assert r.status_code == 403 and "signed-in" in r.json()["detail"]
    r = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "name", "value": "Ada Lovelace"}]})
    assert r.status_code == 403
    assert store.list_jobs(anon_case) == []

    user_case = make_case(headers=as_user, scan=False)["case"]["id"]
    ok = client.post(f"/cases/{user_case}/scan", headers=as_user, json={"type": "name", "value": "Ada Lovelace"})
    assert ok.status_code == 202 and [j["module"] for j in ok.json()["jobs"]] == ["people"]
    again = client.post(f"/cases/{user_case}/scan", headers=as_user, json={"type": "name", "value": "Grace Hopper"})
    assert again.status_code == 429 and "name searches" in again.json()["detail"]


# ----------------------------------------------------------------------------- wake / cancel / correlate
def test_wake_repokes_only_queues_with_queued_jobs(client, make_case, store, woken, as_anon):
    created = make_case(identifiers=[{"type": "username", "value": "octocat"}, {"type": "domain", "value": "example.com"}])
    cid = created["case"]["id"]
    woken.clear()
    for job in created["jobs"]:
        if job["queue"] == "identity":
            store.jobs[job["id"]]["status"] = "running"
    r = client.post(f"/cases/{cid}/wake", headers=as_anon)
    assert r.status_code == 202 and r.json() == {"queues": ["infra"]} and woken == [["infra"]]

    store.jobs[next(j["id"] for j in created["jobs"] if j["queue"] == "infra")]["status"] = "succeeded"
    woken.clear()
    assert client.post(f"/cases/{cid}/wake", headers=as_anon).json() == {"queues": []}
    assert woken == []


def test_cancel_job(client, make_case, store, as_anon, as_other):
    created = make_case()
    cid, job = created["case"]["id"], created["jobs"][0]
    assert client.post(f"/cases/{cid}/jobs/{job['id']}/cancel", headers=as_other).status_code == 403
    r = client.post(f"/cases/{cid}/jobs/{job['id']}/cancel", headers=as_anon)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert store.claim_job("identity", "w").get("id") != job["id"]

    other_case = make_case(scan=False)["case"]["id"]
    assert client.post(f"/cases/{other_case}/jobs/{job['id']}/cancel", headers=as_anon).status_code == 404
    done = created["jobs"][1]["id"]
    store.complete_job(done, {"findings": 0, "found": 0})
    assert client.post(f"/cases/{cid}/jobs/{done}/cancel", headers=as_anon).json()["status"] == "succeeded"


def test_correlate_syncs_engine_output(client, make_case, store, as_anon, monkeypatch):
    cid = make_case(scan=False)["case"]["id"]
    a, b = _finding(store, cid, "github"), _finding(store, cid, "gitlab")

    def engine(case_id, findings, split_keys=None):
        return [{"type": "shared_handle", "corr_key": "handle:octocat", "matched_value": "octocat",
                 "entities_involved": [f["id"] for f in findings], "confidence": 0.6,
                 "evidence": ["same handle"], "priority": 0.4}]

    monkeypatch.setattr("sherlock_core.jobs._correlation.correlate", engine)
    r = client.post(f"/cases/{cid}/correlate", headers=as_anon)
    assert r.status_code == 200 and r.json() == {"correlations": 1}
    assert sorted(store.list_correlations(cid)[0]["entities_involved"]) == sorted([a["id"], b["id"]])


# ----------------------------------------------------------------------------- curate / review / manual link
def test_curate_finding(client, make_case, store, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    fid = _finding(store, cid, "github")["id"]
    r = client.post(f"/cases/{cid}/findings/{fid}/curate", headers=as_anon, json={"curated": True})
    assert r.status_code == 200 and r.json()["curated"] is True and r.json()["id"] == fid
    assert store.list_findings(cid, curated=True)[0]["id"] == fid
    r = client.post(f"/cases/{cid}/findings/{fid}/curate", headers=as_anon, json={"curated": False})
    assert r.json()["curated"] is False

    other_case = make_case(scan=False)["case"]["id"]
    assert client.post(f"/cases/{other_case}/findings/{fid}/curate", headers=as_anon,
                       json={"curated": True}).status_code == 404
    assert client.post(f"/cases/{cid}/findings/{fid}/curate", headers=as_anon, json={}).status_code == 422


def _correlation(store, cid):
    return store.sync_correlations(cid, [{
        "type": "shared_email", "corr_key": "email:a@b.c", "matched_value": "a@b.c",
        "entities_involved": ["f1", "f2"], "confidence": 0.9, "evidence": ["same email"], "priority": 1.0,
    }])[0]


def test_review_approve_reject_reset_persist(client, make_case, store, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    corr_id = _correlation(store, cid)["id"]

    r = client.post(f"/correlations/{corr_id}/review", headers=as_anon, json={"decision": "approve", "note": "confirmed"})
    assert r.status_code == 200
    assert (r.json()["status"], r.json()["reviewed"], r.json()["review_note"]) == ("approved", True, "confirmed")
    assert store.get_correlation(corr_id)["status"] == "approved" and r.json()["reviewed_at"]

    r = client.post(f"/correlations/{corr_id}/review", headers=as_anon, json={"decision": "reject"})
    assert r.json()["status"] == "rejected" and r.json()["reviewed"] is False
    assert len(store.list_correlations(cid)) == 1  # rejected, never deleted
    # a rescan keeps the human decision
    _correlation(store, cid)
    assert store.get_correlation(corr_id)["status"] == "rejected"

    r = client.post(f"/correlations/{corr_id}/review", headers=as_anon, json={"decision": "reset"})
    assert r.json()["status"] == "pending" and r.json()["reviewed_at"] is None
    assert client.post(f"/correlations/{corr_id}/review", headers=as_anon, json={"decision": "maybe"}).status_code == 422


def test_review_split_and_merge_again_same_account(client, make_case, store, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    rows = [make_finding(case_id=cid, identifier_type="username", identifier_value="edith", source_tool=t,
                         platform=p, url="https://github.com/edith", extra=x)
            for t, p, x in (("github", "github", {"email": "edith@acme.io"}), ("whatsmyname", "GitHub", {}))]
    rows.append(make_finding(case_id=cid, identifier_type="username", identifier_value="efinch",
                             source_tool="profile_gitlab", platform="gitlab", extra={"email": "edith@acme.io"}))
    ids = [f["id"] for f in store.upsert_findings(rows, cid)]
    assert client.post(f"/cases/{cid}/correlate", headers=as_anon).status_code == 200
    merge = next(c for c in store.list_correlations(cid) if c["type"] == "same_account")
    link = next(c for c in store.list_correlations(cid) if c["type"] == "shared_email")
    assert merge["status"] == "approved" and link["entities_involved"] == sorted(ids)

    r = client.post(f"/correlations/{merge['id']}/review", headers=as_anon, json={"decision": "reject"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    # re-correlated with the split: the link now names only the finding that publishes the email
    link = store.get_correlation(link["id"])
    assert link["entities_involved"] == sorted([ids[0], ids[2]])
    assert store.get_correlation(merge["id"])["status"] == "rejected"

    r = client.post(f"/correlations/{merge['id']}/review", headers=as_anon, json={"decision": "reset"})
    assert r.status_code == 200 and r.json()["status"] == "approved"      # merged again, not "pending"
    assert store.get_correlation(link["id"])["entities_involved"] == sorted(ids)


def test_review_checks_ownership(client, make_case, store, as_anon, as_other):
    cid = make_case(scan=False)["case"]["id"]
    corr_id = _correlation(store, cid)["id"]
    assert client.post(f"/correlations/{corr_id}/review", headers=as_other, json={"decision": "approve"}).status_code == 403
    assert client.post("/correlations/00000000-0000-4000-8000-000000000009/review", headers=as_anon,
                       json={"decision": "approve"}).status_code == 404
    demo = _demo_case(store)
    demo_corr = _correlation(store, demo)["id"]
    assert client.post(f"/correlations/{demo_corr}/review", headers=as_anon, json={"decision": "approve"}).status_code == 403
    assert store.get_correlation(corr_id)["status"] == "pending"


def test_manual_link(client, make_case, store, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    a, b = _finding(store, cid, "github")["id"], _finding(store, cid, "gitlab")["id"]
    r = client.post(f"/cases/{cid}/correlations", headers=as_anon, json={"finding_ids": [a, b], "note": "same avatar"})
    row = r.json()
    assert r.status_code == 201
    assert row["type"] == "manual_link" and row["corr_key"].startswith("manual:")
    assert (row["confidence"], row["status"], row["reviewed"]) == (1.0, "approved", True)
    assert row["entities_involved"] == [a, b] and row["review_note"] == "same avatar"
    # the engine's sync never removes a manual link
    store.sync_correlations(cid, [])
    assert [c["id"] for c in store.list_correlations(cid)] == [row["id"]]

    other_case = make_case(scan=False)["case"]["id"]
    foreign = _finding(store, other_case, "github")["id"]
    assert client.post(f"/cases/{cid}/correlations", headers=as_anon, json={"finding_ids": [a, foreign]}).status_code == 400
    assert client.post(f"/cases/{cid}/correlations", headers=as_anon, json={"finding_ids": [a, a]}).status_code == 400
    assert client.post(f"/cases/{cid}/correlations", headers=as_anon, json={"finding_ids": [a]}).status_code == 422


# ----------------------------------------------------------------------------- report / variations / errors
def test_report_is_markdown(client, make_case, as_anon, monkeypatch):
    cid = make_case(scan=False)["case"]["id"]
    seen = {}

    def fake(case_id, store=None):
        seen["args"] = (case_id, store is not None)
        return "# Investigation Report\n"

    monkeypatch.setattr("sherlock_core.report.generate_markdown", fake, raising=False)
    r = client.get(f"/cases/{cid}/report", headers=as_anon)
    assert r.status_code == 200 and r.text.startswith("# Investigation Report")
    assert r.headers["content-type"].startswith("text/markdown")
    assert seen["args"] == (cid, True)


def test_unhandled_errors_become_json_500_with_cors(client, make_case, as_anon, monkeypatch):
    cid = make_case(scan=False)["case"]["id"]

    def broken(case_id, store=None):
        raise RuntimeError("secret internals")

    monkeypatch.setattr("sherlock_core.report.generate_markdown", broken, raising=False)
    r = client.get(f"/cases/{cid}/report", headers={**as_anon, "Origin": "https://sherlock.example"})
    assert r.status_code == 500 and r.json() == {"detail": "Internal server error"}
    assert r.headers["access-control-allow-origin"] == "https://sherlock.example"


def test_variations(client, make_case, llm, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    llm.responses = [{"text": '["PascalCase", "dot_sep", "with_1"]'}]
    r = client.get(f"/cases/{cid}/variations", headers=as_anon,
                   params={"type": "username", "value": "max_cell", "count": 3, "exclude": "max.cell"})
    assert r.status_code == 200 and r.json() == {"variations": ["MaxCell", "max_cell1"]}
    assert client.get(f"/cases/{cid}/variations", headers=as_anon,
                      params={"type": "domain", "value": "example.com"}).status_code == 422
    assert client.get(f"/cases/{cid}/variations", headers=as_anon,
                      params={"type": "username", "value": "bad value"}).status_code == 400


def test_request_log_line_has_method_path_status_ms_principal(client, as_anon, caplog):
    with caplog.at_level("INFO", logger="sherlock.gateway.access"):
        client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "username", "value": "octocat"}]})
    rec = next(r for r in caplog.records if r.name == "sherlock.gateway.access")
    assert (rec.method, rec.path, rec.status) == ("POST", "/cases", 201)
    assert rec.principal == "00000000-0000-4000-8000-00000000000a" and rec.ms >= 0

    import json

    from gateway.logs import JsonFormatter
    line = json.loads(JsonFormatter().format(rec))
    assert line["status"] == 201 and line["path"] == "/cases" and line["msg"] == "request"
