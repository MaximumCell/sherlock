"""geo_context end to end with a MemoryStore and recorded upstream responses (offline)."""
import io
import json

import httpx
import pytest
from sherlock_core.models import make_finding
from sherlock_core.modules import ModuleContext, Target, get_module
from sherlock_core.modules import geo_context as geo
from sherlock_core.store import MemoryStore, set_store

IMG = "https://img.example.com/landmark.jpg"
ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
FORECAST = "https://api.open-meteo.com/v1/forecast"
REVERSE = "https://nominatim.openstreetmap.org/reverse"
SEARCH = "https://nominatim.openstreetmap.org/search"


def _jpeg(*, gps=True, when="2025:06:14 20:40:00", offset=None, software="ExampleOS 1.0"):
    Image = pytest.importorskip("PIL.Image")
    img = Image.new("RGB", (32, 24), (90, 120, 200))
    e = Image.Exif()
    e[271], e[272], e[305] = "ExampleCam", "Model X", software
    if when:
        e[306] = when
        ex = e.get_ifd(0x8769)
        ex[36867] = when
        if offset:
            ex[0x9011] = offset
    if gps:
        g = e.get_ifd(0x8825)
        g[1], g[2], g[3], g[4] = "N", (48.0, 51.0, 36.0), "E", (2.0, 17.0, 24.0)   # 48.86, 2.29
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=e)
    return buf.getvalue()


