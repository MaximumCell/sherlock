"""Search logging, operator enforcement (blocked, paused), visitor sessions and IP hashing."""
import json

import pytest
from gateway import visitors
from gateway.service import BLOCKED_MESSAGE, PAUSED_MESSAGE
from sherlock_core import config

ANON = "00000000-0000-4000-8000-00000000000a"
RAW_IP = "203.0.113.77"


def _scan(client, cid, headers, type_="username", value="octocat", **extra):
    return client.post(f"/cases/{cid}/scan", headers=headers, json={"type": type_, "value": value, **extra})


def _log(store):
    return list(reversed(store.list_searches(limit=1000)))      # oldest first


# ----------------------------------------------------------------------------- one row per target, every outcome
def test_create_case_logs_one_accepted_row_per_target(client, store, as_anon):
    r = client.post("/cases", headers=as_anon, json={"identifiers": [
        {"type": "username", "value": "@octocat"}, {"type": "domain", "value": "Example.com"},
        {"type": "username", "value": "octocat"}]})          # duplicate after normalising: one target
    assert r.status_code == 201
    cid = r.json()["case"]["id"]
    rows = _log(store)
    assert [(x["target_type"], x["target_value"], x["outcome"]) for x in rows] == [
        ("username", "octocat", "accepted"), ("domain", "example.com", "accepted")]
    assert all(x["case_id"] == cid and x["user_id"] == ANON and x["is_anonymous"] is True for x in rows)
    assert rows[0]["modules"] == ["handles", "mailcheck"] and rows[1]["modules"] == ["dns"]
    assert store.get_session(ANON)["search_count"] == 2


def test_create_case_without_scan_is_not_a_search(client, store, as_anon):
    assert client.post("/cases", headers=as_anon, json={
        "identifiers": [{"type": "username", "value": "octocat"}], "scan": False}).status_code == 201
    assert _log(store) == []


def test_scan_logs_accepted(client, store, make_case, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    assert _scan(client, cid, as_anon, value="@kit").status_code == 202
    [row] = _log(store)
    assert row["outcome"] == "accepted" and row["target_value"] == "kit" and row["case_id"] == cid
    assert row["modules"] == ["handles", "mailcheck"] and row["detail"] is None


def test_rate_limited_is_logged(client, store, make_case, as_anon, monkeypatch):
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 1)
    cid = make_case(scan=False)["case"]["id"]
    assert _scan(client, cid, as_anon, value="one").status_code == 202
    r = _scan(client, cid, as_anon, value="two")
    assert r.status_code == 429
    last = _log(store)[-1]
    assert last["outcome"] == "rate_limited" and last["target_value"] == "two" and "Daily limit" in last["detail"]
    r = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "username", "value": "three"}]})
    assert r.status_code == 429 and _log(store)[-1]["outcome"] == "rate_limited"
    assert _log(store)[-1]["case_id"] is None
    s = store.get_session(ANON)
    assert s["search_count"] == 1 and s["refused_count"] == 2


def test_anonymous_name_search_is_logged_as_forbidden(client, store, make_case, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    assert _scan(client, cid, as_anon, type_="name", value="Ada Lovelace").status_code == 403
    r = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "name", "value": "Ada Lovelace"}]})
    assert r.status_code == 403
    rows = _log(store)
    assert [(x["target_type"], x["outcome"]) for x in rows] == [("name", "forbidden"), ("name", "forbidden")]
    assert "signed-in" in rows[0]["detail"]


@pytest.mark.parametrize("body", [
    {"type": "domain", "value": "not a domain"},
    {"type": "username", "value": "octocat", "modules": ["nope"]},
    {"type": "username", "value": "octocat", "hints": {"city": "Leeds"}},      # hints only for names
])
def test_invalid_input_is_logged(client, store, make_case, as_anon, body):
    cid = make_case(scan=False)["case"]["id"]
    assert client.post(f"/cases/{cid}/scan", headers=as_anon, json=body).status_code == 400
    [row] = _log(store)
    assert row["outcome"] == "invalid" and row["target_type"] == body["type"] and row["detail"]


def test_invalid_create_case_logs_every_target_and_writes_no_case(client, store, as_anon):
    r = client.post("/cases", headers=as_anon, json={"identifiers": [
        {"type": "username", "value": "octocat"}, {"type": "domain", "value": "not a domain"}]})
    assert r.status_code == 400 and store.cases == {}
    assert [(x["target_value"], x["outcome"]) for x in _log(store)] == [
        ("octocat", "invalid"), ("not a domain", "invalid")]


def test_ownership_errors_are_not_search_attempts(client, store, make_case, as_other):
    cid = make_case(scan=False)["case"]["id"]
    assert _scan(client, cid, as_other).status_code == 403
    assert _scan(client, "00000000-0000-4000-8000-000000000001", as_other).status_code == 404
    assert _log(store) == []


def test_agent_scans_are_logged(client, store, make_case, llm, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    llm.responses = [{"function_calls": [{"id": "1", "name": "run_username_scan", "args": {"username": "kit"}}]},
                     {"text": "ok"}]
    assert client.post(f"/cases/{cid}/chat", headers=as_anon, json={"message": "scan kit"}).status_code == 200
    rows = _log(store)
    assert [(x["target_value"], x["outcome"]) for x in rows] == [("kit", "accepted")]


# ----------------------------------------------------------------------------- enforcement
def test_blocked_session_cannot_search_but_can_read(client, store, make_case, as_anon, as_other, monkeypatch):
    monkeypatch.setattr("sherlock_core.report.generate_markdown", lambda case_id, store=None: "# r", raising=False)
    cid = make_case(scan=False)["case"]["id"]
    store.set_session_blocked(ANON, True, "harvesting")
    r = _scan(client, cid, as_anon)
    assert r.status_code == 403 and r.json() == {"detail": BLOCKED_MESSAGE}
    r = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "username", "value": "a"},
                                                                      {"type": "email", "value": "a@example.com"}]})
    assert r.status_code == 403 and r.json()["detail"] == BLOCKED_MESSAGE
    assert store.list_jobs(cid) == [] and len(store.cases) == 1
    assert [x["outcome"] for x in _log(store)] == ["blocked", "blocked", "blocked"]
    assert store.rate == {}                                    # refused before any quota was used
    assert client.get(f"/cases/{cid}/report", headers=as_anon).status_code == 200
    other = make_case(headers=as_other, scan=False)["case"]["id"]
    assert _scan(client, other, as_other).status_code == 202   # only that session is blocked


