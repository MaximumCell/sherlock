"""Media-queue modules, the avatar hashing helper and the scrape enrichment, offline."""
import hashlib
import io

import httpx
import pytest
from sherlock_core.models import make_finding
from sherlock_core.modules import get_module
from sherlock_core.modules._util import is_public_http_url
from sherlock_core.modules.reverse_image import manual_search_links
from sherlock_core.modules.scrape import enrich_url

IMG = "https://img.example.com/photo.jpg"


def _image_bytes(fmt="PNG", *, exif=False, seed=0):
    Image = pytest.importorskip("PIL.Image")
    img = Image.new("RGB", (64, 48))
    img.putdata([((x * 4 + seed * 40) % 256, (y * 5) % 256, (x * y) % 256) for y in range(48) for x in range(64)])
    kwargs = {}
    if exif:
        e = Image.Exif()
        e[271], e[272], e[305], e[306] = "ExampleCam", "Model X", "ExampleOS 1.0", "2024:05:06 07:08:09"
        gps = e.get_ifd(0x8825)
        gps[1], gps[2], gps[3], gps[4] = "N", (48.0, 51.0, 29.6), "W", (2.0, 17.0, 40.2)
        kwargs["exif"] = e
    buf = io.BytesIO()
    img.save(buf, fmt, **kwargs)
    return buf.getvalue()


# ------------------------------------------------------------------ image_meta
async def test_image_meta_hash_dimensions_and_coarse_gps(respx_mock, run, meta):
    pytest.importorskip("imagehash")
    data = _image_bytes("JPEG", exif=True)
    respx_mock.get(IMG).respond(content=data, headers={"content-type": "image/jpeg"})
    (row,) = await run("image_meta", "image", IMG)
    m = meta(row)
    phash = row["extra_metadata"]["extra"]["avatar_phash"]
    assert len(phash) == 16 and int(phash, 16) >= 0  # 64-bit hash as hex
    assert (m["format"], m["width"], m["height"]) == ("JPEG", 64, 48)
    assert m["sha256"] == hashlib.sha256(data).hexdigest() and m["size_bytes"] == len(data)
    assert m["exif"]["camera_make"] == "ExampleCam" and m["exif"]["camera_model"] == "Model X"
    assert m["exif"]["software"] == "ExampleOS 1.0" and m["exif"]["datetime"] == "2024:05:06 07:08:09"
    assert m["gps_present"] is True
    assert (m["exif"]["gps_lat"], m["exif"]["gps_lon"]) == (48.86, -2.29)  # rounded to 2 decimals


async def test_image_meta_without_exif(respx_mock, run, meta):
    pytest.importorskip("imagehash")
    respx_mock.get(IMG).respond(content=_image_bytes("PNG"), headers={"content-type": "image/png"})
    (row,) = await run("image_meta", "image", IMG)
    m = meta(row)
    assert m["format"] == "PNG" and "exif" not in m and m["gps_present"] is False
    assert len(row["extra_metadata"]["extra"]["avatar_phash"]) == 16


async def test_image_meta_rejects_bad_inputs(respx_mock, run, meta, monkeypatch):
    pytest.importorskip("imagehash")
    respx_mock.get("https://img.example.com/page").respond(html="<html></html>")
    (not_image,) = await run("image_meta", "image", "https://img.example.com/page")
    assert not_image["status"] == "error" and "content type" in meta(not_image)["reason"]

    monkeypatch.setattr("sherlock_core.modules.image_meta.MAX_IMAGE_BYTES", 100)
    respx_mock.get(IMG).respond(content=_image_bytes("PNG"), headers={"content-type": "image/png"})
    (too_big,) = await run("image_meta", "image", IMG)
    assert too_big["status"] == "error" and "larger than" in meta(too_big)["reason"]

    respx_mock.get("https://img.example.com/broken.png").respond(
        content=b"not really a png", headers={"content-type": "image/png"},
    )
    (broken,) = await run("image_meta", "image", "https://img.example.com/broken.png")
    assert broken["status"] == "error" and "readable image" in meta(broken)["reason"]

    for internal in ("http://127.0.0.1/a.png", "http://localhost/a.png", "http://10.0.0.5/a.png", "ftp://x.org/a"):
        (refused,) = await run("image_meta", "image", internal)  # no request is made
        assert refused["status"] == "error"


async def test_image_download_refuses_redirect_to_internal_host(respx_mock, run, meta):
    pytest.importorskip("imagehash")
    respx_mock.get(IMG).respond(302, headers={"location": "http://169.254.169.254/latest/meta-data"})
    (row,) = await run("image_meta", "image", IMG)
    assert row["status"] == "error" and "public" in meta(row)["reason"]


