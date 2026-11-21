"""Search limits: sign-in, active search, burst/session, origin, daily, backlog; their order, outcomes,
Retry-After; operator exemption; batch cancel; queue status."""
import pytest
from gateway import insights as I
from gateway.routers.queue import queue_status
from gateway.service import ACTIVE_SEARCH_MESSAGE, BUSY_MESSAGE, SIGN_IN_MESSAGE, wait_text
from sherlock_core import config


def auth(who):
    return {"Authorization": f"Bearer {who}"}


USER, OTHER_USER, ADMIN = auth("user"), auth("unverified"), auth("admin")
USER_ID = "00000000-0000-4000-8000-00000000000b"


def _new(client, headers, value="octocat", type_="username", ip=None):
    h = {**headers, **({"X-Forwarded-For": ip} if ip else {})}
    return client.post("/cases", headers=h, json={"identifiers": [{"type": type_, "value": value}]})


def _scan(client, cid, headers, value="kit", type_="username", ip=None):
    h = {**headers, **({"X-Forwarded-For": ip} if ip else {})}
    return client.post(f"/cases/{cid}/scan", headers=h, json={"type": type_, "value": value})


def _finish(store):
    for j in store.jobs.values():
        if j["status"] in ("queued", "running"):
            j["status"] = "succeeded"


def _last(store):
    return store.list_searches(limit=1)[0]


def _empty_case(client, headers):
    r = client.post("/cases", headers=headers, json={"identifiers": [{"type": "username", "value": "x1"}],
                                                      "scan": False})
    assert r.status_code == 201
    return r.json()["case"]["id"]


# ----------------------------------------------------------------------------- sign-in
def test_anonymous_search_needs_sign_in(client, store, limits, as_anon):
    r = _new(client, as_anon)
    assert r.status_code == 401 and r.json()["detail"] == SIGN_IN_MESSAGE
    assert _last(store)["outcome"] == "sign_in_required" and store.cases == {}
    cid = _empty_case(client, as_anon)               # creating a case without scanning is not a search
    r = _scan(client, cid, as_anon)
    assert r.status_code == 401 and _last(store)["outcome"] == "sign_in_required"
    assert store.list_jobs(cid) == []


def test_signed_in_search_is_allowed(client, store, limits):
    assert _new(client, USER).status_code == 201
    assert _last(store)["outcome"] == "accepted"


def test_require_sign_in_false_restores_anonymous_searching(client, store, limits, monkeypatch, as_anon):
    monkeypatch.setattr(config, "REQUIRE_SIGN_IN", False)
    assert _new(client, as_anon).status_code == 201
    # name searches still need an account
    cid = _empty_case(client, as_anon)
    _finish(store)
    assert _scan(client, cid, as_anon, "Ada Lovelace", "name").status_code == 403


def test_demo_cases_stay_readable_without_an_account(client, store, limits, as_anon):
    demo = store.create_case([{"type": "username", "value": "demo"}], owner_id=None, title="Demo")
    store.update_case(demo["id"], {"is_demo": True})
    assert client.get(f"/cases/{demo['id']}/exposure", headers=as_anon).status_code == 200


def test_blocked_and_paused_come_before_sign_in(client, store, limits, as_anon):
    store.touch_session("00000000-0000-4000-8000-00000000000a", is_anonymous=True)
    store.set_setting("scans_paused", True)
    assert _new(client, as_anon).status_code == 503
    store.set_session_blocked("00000000-0000-4000-8000-00000000000a", True)
    assert _new(client, as_anon).status_code == 403


def test_sign_in_comes_before_invalid(client, store, limits, as_anon):
    r = _new(client, as_anon, value="no spaces allowed")
    assert r.status_code == 401


# ----------------------------------------------------------------------------- active search + batch cancel
def test_one_unfinished_search_per_session_then_stop_it(client, store, limits):
    first = _new(client, USER).json()
    cid, batch = first["case"]["id"], first["jobs"][0]["batch_id"]
    r = _new(client, USER, value="hubot")
    assert r.status_code == 429 and r.json()["detail"] == ACTIVE_SEARCH_MESSAGE
    assert r.json()["active_search"] == {"case_id": cid, "batch_ids": [batch]}
    assert "retry-after" not in r.headers
    assert _last(store)["outcome"] == "active_search"
    assert _scan(client, cid, USER).status_code == 429

    stop = client.post(f"/cases/{cid}/batches/{batch}/cancel", headers=USER)
    assert stop.status_code == 200
    body = stop.json()
    assert body["cancelled"] == len(first["jobs"]) and {j["status"] for j in body["jobs"]} == {"cancelled"}
    assert any(a["action"] == "batch_cancelled" for a in store.list_audit(cid))
    assert _new(client, USER, value="hubot").status_code == 201


def test_another_session_is_not_blocked_by_my_search(client, store, limits):
    assert _new(client, USER).status_code == 201
    assert _new(client, OTHER_USER).status_code == 201


