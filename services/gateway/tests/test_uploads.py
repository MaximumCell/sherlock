"""Image searches on uploaded photos: ownership, logging and deletion with the case."""
import uuid

import pytest
from sherlock_core.modules.base import Module

USER = "00000000-0000-4000-8000-00000000000b"    # the "user" token in conftest.py
OTHER = "00000000-0000-4000-8000-00000000000c"   # the "other" token


def upload_value(owner=USER, ext="jpg"):
    return f"storage://media/uploads/{owner}/{uuid.uuid4()}.{ext}"


def path_of(value):
    return value.removeprefix("storage://media/")


class FakeImageModule(Module):
    name = "image_meta"
    title = "Image metadata"
    description = "fake"
    inputs = ("image",)
    queue = "media"

    async def run(self, target, ctx):
        return []


@pytest.fixture(autouse=True)
def image_modules(registry):
    registry["image_meta"] = FakeImageModule()


def search(client, value, headers):
    return client.post("/cases", headers=headers, json={"identifiers": [{"type": "image", "value": value}], "scan": True})


def test_own_upload_is_accepted_and_logged_as_uploaded_photo(client, store, as_user):
    value = upload_value()
    r = search(client, value, as_user)
    assert r.status_code == 201, r.text
    case = r.json()["case"]
    assert case["identifiers"] == [{"type": "image", "value": value}]   # the path stays on the case
    assert case["title"] == "Uploaded photo"
    assert {j["target_value"] for j in r.json()["jobs"]} == {value}
    (row,) = store.search_log
    assert (row["target_type"], row["target_value"], row["outcome"]) == ("image", "uploaded photo", "accepted")
    assert "storage://" not in str(store.search_log)


def test_scan_route_accepts_own_upload(client, make_case, as_user):
    cid = make_case(headers=as_user, scan=False)["case"]["id"]
    r = client.post(f"/cases/{cid}/scan", headers=as_user, json={"type": "image", "value": upload_value()})
    assert r.status_code == 202, r.text


def test_someone_elses_upload_is_refused(client, store, as_user, make_case):
    r = search(client, upload_value(owner=OTHER), as_user)
    assert r.status_code == 403 and r.json()["detail"] == "This uploaded photo belongs to another account."
    assert store.cases == {}
    (row,) = store.search_log
    assert (row["target_value"], row["outcome"]) == ("uploaded photo", "forbidden")

    cid = make_case(headers=as_user, scan=False)["case"]["id"]
    r = client.post(f"/cases/{cid}/scan", headers=as_user, json={"type": "image", "value": upload_value(owner=OTHER)})
    assert r.status_code == 403
    assert store.list_jobs(cid) == []


@pytest.mark.parametrize("value", [
    f"storage://media/uploads/{USER}/../{OTHER}/{uuid.uuid4()}.jpg",
    f"storage://media/uploads/{USER}/%2e%2e/{uuid.uuid4()}.jpg",
    f"storage://media/uploads/{USER}/a/{uuid.uuid4()}.jpg",
    f"storage://avatars/uploads/{USER}/{uuid.uuid4()}.jpg",
    f"storage://media/{USER}/{uuid.uuid4()}.jpg",
    f"storage://media/uploads/{USER}/photo.jpg",
])
def test_malformed_storage_values_are_invalid(client, store, as_user, value):
    r = search(client, value, as_user)
    assert r.status_code == 400 and "uploaded photo" in r.json()["detail"]
    assert store.cases == {}
    assert store.search_log[0]["target_value"] == "uploaded photo"   # even a bad path is never logged


def test_http_image_urls_are_unchanged(client, store, as_user):
    r = search(client, "https://img.example.com/a.png", as_user)
    assert r.status_code == 201
    assert r.json()["case"]["title"] == "https://img.example.com/a.png"
    assert store.search_log[0]["target_value"] == "https://img.example.com/a.png"
    assert search(client, "http://127.0.0.1/a.png", as_user).status_code == 400


def test_owner_delete_removes_uploaded_objects(client, store, as_user):
    value = upload_value()
    store.put_object("media", path_of(value), b"photo")
    keep = upload_value(owner=OTHER)
    store.put_object("media", path_of(keep), b"someone else")
    cid = search(client, value, as_user).json()["case"]["id"]
    assert client.delete(f"/cases/{cid}", headers=as_user).status_code == 204
    assert store.get_case(cid) is None
    assert set(store.objects) == {("media", path_of(keep))}


def test_operator_delete_removes_uploaded_objects(client, store, as_user, as_admin):
    value = upload_value()
    store.put_object("media", path_of(value), b"photo")
    cid = search(client, value, as_user).json()["case"]["id"]
    second = upload_value()
    store.put_object("media", path_of(second), b"photo 2")
    assert client.post(f"/cases/{cid}/scan", headers=as_user, json={"type": "image", "value": second}).status_code == 202
    assert client.delete(f"/admin/cases/{cid}", headers=as_admin).status_code == 204
    assert store.get_case(cid) is None and store.objects == {}


def test_delete_still_works_when_storage_fails(client, store, as_user, monkeypatch):
    value = upload_value()
    cid = search(client, value, as_user).json()["case"]["id"]

    def boom(*a, **k):
        raise RuntimeError("storage down")
    monkeypatch.setattr(store, "delete_objects", boom)
    assert client.delete(f"/cases/{cid}", headers=as_user).status_code == 204
    assert store.get_case(cid) is None


def test_uploaded_photos_are_not_a_shared_target():
    from gateway.insights import target_session_counts
    from sherlock_core.store import aggregate_searches
    rows = [{"user_id": u, "target_type": "image", "target_value": "uploaded photo", "outcome": "accepted",
             "created_at": "2026-11-20T10:00:00+00:00"} for u in ("a", "b", "c")]
    assert target_session_counts(rows) == {}
    assert aggregate_searches(rows)["targets"] == []