def test_public_url_check():
    assert is_public_http_url("https://example.com/a.png")
    assert not is_public_http_url("http://192.168.1.10/a.png")
    assert not is_public_http_url("http://[::1]/a.png")
    assert not is_public_http_url("http://intranet/a.png")
    assert not is_public_http_url("file:///etc/passwd")


# ------------------------------------------------------------------ reverse_image(+links)
async def test_reverse_image_links_needs_no_key(run, meta):
    assert get_module("reverse_image_links").requires_env == ()
    (row,) = await run("reverse_image_links", "image", "https://img.example.com/a b,c.jpg?x=1")
    links = row["extra_metadata"]["extra"]["links"].split(", ")
    assert len(links) == 4 and links == list(manual_search_links("https://img.example.com/a b,c.jpg?x=1").values())
    assert links[0].startswith("https://lens.google.com/uploadbyurl?url=https%3A%2F%2Fimg.example.com%2F")
    assert any("yandex.com" in u for u in links) and any("tineye.com" in u for u in links)
    assert any("bing.com" in u for u in links)
    assert set(meta(row)["engines"]) == {"google_lens", "yandex", "tineye", "bing"}
    (bad,) = await run("reverse_image_links", "image", "not-a-url")
    assert bad["status"] == "error"


async def test_reverse_image_google_lens(respx_mock, run, fx, meta, monkeypatch):
    mod = get_module("reverse_image")
    monkeypatch.delenv("SERPAPI_KEY", raising=False)
    assert mod.requires_env == ("SERPAPI_KEY",) and mod.available() is False
    monkeypatch.setenv("SERPAPI_KEY", "test-key")
    assert mod.available() is True
    route = respx_mock.get("https://serpapi.com/search.json").respond(json=fx("serpapi_google_lens"))
    rows = await run("reverse_image", "image", IMG)
    params = route.calls.last.request.url.params
    assert (params["engine"], params["type"], params["url"], params["api_key"]) == ("google_lens", "all", IMG, "test-key")
    assert [r["extra_metadata"]["url"] for r in rows] == ["https://en.wikipedia.org/wiki/Example", "https://example.org/logo"]
    assert meta(rows[0]) == {
        "title": "Example logo - Wikipedia", "source": "Wikipedia",
        "thumbnail": "https://encrypted-tbn0.gstatic.com/images?q=tbn:1", "position": 1, "match": "similar",
    }
    assert rows[0]["finding_key"] != rows[1]["finding_key"]


async def test_reverse_image_caps_no_results_and_bad_key(respx_mock, run, meta, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "test-key")
    many = [{"position": i, "title": f"t{i}", "link": f"https://example.org/{i}"} for i in range(1, 60)]
    route = respx_mock.get("https://serpapi.com/search.json").respond(json={"visual_matches": many})
    assert len(await run("reverse_image", "image", IMG)) == 20
    route.respond(json={"error": "Google Lens hasn't returned any results for this query."})
    assert await run("reverse_image", "image", IMG) == []
    route.respond(401, json={"error": "Invalid API key."})
    (err,) = await run("reverse_image", "image", IMG)
    assert err["status"] == "error" and meta(err)["reason"] == "Invalid API key."


# ------------------------------------------------------------------ avatar_hash helper
def _finding(platform, avatar_url=None, status="found", **extra):
    if avatar_url:
        extra["avatar_url"] = avatar_url
    return make_finding(
        case_id="case-1", identifier_type="username", identifier_value="exampleuser",
        source_tool="t", platform=platform, status=status, extra=extra,
    )


async def test_hash_avatars_returns_updated_copies(respx_mock, http):
    pytest.importorskip("imagehash")
    from sherlock_core.modules.avatar_hash import hash_avatars

    same = respx_mock.get("https://cdn.example.com/a.png").respond(
        content=_image_bytes("PNG"), headers={"content-type": "image/png"},
    )
    respx_mock.get("https://cdn.example.com/b.png").respond(
        content=_image_bytes("PNG", seed=3), headers={"content-type": "image/png"},
    )
    respx_mock.get("https://cdn.example.com/missing.png").respond(404)
    findings = [
        _finding("one", "https://cdn.example.com/a.png"),
        _finding("two", "https://cdn.example.com/a.png"),
        _finding("three", "https://cdn.example.com/b.png"),
        _finding("gone", "https://cdn.example.com/missing.png"),
        _finding("hashed", "https://cdn.example.com/never-fetched.png", avatar_phash="ffffffffffffffff"),
        _finding("absent", "https://cdn.example.com/never-fetched.png", status="not_found"),
        _finding("no-avatar"),
    ]
    out = await hash_avatars(findings, http)
    assert [f["platform"] for f in out] == ["one", "two", "three"]
    hashes = [f["extra_metadata"]["extra"]["avatar_phash"] for f in out]
    assert hashes[0] == hashes[1] and len(hashes[2]) == 16
    assert same.call_count == 1  # one download per distinct URL
    assert "avatar_phash" not in findings[0]["extra_metadata"]["extra"]  # inputs are not mutated
    assert out[0]["finding_key"] == findings[0]["finding_key"]