def test_batch_cancel_checks_ownership_and_existence(client, store, limits):
    first = _new(client, USER).json()
    cid, batch = first["case"]["id"], first["jobs"][0]["batch_id"]
    assert client.post(f"/cases/{cid}/batches/{batch}/cancel", headers=OTHER_USER).status_code == 403
    assert client.post(f"/cases/{cid}/batches/not-a-uuid/cancel", headers=USER).status_code == 404
    assert client.post(f"/cases/{cid}/batches/{cid}/cancel", headers=USER).status_code == 404
    # finished jobs are left alone; cancelling twice is harmless
    assert client.post(f"/cases/{cid}/batches/{batch}/cancel", headers=USER).json()["cancelled"] > 0
    assert client.post(f"/cases/{cid}/batches/{batch}/cancel", headers=USER).json()["cancelled"] == 0


# ----------------------------------------------------------------------------- burst / origin / daily
def test_burst_limit_per_session_with_retry_after(client, store, limits):
    cid = _empty_case(client, USER)
    for i in range(3):
        assert _scan(client, cid, USER, f"u{i}").status_code == 202
        _finish(store)
    r = _scan(client, cid, USER, "u3")
    assert r.status_code == 429 and "up to 3 every 10 minutes" in r.json()["detail"]
    assert 1 <= int(r.headers["retry-after"]) <= 601 and "search again in about" in r.json()["detail"]
    assert _last(store)["outcome"] == "burst_limited"
    # a refused search costs nothing: the counter stays at the limit
    assert store.rate_limit_count(f"burst:session:{USER_ID}:10m", 600) == 3


