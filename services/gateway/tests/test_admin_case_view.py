"""Operator's read-only view of any visitor's case, for abuse review."""
import pytest
from sherlock_core.models import make_finding


def auth(who):
    return {"Authorization": f"Bearer {who}"}


def _case_with_content(store, owner="00000000-0000-4000-8000-00000000000a", findings=3):
    cid = store.create_case([{"type": "username", "value": "octocat"}], owner_id=owner, title="octocat")["id"]
    store.upsert_findings([
        make_finding(case_id=cid, identifier_type="username", identifier_value="octocat", source_tool="t",
                     platform=f"site{i}") for i in range(findings)], cid)
    store.sync_correlations(cid, [{"type": "same_account", "corr_key": "k", "matched_value": "github:octocat",
                                   "entities_involved": [], "confidence": 1.0, "evidence": [], "priority": 0,
                                   "status": "approved"}])
    store.upsert_entities(cid, [{"kind": "username", "value": "octocat", "is_seed": True}])
    store.enqueue_jobs([{"case_id": cid, "queue": "identity", "module": "handles", "target_type": "username",
                         "target_value": "octocat"}])
    return cid


def test_operator_reads_any_case_in_full_and_the_view_is_logged(client, store):
    cid = _case_with_content(store)
    r = client.get(f"/admin/cases/{cid}", headers=auth("admin"))
    assert r.status_code == 200
    body = r.json()
    assert body["case"]["id"] == cid and body["findings_total"] == 3 and len(body["findings"]) == 3
    assert [c["type"] for c in body["correlations"]] == ["same_account"]
    assert len(body["entities"]) == 1 and len(body["jobs"]) == 1
    [entry] = [a for a in store.list_audit(cid) if a["action"] == "admin_case_viewed"]
    assert entry["case_id"] == cid and entry["actor"] == "operator"
    assert entry["detail"] == {"admin": "Operator@Example.com"}
    assert any(a["action"] == "admin_case_viewed" for a in body["audit"])     # in the case's own history


def test_findings_are_paginated(client, store):
    cid = _case_with_content(store, findings=5)
    first = client.get(f"/admin/cases/{cid}?findings_limit=2", headers=auth("admin")).json()
    assert len(first["findings"]) == 2 and first["findings_next_offset"] == 2 and first["findings_total"] == 5
    last = client.get(f"/admin/cases/{cid}?findings_limit=2&findings_offset=4", headers=auth("admin")).json()
    assert len(last["findings"]) == 1 and last["findings_next_offset"] is None
    assert len([a for a in store.list_audit(cid) if a["action"] == "admin_case_viewed"]) == 1   # one opening


@pytest.mark.parametrize("who", [None, "anon", "user", "unverified"])
def test_everyone_else_gets_404_and_nothing_is_logged(client, store, who):
    cid = _case_with_content(store)
    r = client.get(f"/admin/cases/{cid}", headers=auth(who) if who else {})
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert not any(a["action"] == "admin_case_viewed" for a in store.list_audit(cid))


def test_missing_case_is_404(client, store):
    assert client.get("/admin/cases/00000000-0000-4000-8000-000000000999", headers=auth("admin")).status_code == 404
    assert client.get("/admin/cases/nope", headers=auth("admin")).status_code == 404


@pytest.mark.parametrize("method", ["post", "put", "patch"])
def test_the_case_view_has_no_write_routes(client, store, method):
    cid = _case_with_content(store)
    r = getattr(client, method)(f"/admin/cases/{cid}", headers=auth("admin"), json={})
    assert r.status_code == 404
    for path in ("findings/x/curate", "scan", "correlations", "jobs/x/cancel"):
        assert client.post(f"/admin/cases/{cid}/{path}", headers=auth("admin"), json={}).status_code == 404
    # the operator is not the owner: the visitor's own write routes stay closed too
    assert client.post(f"/cases/{cid}/scan", headers=auth("admin"),
                       json={"type": "username", "value": "x1"}).status_code == 403