async def test_hash_avatars_nothing_to_do_and_cap(respx_mock, http, monkeypatch):
    pytest.importorskip("imagehash")
    import sherlock_core.modules.avatar_hash as ah

    assert await ah.hash_avatars([], http) == []
    assert await ah.hash_avatars([_finding("x")], http) == []
    monkeypatch.setattr(ah, "MAX_AVATARS", 2)
    route = respx_mock.get(url__startswith="https://cdn.example.com/").respond(
        content=_image_bytes("PNG"), headers={"content-type": "image/png"},
    )
    out = await ah.hash_avatars([_finding(f"p{i}", f"https://cdn.example.com/{i}.png") for i in range(5)], http)
    assert len(out) == 2 and route.call_count == 2


# ------------------------------------------------------------------ scrape enrichment
async def test_enrich_url_legacy_firecrawl_shape(respx_mock, http, fx, monkeypatch):
    monkeypatch.setenv("SCRAPING_API_KEY", "fc-test")
    monkeypatch.setenv("SCRAPING_API_URL", "https://scrape.example.net/")
    route = respx_mock.post("https://scrape.example.net/v1/scrape").respond(json=fx("firecrawl_scrape"))
    url = "https://example.com/u/exampleuser"
    row = await enrich_url(url, "case-1", http)
    req = route.calls.last.request
    assert req.headers["authorization"] == "Bearer fc-test"
    assert (row["source_tool"], row["platform"], row["status"]) == ("firecrawl", "scraped:example.com", "found")
    assert (row["identifier_type"], row["identifier_value"]) == ("scraped_url", url)
    assert row["extra_metadata"]["url"] == url and row["finding_key"]
    extra = row["extra_metadata"]["extra"]
    assert extra["title"] == "Example User - Profile" and extra["og_image"] == "https://example.com/og.png"
    assert extra["emails_in_page"] == "user@example.com" and extra["handles_in_page"] == "@exampleuser"
    assert extra["urls_in_page"] == "https://example.org/about"  # the scraped URL itself is left out
    assert extra["markdown_preview"].startswith("# Example User")


async def test_enrich_url_unconfigured_and_failures(respx_mock, http, monkeypatch):
    monkeypatch.delenv("SCRAPING_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="SCRAPING_API_KEY"):
        await enrich_url("https://example.com/", "case-1", http)
    monkeypatch.setenv("SCRAPING_API_KEY", "fc-test")
    monkeypatch.delenv("SCRAPING_API_URL", raising=False)
    with pytest.raises(ValueError):
        await enrich_url("http://localhost:8000/admin", "case-1", http)
    route = respx_mock.post("https://api.firecrawl.dev/v1/scrape").respond(402, json={"error": "Payment required"})
    with pytest.raises(RuntimeError, match="HTTP 402"):
        await enrich_url("https://example.com/", "case-1", http)
    route.mock(side_effect=httpx.Response(200, json={"success": False, "error": "blocked"}))
    with pytest.raises(RuntimeError, match="scrape failed"):
        await enrich_url("https://example.com/", "case-1", http)


async def test_reverse_image_lists_exact_copies_first_without_duplicates(respx_mock, run, monkeypatch):
    monkeypatch.setenv("SERPAPI_KEY", "test-key")
    respx_mock.get("https://serpapi.com/search.json").respond(json={
        "visual_matches": [{"position": 1, "title": "similar", "link": "https://example.org/a"},
                           {"position": 2, "title": "dup", "link": "https://example.org/exact"}],
        "exact_matches": [{"position": 1, "title": "exact copy", "link": "https://example.org/exact"}],
    })
    rows = await run("reverse_image", "image", IMG)
    assert [(r["extra_metadata"]["url"], r["extra_metadata"]["match"]) for r in rows] == [
        ("https://example.org/exact", "exact"), ("https://example.org/a", "similar"),
    ]