@pytest.fixture
def store(monkeypatch):
    s = MemoryStore()
    set_store(s)
    monkeypatch.setattr(geo, "NOMINATIM_MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr(geo, "LENS_POLL_S", 0.01)
    monkeypatch.setattr(geo, "LENS_WAIT_S", 0.05)
    geo._reverse_cache.clear()
    monkeypatch.delenv("WINDY_WEBCAMS_KEY", raising=False)
    monkeypatch.delenv("MAPILLARY_TOKEN", raising=False)
    yield s
    set_store(None)


@pytest.fixture
def fxj():
    from pathlib import Path
    base = Path(__file__).parent / "fixtures"
    return lambda name: json.loads((base / f"{name}.json").read_text(encoding="utf-8"))


def _rows(findings):
    return {f["platform"]: f for f in findings}


def _meta(f):
    return {k: v for k, v in f["extra_metadata"].items() if k not in ("url", "extra")}


async def _run(store, value=IMG, **params):
    case = store.create_case([{"type": "image", "value": value}], owner_id="u1")
    async with httpx.AsyncClient() as http:
        ctx = ModuleContext(case_id=case["id"], http=http)
        return case, await get_module("geo_context").run(Target("image", value, params), ctx)


async def test_full_run_with_camera_data_claim_and_lens(respx_mock, store, fxj, monkeypatch):
    monkeypatch.setenv("WINDY_WEBCAMS_KEY", "test-key")
    monkeypatch.setenv("MAPILLARY_TOKEN", "test-token")
    respx_mock.get(IMG).respond(content=_jpeg(), headers={"content-type": "image/jpeg"})
    weather = respx_mock.get(ARCHIVE).respond(json=fxj("geo_openmeteo_archive"))
    reverse = respx_mock.get(REVERSE).respond(json=fxj("geo_nominatim_reverse"))
    respx_mock.get(SEARCH).respond(json=fxj("geo_nominatim_search"))
    cams = respx_mock.get(geo.WINDY_WEBCAMS).respond(json=fxj("geo_windy_webcams"))
    street = respx_mock.get(geo.MAPILLARY_IMAGES).respond(json=fxj("geo_mapillary_images"))
    case = store.create_case([{"type": "image", "value": IMG}], owner_id="u1")
    lens = make_finding(case_id=case["id"], identifier_type="image", identifier_value=IMG,
                        source_tool="reverse_image", platform="google-lens", url="https://blog.example/eiffel",
                        meta={"title": "Evening at the Eiffel Tower", "source": "blog.example"})
    store.upsert_findings([lens], case["id"])

    claim = {"place": "Eiffel Tower, Paris", "taken_at": "2025-06-14T08:30:00+02:00"}
    async with httpx.AsyncClient() as http:
        ctx = ModuleContext(case_id=case["id"], http=http)
        found = await get_module("geo_context").run(Target("image", IMG, {"claim": claim}), ctx)
    rows = _rows(found)
    assert set(rows) == {"geo-sun", "geo-weather", "geo-place", "geo-street", "geo-checks"}
    assert all(f["status"] == "found" for f in found), [(f["platform"], f["status"]) for f in found]

    # one weather request for the shared place and day, rounded coordinates, timezone=auto
    q = weather.calls[0].request.url.params
    assert weather.call_count == 1 and (q["latitude"], q["longitude"], q["timezone"]) == ("48.86", "2.29", "auto")
    assert (q["start_date"], q["end_date"]) == ("2025-06-13", "2025-06-15")
    assert reverse.calls[0].request.headers["user-agent"].startswith("sherlock-osint/")

    sun = _meta(rows["geo-sun"])["moments"]
    cam = next(m for m in sun if m["label"] == "camera")
    assert cam["local_time"] == "2025-06-14T20:40" and cam["utc_time"] == "2025-06-14T18:40Z"
    assert cam["utc_offset"] == "+02:00" and cam["timezone"] == "Europe/Paris"
    assert cam["azimuth"] == pytest.approx(294.35, abs=0.05) and cam["shadow_compass"] == "ESE"
    claimed = next(m for m in sun if m["label"] == "claim")
    assert claimed["local_time"] == "2025-06-14T08:30" and claimed["azimuth"] < 100
    assert "20:40 local time" in rows["geo-sun"]["extra_metadata"]["extra"]["note"]

    w = _meta(rows["geo-weather"])["moments"]
    assert {m["label"] for m in w} == {"camera", "claim"} and all("summary" in m for m in w)
    assert "Open-Meteo" in _meta(rows["geo-weather"])["attribution"]

    place = _meta(rows["geo-place"])
    assert place["place"] == {"district": "16th Arrondissement", "city": "Paris", "state": "Ile-de-France",
                              "country": "France", "country_code": "FR"}
    assert (place["lat"], place["lon"], place["source"]) == (48.86, 2.29, "camera")
    assert place["claim_place"]["landmark"] == "Eiffel Tower" and place["claim_place"]["precise"] is True
    assert place["claim_point"] == {"lat": 48.86, "lon": 2.29}

    assert not cams.called and not street.called            # the optional modules do that
    assert set(_meta(rows["geo-street"])["links"]) == {"openstreetmap", "google_maps", "google_street_view", "mapillary"}

    checks = {c["key"]: c for c in _meta(rows["geo-checks"])["checks"]}
    assert checks["location_distance"]["verdict"] == "consistent"
    assert checks["time_difference"]["verdict"] == "inconsistent"
    assert checks["time_zone"]["verdict"] == "consistent"
    assert checks["lens_place"]["verdict"] == "consistent"
    basis = _meta(rows["geo-checks"])["basis"]
    assert basis["camera_utc"] == "2025-06-14T18:40:00Z" and basis["location_source"] == "camera"
    assert _meta(rows["geo-checks"])["claim"] == claim and _meta(rows["geo-checks"])["lens"] == "ready"


async def test_nothing_stored_is_finer_than_a_district(respx_mock, store, fxj):
    """Coarseness: the search result has a road, house number and postcode; none is stored anywhere."""
    respx_mock.get(IMG).respond(content=_jpeg(gps=False), headers={"content-type": "image/jpeg"})
    respx_mock.get(ARCHIVE).respond(json=fxj("geo_openmeteo_archive"))
    respx_mock.get(REVERSE).respond(json=fxj("geo_nominatim_search")[0])      # worst case: a POI answer
    respx_mock.get(SEARCH).respond(json=fxj("geo_nominatim_search"))
    _, found = await _run(store, claim={"place": "Eiffel Tower, Paris"})
    blob = json.dumps(found)
    for secret in ("Avenue Anatole France", "75007", '"5"', "house_number", "road", "Gros-Caillou",
                   "display_name", "48.858", "2.2945"):
        assert secret not in blob, secret
    place = _meta(_rows(found)["geo-place"])
    assert place["source"] == "claim" and place["label"] == "7th Arrondissement, Paris, France"


async def test_uses_the_claimed_point_when_the_photo_has_no_gps(respx_mock, store, fxj):
    respx_mock.get(IMG).respond(content=_jpeg(gps=False, when=None), headers={"content-type": "image/jpeg"})
    respx_mock.get(FORECAST).respond(json=fxj("geo_openmeteo_forecast"))
    respx_mock.get(REVERSE).respond(json=fxj("geo_nominatim_reverse"))
    search = respx_mock.get(SEARCH).respond(json=[])
    _, found = await _run(store, claim={"lat": 48.8566, "lon": 2.3522, "taken_at": "2026-11-21T14:00:00+01:00"})
    rows = _rows(found)
    assert not search.called                                 # a picked point needs no lookup
    sun = _meta(rows["geo-sun"])["moments"]
    assert [m["label"] for m in sun] == ["claim"] and (sun[0]["lat"], sun[0]["lon"]) == (48.86, 2.35)
    assert _meta(rows["geo-weather"])["moments"][0]["label"] == "claim"
    checks = {c["key"]: c for c in _meta(rows["geo-checks"])["checks"]}
    assert checks["camera_metadata"]["verdict"] == "cant_tell"
    assert checks["location_distance"]["title"] == "No camera GPS to compare with the claimed place"
    assert checks["time_zone"]["verdict"] == "consistent"
    assert "geo-webcams" not in rows and rows["geo-street"]["status"] == "found"
    assert _meta(rows["geo-checks"])["lens"] == "none"


async def test_webcams_module_needs_its_key_and_lists_active_cams(respx_mock, store, fxj, monkeypatch):
    mod = get_module("geo_webcams")
    assert mod.requires_env == ("WINDY_WEBCAMS_KEY",) and not mod.available()
    monkeypatch.setenv("WINDY_WEBCAMS_KEY", "test-key")
    assert mod.available()
    respx_mock.get(IMG).respond(content=_jpeg(), headers={"content-type": "image/jpeg"})
    cams = respx_mock.get(geo.WINDY_WEBCAMS).respond(json=fxj("geo_windy_webcams"))
    case = store.create_case([{"type": "image", "value": IMG}], owner_id="u1")
    async with httpx.AsyncClient() as http:
        (row,) = await mod.run(Target("image", IMG, {}), ModuleContext(case_id=case["id"], http=http))
    webcams = _meta(row)["webcams"]
    assert row["platform"] == "geo-webcams" and row["module"] == "geo_webcams"
    assert [c["title"] for c in webcams] == ["Paris: Champ de Mars"]          # the inactive one is dropped
    assert cams.calls[0].request.headers["x-windy-api-key"] == "test-key"
    assert cams.calls[0].request.url.params["nearby"] == "48.86,2.29,15"
    assert webcams[0]["distance_km"] < 1 and "test-key" not in json.dumps(row)


async def test_street_images_module_needs_its_token(respx_mock, store, fxj, monkeypatch):
    mod = get_module("geo_street_images")
    assert mod.requires_env == ("MAPILLARY_TOKEN",)
    monkeypatch.setenv("MAPILLARY_TOKEN", "test-token")
    respx_mock.get(IMG).respond(content=_jpeg(gps=False, when=None), headers={"content-type": "image/jpeg"})
    street = respx_mock.get(geo.MAPILLARY_IMAGES).respond(json=fxj("geo_mapillary_images"))
    case = store.create_case([{"type": "image", "value": IMG}], owner_id="u1")
    claim = {"claim": {"lat": 48.86, "lon": 2.29}}
    async with httpx.AsyncClient() as http:
        (row,) = await mod.run(Target("image", IMG, claim), ModuleContext(case_id=case["id"], http=http))
    images = _meta(row)["images"]
    assert row["platform"] == "geo-street-images"
    assert [i["id"] for i in images] == ["2222222222222222", "1111111111111111"]  # nearest first
    assert images[1]["captured_on"] == "2024-06-14"
    assert street.calls[0].request.url.params["bbox"] == "2.28,48.85,2.3,48.87"
    assert "test-token" not in json.dumps(row)
    # an upstream failure is a row, never an exception, and never echoes the token
    street.mock(side_effect=httpx.ConnectError("boom https://graph.mapillary.com/?access_token=test-token"))
    async with httpx.AsyncClient() as http:
        (err,) = await mod.run(Target("image", IMG, claim), ModuleContext(case_id=case["id"], http=http))
    assert err["status"] == "error" and "test-token" not in json.dumps(err)


async def test_optional_modules_without_location(respx_mock, store, monkeypatch):
    monkeypatch.setenv("WINDY_WEBCAMS_KEY", "k")
    respx_mock.get(IMG).respond(content=_jpeg(gps=False, when=None), headers={"content-type": "image/jpeg"})
    async with httpx.AsyncClient() as http:
        (row,) = await get_module("geo_webcams").run(Target("image", IMG, {}), ModuleContext(case_id="c", http=http))
    assert row["status"] == "not_found" and _meta(row)["reason"].startswith("No location to check")


async def test_skips_with_a_clear_note_without_location(respx_mock, store):
    respx_mock.get(IMG).respond(content=_jpeg(gps=False, when=None), headers={"content-type": "image/jpeg"})
    _, found = await _run(store)
    rows = _rows(found)
    assert len(found) == 5
    for platform in ("geo-sun", "geo-weather", "geo-place", "geo-street"):
        assert rows[platform]["status"] == "not_found"
        assert rows[platform]["extra_metadata"]["extra"]["note"].startswith("No location to check")
    assert rows["geo-checks"]["status"] == "found"


async def test_upstream_failures_never_fail_the_scan(respx_mock, store):
    respx_mock.get(IMG).respond(content=_jpeg(), headers={"content-type": "image/jpeg"})
    respx_mock.get(ARCHIVE).mock(side_effect=httpx.ConnectTimeout("slow"))
    respx_mock.get(REVERSE).respond(429, headers={"retry-after": "60"})
    _, found = await _run(store)
    rows = _rows(found)
    assert rows["geo-weather"]["status"] == "error" and "ConnectTimeout" in _meta(rows["geo-weather"])["reason"]
    assert rows["geo-place"]["status"] == "error" and "429" in _meta(rows["geo-place"])["reason"]
    sun = _meta(rows["geo-sun"])["moments"][0]
    assert sun["timezone_approximate"] is True              # time zone guessed from the longitude
    assert rows["geo-street"]["status"] == "found"           # links need no network
    assert rows["geo-checks"]["status"] == "found"


async def test_unreadable_photo_and_bad_claim(respx_mock, store, fxj):
    respx_mock.get(IMG).respond(404)
    respx_mock.get(ARCHIVE).respond(json=fxj("geo_openmeteo_archive"))
    _, found = await _run(store, claim={"lat": 999, "lon": 0})            # invalid claim: ignored
    rows = _rows(found)
    assert "could not read the photo" in _meta(rows["geo-checks"])["exif_error"]
    assert rows["geo-sun"]["status"] == "not_found"


async def test_reruns_replace_every_row(respx_mock, store, fxj):
    respx_mock.get(IMG).respond(content=_jpeg(gps=False, when=None), headers={"content-type": "image/jpeg"})
    respx_mock.get(ARCHIVE).respond(json=fxj("geo_openmeteo_archive"))
    respx_mock.get(REVERSE).respond(json=fxj("geo_nominatim_reverse"))
    case, first = await _run(store)
    async with httpx.AsyncClient() as http:
        ctx = ModuleContext(case_id=case["id"], http=http)
        second = await get_module("geo_context").run(
            Target("image", IMG, {"claim": {"lat": 48.86, "lon": 2.29, "taken_at": "2025-06-14T20:40:00+02:00"}}), ctx)
    assert {f["finding_key"] for f in first} == {f["finding_key"] for f in second}


def test_coarse_address_and_links():
    addr = {"road": "Rue X", "house_number": "12", "postcode": "75016", "neighbourhood": "N", "suburb": "16e",
            "city": "Paris", "country": "France", "country_code": "fr"}
    assert geo.coarse_address(addr) == {"district": "16e", "city": "Paris", "country": "France", "country_code": "FR"}
    assert geo.coarse_address(None) == {}
    links = geo.links_for(48.85837, 2.294481)
    assert links["openstreetmap"] == "https://www.openstreetmap.org/?mlat=48.86&mlon=2.29#map=16/48.86/2.29"
    assert "viewpoint=48.86,2.29" in links["google_street_view"]


async def test_report_lists_the_checks_and_correlation_ignores_geo_rows(respx_mock, store, fxj):
    from sherlock_core.correlation.facts import facts_for
    from sherlock_core.report import generate_markdown

    respx_mock.get(IMG).respond(content=_jpeg(), headers={"content-type": "image/jpeg"})
    respx_mock.get(ARCHIVE).respond(json=fxj("geo_openmeteo_archive"))
    respx_mock.get(REVERSE).respond(json=fxj("geo_nominatim_reverse"))
    case, found = await _run(store)
    store.upsert_findings(found, case["id"])
    assert all(facts_for({**f, "id": f"x{i}"}) is None for i, f in enumerate(found))
    md = generate_markdown(case["id"], store=store)
    assert "## Where and when (" in md and "**Can't tell**: Sun 10° above the horizon at the camera time" in md
    assert "### geo-sun" not in md and "none proves anything" in md


def test_registered_on_the_media_queue_without_required_keys():
    mod = get_module("geo_context")
    assert mod is not None and mod.queue == "media" and mod.inputs == ("image",) and mod.requires_env == ()