def test_paused_refuses_every_search_with_503(client, store, make_case, as_anon, as_user, monkeypatch):
    monkeypatch.setattr("sherlock_core.report.generate_markdown", lambda case_id, store=None: "# r", raising=False)
    cid = make_case(scan=False)["case"]["id"]
    store.set_setting("scans_paused", True, "op")
    r = _scan(client, cid, as_anon)
    assert r.status_code == 503 and r.json() == {"detail": PAUSED_MESSAGE}
    r = client.post("/cases", headers=as_user, json={"identifiers": [{"type": "username", "value": "kit"}]})
    assert r.status_code == 503
    assert [x["outcome"] for x in _log(store)] == ["paused", "paused"]
    assert client.get(f"/cases/{cid}/report", headers=as_anon).status_code == 200      # reads still work
    assert client.patch(f"/cases/{cid}", headers=as_anon, json={"title": "t"}).status_code == 200
    store.set_setting("scans_paused", False, "op")
    assert _scan(client, cid, as_anon).status_code == 202


def test_blocked_wins_over_paused(client, store, make_case, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    store.set_session_blocked(ANON, True, "x")
    store.set_setting("scans_paused", True, "op")
    assert _scan(client, cid, as_anon).status_code == 403


def test_logging_failures_never_change_the_answer(client, store, make_case, as_anon, monkeypatch):
    cid = make_case(scan=False)["case"]["id"]

    def boom(*_a, **_k):
        raise RuntimeError("table missing")

    for name in ("log_search", "get_session", "get_setting", "touch_session", "purge_search_log"):
        monkeypatch.setattr(store, name, boom)
    visitors.reset_touch_cache()
    assert _scan(client, cid, as_anon).status_code == 202


# ----------------------------------------------------------------------------- visitor sessions and privacy
def test_requests_touch_the_visitor_with_a_hashed_origin(client, store, as_anon):
    headers = {**as_anon, "X-Forwarded-For": f"{RAW_IP}, 10.0.0.1", "CF-IPCountry": "de",
               "User-Agent": "Mozilla/5.0 (Macintosh) Firefox/130.0"}
    assert client.post("/cases", headers=headers, json={"identifiers": [{"type": "username", "value": "kit"}]}
                       ).status_code == 201
    s = store.get_session(ANON)
    assert s["ip_hash"] == visitors.hash_ip(RAW_IP) and len(s["ip_hash"]) == 16
    assert s["country"] == "DE" and s["user_agent"].startswith("Mozilla") and s["is_anonymous"] is True
    row = _log(store)[0]
    assert row["ip_hash"] == s["ip_hash"] and row["country"] == "DE"
    dump = json.dumps([store.sessions, store.search_log, store.audit])
    assert RAW_IP not in dump and "10.0.0.1" not in dump


def test_ip_hash_is_keyed_and_short(monkeypatch):
    a = visitors.hash_ip(RAW_IP)
    assert a == visitors.hash_ip(RAW_IP) and a != visitors.hash_ip("203.0.113.78") and len(a) == 16
    monkeypatch.setattr(config, "INTERNAL_SECRET", "another-secret")
    assert visitors.hash_ip(RAW_IP) != a                     # not a plain hash anyone could rebuild


def test_socket_peer_is_used_without_forwarded_for(client, store, as_anon):
    client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "username", "value": "kit"}], "scan": False})
    assert store.get_session(ANON)["ip_hash"] == visitors.hash_ip("testclient")


@pytest.mark.parametrize("header,expected", [("GB", "GB"), ("xx", None), ("T1", None), ("", None), ("GBR", None)])
def test_country_only_from_a_valid_edge_header(client, store, as_anon, header, expected):
    client.post("/cases", headers={**as_anon, "CF-IPCountry": header},
                json={"identifiers": [{"type": "username", "value": "kit"}], "scan": False})
    assert store.get_session(ANON)["country"] == expected


def test_touch_is_throttled_to_once_a_minute(client, store, as_anon, monkeypatch):
    calls = []
    real = store.touch_session
    monkeypatch.setattr(store, "touch_session", lambda *a, **k: (calls.append(1), real(*a, **k)))
    for _ in range(3):
        client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "username", "value": "kit"}], "scan": False})
    assert len(calls) == 1


def test_signed_in_session_records_only_a_verified_email(client, store, as_user):
    client.post("/cases", headers=as_user, json={"identifiers": [{"type": "username", "value": "kit"}], "scan": False})
    s = store.get_session("00000000-0000-4000-8000-00000000000b")
    assert s["email"] == "kit@example.com" and s["is_anonymous"] is False


# ----------------------------------------------------------------------------- retention
def test_search_log_is_purged_at_most_once_a_day(client, store, make_case, as_anon, monkeypatch):
    calls = []
    monkeypatch.setattr(store, "purge_search_log", lambda days: calls.append(days) or 0)
    cid = make_case(scan=False)["case"]["id"]
    _scan(client, cid, as_anon, value="a")
    _scan(client, cid, as_anon, value="b")
    assert calls == [90]
