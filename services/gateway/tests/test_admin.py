"""Operator panel API: the guard (404 for everyone else), reads, actions and audit."""
import json

import pytest
from gateway import visitors

ANON = "00000000-0000-4000-8000-00000000000a"
USER = "00000000-0000-4000-8000-00000000000b"
OTHER = "00000000-0000-4000-8000-00000000000c"
RAW_IP = "198.51.100.23"

ROUTES = [
    ("get", "/admin/me", None), ("get", "/admin/overview", None), ("get", "/admin/searches", None),
    ("get", "/admin/sessions", None), ("get", f"/admin/sessions/{ANON}", None),
    ("post", f"/admin/sessions/{ANON}/block", {"reason": "x"}), ("post", f"/admin/sessions/{ANON}/unblock", None),
    ("post", "/admin/pause", {"paused": True}), ("delete", f"/admin/cases/{ANON}", None),
]


def _call(client, method, path, body, headers):
    kwargs = {"headers": headers}
    if body is not None:
        kwargs["json"] = body
    return getattr(client, method)(path, **kwargs)


@pytest.fixture(autouse=True)
def distinct_origins(monkeypatch):
    """Every test token comes from its own address unless a request sets X-Forwarded-For."""
    real = visitors.client_ip

    def client_ip(request):
        if request.headers.get("x-forwarded-for"):
            return real(request)
        return "192.0.2." + str(sum(map(ord, request.headers.get("authorization", ""))) % 250)
    monkeypatch.setattr(visitors, "client_ip", client_ip)


# ----------------------------------------------------------------------------- guard
@pytest.mark.parametrize("who", [None, "anon", "user", "other", "unverified", "nope"])
def test_everyone_but_the_operator_gets_a_plain_404(client, store, who):
    headers = {"Authorization": f"Bearer {who}"} if who else {}
    store.touch_session(ANON, is_anonymous=True)
    for method, path, body in ROUTES:
        r = _call(client, method, path, body, headers)
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}, (who, path)
    assert store.get_session(ANON)["blocked"] is False and store.get_setting("scans_paused") is None
    assert not any(a["action"].startswith("operator_") for a in store.audit)


def test_unknown_admin_paths_and_methods_look_the_same(client, as_admin):
    for method, path in (("get", "/admin/nope"), ("put", "/admin/me"), ("get", "/admin/pause"), ("post", "/admin")):
        r = getattr(client, method)(path, headers=as_admin)
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}, path
    assert client.get("/admin/pause").status_code == 404           # no 405 hint without a token either
    assert "/admin" not in json.dumps(client.get("/openapi.json").json()["paths"])


def test_admin_me(client, as_admin, monkeypatch):
    assert client.get("/admin/me", headers=as_admin).json() == {"is_admin": True, "email": "Operator@Example.com"}
    from sherlock_core import config
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset())     # empty: nobody is an operator
    assert client.get("/admin/me", headers=as_admin).status_code == 404


# ----------------------------------------------------------------------------- reads
def _activity(client, as_anon, as_user, make_case):
    make_case(identifiers=[{"type": "username", "value": "octocat"}, {"type": "domain", "value": "example.com"}])
    cid = make_case(headers=as_user, scan=False)["case"]["id"]
    client.post(f"/cases/{cid}/scan", headers=as_user, json={"type": "username", "value": "octocat"})
    client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "name", "value": "Ada Lovelace"}]})
    return cid


def test_overview(client, store, make_case, as_anon, as_user, as_admin):
    _activity(client, as_anon, as_user, make_case)
    r = client.get("/admin/overview?days=7", headers=as_admin)
    assert r.status_code == 200
    o = r.json()
    assert o["days"] == 7 and len(o["series"]) == 7 and o["retention_days"] == 90 and o["scans_paused"] is False
    assert o["totals"] == {"searches": 4, "accepted": 3, "refused": 1, "sessions": 2, "flagged_sessions": 0,
                           "cases": 2, "active_jobs": 5}
    assert o["series"][-1]["accepted"] == 3 and o["series"][-1]["forbidden"] == 1 and o["series"][0]["accepted"] == 0
    assert o["by_type"][0] == {"target_type": "username", "count": 2}
    assert o["top_targets"] == [{"target_type": "username", "target_value": "octocat", "count": 2, "sessions": 2}]
    assert o["quota"]["global_used_today"] == 3 and o["quota"]["global_limit"] > 0
    assert client.get("/admin/overview?days=0", headers=as_admin).status_code == 422
    assert client.get("/admin/overview?days=91", headers=as_admin).status_code == 422