def test_origin_limit_survives_a_new_session(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SEARCHES_PER_ORIGIN_PER_10M", 2)
    ip = "198.51.100.7"
    assert _new(client, USER, "one", ip=ip).status_code == 201
    _finish(store)
    assert _new(client, USER, "two", ip=ip).status_code == 201
    _finish(store)
    r = _new(client, OTHER_USER, "three", ip=ip)        # a fresh session from the same network
    assert r.status_code == 429 and "from your network" in r.json()["detail"]
    assert "retry-after" in r.headers and _last(store)["outcome"] == "burst_limited"
    assert _new(client, OTHER_USER, "three", ip="198.51.100.8").status_code == 201


def test_origin_daily_limit(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SEARCHES_PER_ORIGIN_PER_DAY", 1)
    assert _new(client, USER, "one").status_code == 201
    _finish(store)
    r = _new(client, OTHER_USER, "two")
    assert r.status_code == 429 and "Daily limit reached for your network" in r.json()["detail"]
    assert _last(store)["outcome"] == "rate_limited" and int(r.headers["retry-after"]) <= 86401


def test_daily_session_limit_has_retry_after(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 1)
    assert _new(client, USER, "one").status_code == 201
    _finish(store)
    r = _new(client, USER, "two")
    assert r.status_code == 429 and "Daily limit" in r.json()["detail"] and "retry-after" in r.headers


def test_create_case_counts_every_target_against_the_burst(client, store, limits):
    r = client.post("/cases", headers=USER, json={"identifiers": [
        {"type": "username", "value": f"u{i}"} for i in range(4)]})
    assert r.status_code == 429 and store.cases == {}
    assert [x["outcome"] for x in store.list_searches(limit=10)] == ["burst_limited"] * 4


# ----------------------------------------------------------------------------- backlog
def _backlog(store, n, queue="identity"):
    other = store.create_case([{"type": "username", "value": "z"}], owner_id="someone-else")["id"]
    store.enqueue_jobs([{"case_id": other, "queue": queue, "module": "handles", "target_type": "username",
                         "target_value": f"z{i}"} for i in range(n)])


def test_backlog_guard_refuses_with_503(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "QUEUE_BACKLOG_MAX", 2)
    _backlog(store, 3)
    r = _new(client, USER)
    assert r.status_code == 503 and r.json()["detail"] == BUSY_MESSAGE and r.headers["retry-after"] == "180"
    assert _last(store)["outcome"] == "busy"
    assert store.rate_limit_count(f"burst:session:{USER_ID}:10m", 600) == 0      # nothing counted
    assert _new(client, USER, "example.com", "domain").status_code == 201     # infra queue is fine


def test_backlog_at_the_threshold_is_still_allowed(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "QUEUE_BACKLOG_MAX", 2)
    _backlog(store, 2)
    assert _new(client, USER).status_code == 201


# ----------------------------------------------------------------------------- operator
def test_operator_is_exempt_from_session_and_origin_limits(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SEARCHES_PER_ORIGIN_PER_10M", 1)
    for i in range(5):                                 # burst 3, origin 1, and never waits for the last one
        assert _new(client, ADMIN, f"op{i}").status_code == 201


def test_operator_is_not_exempt_from_the_backlog(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "QUEUE_BACKLOG_MAX", 1)
    _backlog(store, 2)
    assert _new(client, ADMIN).status_code == 503


# ----------------------------------------------------------------------------- order
def test_invalid_comes_before_active_search(client, store, limits):
    assert _new(client, USER).status_code == 201
    assert _new(client, USER, "bad value!").status_code == 400


def test_active_search_comes_before_burst_and_backlog(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SEARCHES_PER_SESSION_PER_10M", 1)
    monkeypatch.setattr(config, "QUEUE_BACKLOG_MAX", 1)
    assert _new(client, USER).status_code == 201       # its own 2 jobs now fill the backlog
    assert _new(client, USER, "two").json()["active_search"]


def test_burst_comes_before_origin_daily_and_backlog(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SEARCHES_PER_SESSION_PER_10M", 1)
    monkeypatch.setattr(config, "SEARCHES_PER_ORIGIN_PER_10M", 1)
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 1)
    monkeypatch.setattr(config, "QUEUE_BACKLOG_MAX", 1)
    assert _new(client, USER).status_code == 201
    _finish(store)
    _backlog(store, 5)
    r = _new(client, USER, "two")
    assert r.status_code == 429 and "up to 1 every 10 minutes" in r.json()["detail"]
    assert "network" not in r.json()["detail"]


def test_origin_comes_before_daily(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SEARCHES_PER_ORIGIN_PER_10M", 1)
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 1)
    assert _new(client, USER).status_code == 201
    _finish(store)
    assert "network" in _new(client, USER, "two").json()["detail"]


def test_daily_comes_before_backlog(client, store, limits, monkeypatch):
    monkeypatch.setattr(config, "SCANS_PER_SESSION_PER_DAY", 1)
    monkeypatch.setattr(config, "QUEUE_BACKLOG_MAX", 1)
    assert _new(client, USER).status_code == 201
    _finish(store)
    _backlog(store, 5)
    assert _new(client, USER, "two").status_code == 429


# ----------------------------------------------------------------------------- logging before the migration
def test_new_outcomes_fall_back_when_the_database_rejects_them(client, store, limits, monkeypatch):
    original = store.log_search

    def old_check(row):
        if row["outcome"] in ("burst_limited", "active_search", "busy", "sign_in_required"):
            raise RuntimeError("violates check constraint search_log_outcome_check")
        return original(row)

    monkeypatch.setattr(store, "log_search", old_check)
    assert _new(client, USER).status_code == 201
    r = _new(client, USER, "two")
    assert r.status_code == 429                         # the answer is unchanged
    row = _last(store)
    assert row["outcome"] == "rate_limited" and row["detail"] == ACTIVE_SEARCH_MESSAGE


# ----------------------------------------------------------------------------- queue status
def _row(case, status="queued", t="2026-11-21T10:00:00", queue="identity"):
    return {"case_id": case, "queue": queue, "status": status, "created_at": t}


def test_queue_status_counts_searches_ahead():
    rows = [_row("a", "running", "2026-11-21T10:00:00"), _row("a", "queued", "2026-11-21T10:00:00"),
            _row("b", "queued", "2026-11-21T10:01:00"),
            _row("me", "queued", "2026-11-21T10:02:00"), _row("me", "queued", "2026-11-21T10:02:00"),
            _row("later", "queued", "2026-11-21T10:03:00")]
    out = queue_status("me", rows, concurrency=3, avg_job_s=15)
    assert out == {"case_id": "me", "queued": 2, "running": 0, "waiting": True, "ahead": 2, "jobs_ahead": 3,
                   "estimated_wait_s": 30}


def test_queue_status_not_waiting_once_a_job_runs_or_nobody_is_ahead():
    assert queue_status("me", [_row("me", "running"), _row("me")], concurrency=3, avg_job_s=15)["waiting"] is False
    alone = queue_status("me", [_row("me")], concurrency=3, avg_job_s=15)
    assert alone["waiting"] is False and alone["ahead"] == 0 and alone["estimated_wait_s"] is None


def test_queue_status_route_returns_counts_only(client, store, limits):
    _backlog(store, 4)
    mine = _new(client, USER).json()["case"]["id"]
    r = client.get(f"/queue/status?case_id={mine}", headers=USER)
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"case_id", "queued", "running", "waiting", "ahead", "jobs_ahead", "estimated_wait_s"}
    assert body["case_id"] == mine and body["ahead"] == 1 and body["jobs_ahead"] == 4 and body["waiting"] is True
    assert all(isinstance(v, (int, bool)) for k, v in body.items() if k not in ("case_id", "estimated_wait_s"))
    assert client.get(f"/queue/status?case_id={mine}", headers=OTHER_USER).status_code == 403
    assert client.get("/queue/status?case_id=nope", headers=USER).status_code == 404
    assert client.get(f"/queue/status?case_id={mine}").status_code == 401


# ----------------------------------------------------------------------------- misc
@pytest.mark.parametrize(("seconds", "text"), [(30, "about a minute"), (240, "about 4 minutes"),
                                               (3600, "about an hour"), (7 * 3600, "about 7 hours")])
def test_wait_text(seconds, text):
    assert wait_text(seconds) == text


def test_burst_limit_flag():
    rows = [{"created_at": "2026-11-21T10:00:00+00:00", "target_type": "username", "target_value": "kit",
             "outcome": "burst_limited", "user_id": "u"}]
    flags = I.session_flags(rows, ip_hash=None, target_sessions={}, origin_sessions={})
    assert [f["label"] for f in flags] == ["Hit the burst limit 1 time"]
