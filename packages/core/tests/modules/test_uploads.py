"""Uploaded photos (storage://media/uploads/...): parsing, the media modules and deletion, offline."""
import hashlib
import io
import uuid

import httpx
import pytest
from sherlock_core import uploads
from sherlock_core.jobs import normalize_target
from sherlock_core.store import MemoryStore, set_store

OWNER = "11111111-2222-4333-8444-555555555555"
OTHER = "99999999-8888-4777-8666-555555555555"
FILE = "0a0b0c0d-1e1f-4a2b-8c3d-4e5f6a7b8c9d"
PATH = f"uploads/{OWNER}/{FILE}.jpg"
VALUE = f"storage://media/{PATH}"


@pytest.fixture
def store():
    s = MemoryStore()
    set_store(s)
    yield s
    set_store(None)


def _jpeg(*, gps=False):
    Image = pytest.importorskip("PIL.Image")
    img = Image.new("RGB", (40, 30))
    img.putdata([((x * 6) % 256, (y * 8) % 256, (x * y) % 256) for y in range(30) for x in range(40)])
    e = Image.Exif()
    e[271] = "TestCam"
    if gps:
        g = e.get_ifd(0x8825)
        g[1], g[2], g[3], g[4] = "N", (51.0, 30.0, 0.0), "E", (0.0, 7.0, 30.0)
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=e)
    return buf.getvalue()


# ------------------------------------------------------------------ parsing
def test_parse_upload_and_normalize():
    up = uploads.parse_upload(VALUE)
    assert (up.bucket, up.path, up.owner_id, up.extension) == ("media", PATH, OWNER, "jpg")
    assert up.value == VALUE
    assert normalize_target("image", f"  {VALUE.upper().replace('STORAGE://', 'storage://')}  ") == VALUE
    assert normalize_target("image", "https://img.example.com/a.png") == "https://img.example.com/a.png"


@pytest.mark.parametrize("bad", [
    f"storage://media/uploads/{OWNER}/../{OTHER}/{FILE}.jpg",
    f"storage://media/uploads/{OWNER}/%2e%2e/{FILE}.jpg",
    f"storage://media/uploads/{OWNER}/sub/{FILE}.jpg",
    f"storage://avatars/uploads/{OWNER}/{FILE}.jpg",
    f"storage://media/other/{OWNER}/{FILE}.jpg",
    f"storage://media/uploads/{OWNER}/{FILE}.svg",
    f"storage://media/uploads/{OWNER}/holiday.jpg",
    f"storage://media/uploads/not-a-uuid/{FILE}.jpg",
    f"storage://media/{PATH}?x=1",
    "storage://media/",
])
def test_parse_upload_refuses_anything_else(bad):
    with pytest.raises(ValueError):
        uploads.parse_upload(bad)
    with pytest.raises(ValueError):
        normalize_target("image", bad)


def test_display_target_hides_storage_paths():
    assert uploads.display_target("image", VALUE) == "uploaded photo"
    assert uploads.display_target("image", "storage://garbage") == "uploaded photo"
    assert uploads.display_target("image", "https://x.org/a.png") == "https://x.org/a.png"
    assert uploads.display_target("username", "alice") == "alice"


# ------------------------------------------------------------------ store
def test_memory_store_objects(store):
    store.put_object("media", PATH, b"abc")
    assert store.download_object("media", PATH, max_bytes=10) == b"abc"
    with pytest.raises(ValueError):
        store.download_object("media", PATH, max_bytes=2)
    with pytest.raises(LookupError):
        store.download_object("media", "uploads/x/y.jpg", max_bytes=10)
    url = store.create_signed_url("media", PATH, 3600)
    assert url.startswith("https://") and "token=" in url
    assert store.delete_objects("media", [PATH, "uploads/missing.jpg"]) == 1
    with pytest.raises(LookupError):
        store.create_signed_url("media", PATH, 3600)


# ------------------------------------------------------------------ modules
async def test_image_meta_reads_upload_through_store(store, run, meta, respx_mock):
    pytest.importorskip("imagehash")
    data = _jpeg(gps=True)
    store.put_object("media", PATH, data)
    (row,) = await run("image_meta", "image", VALUE)   # respx_mock: any network call would fail
    assert row["status"] == "found" and not respx_mock.calls
    m = meta(row)
    assert m["sha256"] == hashlib.sha256(data).hexdigest() and m["size_bytes"] == len(data)
    assert (m["format"], m["content_type"], m["width"], m["height"]) == ("JPEG", "image/jpeg", 40, 30)
    assert m["gps_present"] is True and (m["exif"]["gps_lat"], m["exif"]["gps_lon"]) == (51.5, 0.12)
    extra = row["extra_metadata"]["extra"]
    assert extra["note"] == "This photo contains location data" and len(extra["avatar_phash"]) == 16
    assert row["extra_metadata"].get("url") is None   # no URL for a private object


