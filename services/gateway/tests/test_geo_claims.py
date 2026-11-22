"""Photo claims: validated with an image search, and re-running the location checks alone."""
import uuid

import pytest
from sherlock_core import config
from sherlock_core.modules.base import Module

USER = "00000000-0000-4000-8000-00000000000b"
OTHER = "00000000-0000-4000-8000-00000000000c"
IMG = "https://img.example.com/landmark.jpg"
CLAIM = {"place": "Eiffel Tower, Paris", "lat": 48.85837, "lon": 2.294481, "taken_at": "2025-06-14T20:40:00+02:00"}


def _fake(name_):
    class Fake(Module):
        name = name_
        title = name_
        description = "fake"
        inputs = ("image",)
        queue = "media"

        async def run(self, target, ctx):
            return []
    return Fake()


@pytest.fixture(autouse=True)
def image_modules(registry):
    for n in ("image_meta", "geo_context", "reverse_image"):
        registry[n] = _fake(n)


def photo_case(client, headers, **extra):
    r = client.post("/cases", headers=headers, json={"identifiers": [{"type": "image", "value": IMG}], **extra})
    assert r.status_code == 201, r.text
    return r.json()


def test_claim_goes_to_every_image_job_rounded(client, as_anon):
    jobs = photo_case(client, as_anon, claim=CLAIM)["jobs"]
    assert {j["module"] for j in jobs} == {"image_meta", "geo_context", "reverse_image"}
    for j in jobs:
        assert j["params"] == {"claim": {"place": "Eiffel Tower, Paris", "lat": 48.86, "lon": 2.29,
                                         "taken_at": "2025-06-14T20:40:00+02:00"}}


def test_claim_on_the_scan_route(client, make_case, as_anon):
    cid = make_case(scan=False)["case"]["id"]
    r = client.post(f"/cases/{cid}/scan", headers=as_anon,
                    json={"type": "image", "value": IMG, "claim": {"place": "Paris"}})
    assert r.status_code == 202 and r.json()["jobs"][0]["params"] == {"claim": {"place": "Paris"}}
    r = client.post(f"/cases/{cid}/scan", headers=as_anon,
                    json={"type": "username", "value": "octocat", "claim": {"place": "Paris"}})
    assert r.status_code == 400 and "photo searches" in r.json()["detail"]


@pytest.mark.parametrize(("claim", "fragment"), [
    ({"lat": 48.8}, "both lat and lon"),
    ({"lat": 123, "lon": 2}, "less than or equal to 90"),
    ({"taken_at": "2025-06-14T20:40:00"}, "time zone offset"),
    ({"taken_at": "2999-01-01T00:00:00+00:00"}, "in the future"),
    ({"place": "x" * 121}, "at most 120"),
    ({"address": "1 Main Street"}, "Extra inputs are not permitted"),
])
def test_invalid_claims_are_422(client, as_anon, claim, fragment):
    r = client.post("/cases", headers=as_anon, json={"identifiers": [{"type": "image", "value": IMG}], "claim": claim})
    assert r.status_code == 422 and fragment in r.json()["detail"], r.text


def test_claim_needs_a_photo(client, as_anon):
    r = client.post("/cases", headers=as_anon,
                    json={"identifiers": [{"type": "username", "value": "octocat"}], "claim": {"place": "Paris"}})
    assert r.status_code == 400 and "photo" in r.json()["detail"]


def test_geo_check_reruns_only_geo_context(client, store, woken, as_anon):
    cid = photo_case(client, as_anon)["case"]["id"]
    woken.clear()
    r = client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={"claim": CLAIM})
    assert r.status_code == 202, r.text
    (job,) = r.json()["jobs"]
    assert job["module"] == "geo_context" and job["target_value"] == IMG
    assert job["params"]["claim"]["lat"] == 48.86
    assert woken == [["media"]]
    assert any(a["action"] == "photo_claim_set" for a in store.list_audit(cid))
    assert store.search_log[-1]["modules"] == ["geo_context"] and store.search_log[-1]["outcome"] == "accepted"

    # a second change cancels the first, still unfinished, check
    r2 = client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={"claim": None})
    assert r2.status_code == 202 and r2.json()["jobs"][0]["params"] == {}
    assert store.get_job(job["id"])["status"] == "cancelled"


def test_geo_check_also_reruns_the_optional_context_modules(client, registry, as_anon):
    registry["geo_webcams"] = _fake("geo_webcams")
    cid = photo_case(client, as_anon)["case"]["id"]
    r = client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={"claim": {"place": "Paris"}})
    assert r.status_code == 202
    assert sorted(j["module"] for j in r.json()["jobs"]) == ["geo_context", "geo_webcams"]


def test_geo_check_ignores_the_active_search_limit_but_has_its_own(client, store, as_anon, monkeypatch):
    monkeypatch.setattr(config, "ACTIVE_SEARCHES_PER_SESSION", 1)
    monkeypatch.setattr(config, "GEO_CHECKS_PER_CASE_PER_10M", 2)
    cid = photo_case(client, as_anon)["case"]["id"]          # its jobs are still queued
    for _ in range(2):
        assert client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={"claim": {"place": "Paris"}}).status_code == 202
    r = client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={"claim": {"place": "Paris"}})
    assert r.status_code == 429 and "re-checks of this photo" in r.json()["detail"]
    assert r.headers["retry-after"]
    assert store.search_log[-1]["outcome"] == "burst_limited"


def test_geo_check_respects_sign_in_pause_and_ownership(client, store, as_anon, as_user, as_other, monkeypatch):
    cid = photo_case(client, as_anon)["case"]["id"]
    assert client.post(f"/cases/{cid}/geo-check", headers=as_other, json={}).status_code == 403
    monkeypatch.setattr(config, "REQUIRE_SIGN_IN", True)
    r = client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={})
    assert r.status_code == 401 and store.search_log[-1]["outcome"] == "sign_in_required"
    monkeypatch.setattr(config, "REQUIRE_SIGN_IN", False)
    store.set_setting("scans_paused", True)
    assert client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={}).status_code == 503


def test_geo_check_needs_a_photo_of_this_case(client, make_case, as_anon, as_user):
    cid = make_case()["case"]["id"]
    r = client.post(f"/cases/{cid}/geo-check", headers=as_anon, json={})
    assert r.status_code == 400 and r.json()["detail"] == "This investigation has no photo to check."
    pid = photo_case(client, as_anon)["case"]["id"]
    r = client.post(f"/cases/{pid}/geo-check", headers=as_anon, json={"value": "https://img.example.com/other.jpg"})
    assert r.status_code == 400 and "not part of this investigation" in r.json()["detail"]
    r = client.post(f"/cases/{pid}/geo-check", headers=as_anon, json={"claim": {"lat": 1}})
    assert r.status_code == 422


def test_geo_check_on_someone_elses_upload_is_refused(client, store, as_user):
    value = f"storage://media/uploads/{OTHER}/{uuid.uuid4()}.jpg"
    case = store.create_case([{"type": "image", "value": value}], owner_id=USER)
    r = client.post(f"/cases/{case['id']}/geo-check", headers=as_user, json={})
    assert r.status_code == 403 and "another account" in r.json()["detail"]


def test_demo_cases_are_read_only(client, store, as_anon):
    case = store.create_case([{"type": "image", "value": IMG}], owner_id=None)
    store.update_case(case["id"], {"is_demo": True})
    assert client.post(f"/cases/{case['id']}/geo-check", headers=as_anon, json={}).status_code == 403