def test_search_feed_filters_join_and_pagination(client, store, make_case, as_anon, as_user, as_admin):
    _activity(client, as_anon, as_user, make_case)
    feed = client.get("/admin/searches", headers=as_admin).json()
    items = feed["items"]
    assert [i["target_value"] for i in items] == ["Ada Lovelace", "octocat", "example.com", "octocat"]
    assert feed["next_cursor"] is None
    assert items[0]["outcome"] == "forbidden" and items[0]["session"]["is_anonymous"] is True
    assert items[1]["session"]["email"] == "kit@example.com" and items[1]["session"]["origin"]
    assert items[1]["session"]["origin_sessions"] == 1

    page1 = client.get("/admin/searches?limit=3", headers=as_admin).json()
    assert len(page1["items"]) == 3 and page1["next_cursor"]
    page2 = client.get(f"/admin/searches?limit=3&cursor={page1['next_cursor']}", headers=as_admin).json()
    assert [i["target_value"] for i in page2["items"]] == ["octocat"] and page2["next_cursor"] is None

    def values(query):
        return [i["target_value"] for i in client.get(f"/admin/searches?{query}", headers=as_admin).json()["items"]]

    assert values("outcome=forbidden") == ["Ada Lovelace"]
    assert values("type=domain") == ["example.com"]
    assert values("q=OCTO") == ["octocat", "octocat"]
    assert values(f"session={USER}") == ["octocat"]
    assert values("session=not-a-uuid") == []
    assert values("since=2999-01-01T00:00:00Z") == []
    assert client.get("/admin/searches?outcome=maybe", headers=as_admin).status_code == 422
    assert client.get("/admin/searches?cursor=abc", headers=as_admin).status_code == 422


def test_sessions_list_detail_and_flags(client, store, make_case, as_anon, as_user, as_admin, monkeypatch):
    cid = _activity(client, as_anon, as_user, make_case)
    for i in range(12):                                             # harvesting-like pattern for the anon session
        store.log_search({"user_id": ANON, "target_type": "username", "target_value": f"person{i}",
                          "outcome": "accepted", "is_anonymous": True})
    listing = client.get("/admin/sessions", headers=as_admin).json()
    assert {s["user_id"] for s in listing["items"]} >= {ANON, USER}
    flagged = client.get("/admin/sessions?flagged=true", headers=as_admin).json()["items"]
    assert [s["user_id"] for s in flagged] == [ANON]
    assert {f["key"] for f in flagged[0]["flags"]} >= {"burst", "many_targets"}
    assert flagged[0]["flags"][0]["severity"] == "high"
    assert USER in {s["user_id"] for s in client.get("/admin/sessions?flagged=false", headers=as_admin).json()["items"]}
    assert [s["user_id"] for s in client.get("/admin/sessions?q=kit@", headers=as_admin).json()["items"]] == [USER]

    page = client.get("/admin/sessions?limit=1", headers=as_admin).json()
    assert len(page["items"]) == 1 and page["next_cursor"] == "1"
    rest = client.get("/admin/sessions?limit=1&cursor=1", headers=as_admin).json()
    assert rest["items"][0]["user_id"] != page["items"][0]["user_id"]

    detail = client.get(f"/admin/sessions/{USER}", headers=as_admin).json()
    assert detail["session"]["email"] == "kit@example.com" and detail["session"]["search_count"] == 1
    assert [s["target_value"] for s in detail["searches"]] == ["octocat"]
    [case] = detail["cases"]
    assert case["id"] == cid and case["job_count"] == 2 and "findings" not in case and "notes" not in case
    assert client.get(f"/admin/sessions/{OTHER}", headers=as_admin).status_code == 404
    assert client.get("/admin/sessions/not-a-uuid", headers=as_admin).status_code == 404