async def test_image_meta_upload_without_gps_missing_and_too_big(store, run, meta, monkeypatch):
    pytest.importorskip("imagehash")
    store.put_object("media", PATH, _jpeg())
    (row,) = await run("image_meta", "image", VALUE)
    assert meta(row)["gps_present"] is False and "note" not in row["extra_metadata"]["extra"]

    monkeypatch.setattr("sherlock_core.modules.image_meta.MAX_IMAGE_BYTES", 100)
    (big,) = await run("image_meta", "image", VALUE)
    assert big["status"] == "error" and "larger than" in meta(big)["reason"]

    missing = f"storage://media/uploads/{OWNER}/{uuid.uuid4()}.png"
    (gone,) = await run("image_meta", "image", missing)
    assert gone["status"] == "error" and "no longer exists" in meta(gone)["reason"]


async def test_reverse_image_links_use_a_signed_url(store, run, meta):
    store.put_object("media", PATH, b"x")
    (row,) = await run("reverse_image_links", "image", VALUE)
    links = row["extra_metadata"]["extra"]["links"].split(", ")
    assert len(links) == 4 and all("storage.test%2Fobject%2Fsign" in u for u in links)
    assert "stops working after an hour" in row["extra_metadata"]["extra"]["note"]
    assert meta(row)["expires_s"] == 3600
    (gone,) = await run("reverse_image_links", "image", f"storage://media/uploads/{OWNER}/{uuid.uuid4()}.png")
    assert gone["status"] == "error"


async def test_reverse_image_links_for_urls_have_no_expiry_note(run, meta):
    (row,) = await run("reverse_image_links", "image", "https://img.example.com/a.png")
    assert "note" not in row["extra_metadata"]["extra"] and "expires_s" not in meta(row)


async def test_reverse_image_sends_the_signed_url_to_serpapi(store, run, meta, respx_mock, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "test-key")
    store.put_object("media", PATH, b"x")
    route = respx_mock.get("https://serpapi.com/search.json").respond(
        json={"visual_matches": [{"position": 1, "title": "A copy", "source": "Example", "link": "https://example.org/p",
                                  "thumbnail": "https://example.org/t.jpg"}]})
    (row,) = await run("reverse_image", "image", VALUE)
    sent = route.calls.last.request.url.params["url"]
    assert sent.startswith("https://storage.test/object/sign/media/uploads/") and "token=" in sent
    assert row["extra_metadata"]["url"] == "https://example.org/p" and meta(row)["title"] == "A copy"
    assert sent not in str(row)   # the signed URL is not kept on match rows

    def echo(request):
        return httpx.Response(400, json={"error": f"Couldn't fetch {request.url.params['url']}"})
    route.side_effect = echo
    (err,) = await run("reverse_image", "image", VALUE)
    assert err["status"] == "error" and "storage.test" not in meta(err)["reason"]
    assert meta(err)["reason"] == "Couldn't fetch <image>"


# ------------------------------------------------------------------ deletion
def test_delete_case_uploads_only_removes_the_owners_objects(store):
    other_path = f"uploads/{OTHER}/{FILE}.png"
    second = f"uploads/{OWNER}/{uuid.uuid4()}.webp"
    for p in (PATH, other_path, second):
        store.put_object("media", p, b"x")
    case = store.create_case([{"type": "image", "value": VALUE},
                              {"type": "image", "value": f"storage://media/{other_path}"}], owner_id=OWNER)
    store.enqueue_jobs([{"case_id": case["id"], "batch_id": str(uuid.uuid4()), "queue": "media", "module": "image_meta",
                         "target_type": "image", "target_value": f"storage://media/{second}", "params": {}}])
    assert uploads.delete_case_uploads(store, case) == 2
    assert set(store.objects) == {("media", other_path)}


def test_delete_case_uploads_never_raises(store, monkeypatch):
    case = store.create_case([{"type": "image", "value": VALUE}], owner_id=OWNER)

    def boom(*a, **k):
        raise RuntimeError("storage down")
    monkeypatch.setattr(store, "delete_objects", boom)
    assert uploads.delete_case_uploads(store, case) == 0