# ----------------------------------------------------------------------------- actions
def test_block_and_unblock_are_enforced_and_audited(client, store, make_case, as_anon, as_admin):
    cid = make_case(scan=False)["case"]["id"]
    r = client.post(f"/admin/sessions/{ANON}/block", headers=as_admin, json={"reason": "  many targets  "})
    assert r.status_code == 200 and r.json()["blocked"] is True and r.json()["blocked_reason"] == "many targets"
    assert client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "username", "value": "kit"}
                       ).status_code == 403
    assert client.post(f"/admin/sessions/{ANON}/block", headers=as_admin, json={"reason": " "}).status_code == 422
    assert client.post(f"/admin/sessions/{ANON}/block", headers=as_admin, json={}).status_code == 422
    r = client.post(f"/admin/sessions/{ANON}/unblock", headers=as_admin)
    assert r.status_code == 200 and r.json()["blocked"] is False and r.json()["blocked_reason"] is None
    assert client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "username", "value": "kit"}
                       ).status_code == 202
    assert client.post(f"/admin/sessions/{OTHER}/block", headers=as_admin, json={"reason": "x"}).status_code == 404
    audit = [(a["action"], a["detail"]["admin"], a["case_id"]) for a in store.audit if a["actor"] == "operator"]
    assert audit == [("operator_session_blocked", "Operator@Example.com", None),
                     ("operator_session_unblocked", "Operator@Example.com", None)]


def test_pause_switch(client, store, make_case, as_anon, as_admin):
    cid = make_case(scan=False)["case"]["id"]
    assert client.post("/admin/pause", headers=as_admin, json={"paused": True}).json() == {"scans_paused": True}
    assert client.get("/admin/overview", headers=as_admin).json()["scans_paused"] is True
    assert client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "username", "value": "kit"}
                       ).status_code == 503
    assert client.post("/admin/pause", headers=as_admin, json={"paused": False}).json() == {"scans_paused": False}
    assert client.post(f"/cases/{cid}/scan", headers=as_anon, json={"type": "username", "value": "kit"}
                       ).status_code == 202
    assert [a["action"] for a in store.audit if a["actor"] == "operator"] == [
        "operator_scans_paused", "operator_scans_resumed"]


def test_operator_case_removal_keeps_the_search_log(client, store, make_case, as_admin):
    created = make_case()
    cid = created["case"]["id"]
    assert client.delete(f"/admin/cases/{cid}", headers=as_admin).status_code == 204
    assert store.get_case(cid) is None and store.list_jobs(cid) == []
    [row] = store.list_searches()
    assert row["case_id"] is None and row["target_value"] == "octocat"
    entry = next(a for a in store.audit if a["action"] == "operator_case_deleted")
    assert entry["detail"] == {"admin": "Operator@Example.com", "case_id": cid, "owner_id": ANON, "title": "octocat"}
    assert client.delete(f"/admin/cases/{cid}", headers=as_admin).status_code == 404
    demo = store.create_case([{"type": "username", "value": "demo"}], owner_id=None, title="Demo")
    store.cases[demo["id"]]["is_demo"] = True
    assert client.delete(f"/admin/cases/{demo['id']}", headers=as_admin).status_code == 400


def test_no_raw_ip_in_any_admin_response(client, store, make_case, as_admin):
    headers = {"Authorization": "Bearer anon", "X-Forwarded-For": RAW_IP}
    visitors.reset_touch_cache()
    client.post("/cases", headers=headers, json={"identifiers": [{"type": "username", "value": "octocat"}]})
    bodies = [client.get(p, headers=as_admin).text for p in (
        "/admin/overview", "/admin/searches", "/admin/sessions", f"/admin/sessions/{ANON}")]
    assert all(RAW_IP not in b for b in bodies)
    assert visitors.hash_ip(RAW_IP) in bodies[1]
    assert RAW_IP not in json.dumps([store.sessions, store.search_log, store.audit])
