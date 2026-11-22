"""Claim validation and the plain-language where-and-when checks (`assess_claim`)."""
from datetime import UTC, datetime, timedelta

import pytest
from sherlock_core.geo.claims import (
    Check,
    assess_claim,
    haversine_km,
    normalize_claim,
    parse_aware,
    parse_exif_time,
    place_phrases,
    summarize,
)
from sherlock_core.geo.solar import solar_position

EIFFEL = {"lat": 48.86, "lon": 2.29}


def by_key(checks: list[Check]) -> dict[str, Check]:
    return {c.key: c for c in checks}


def sun_row(label, lat, lon, when_utc, local):
    return {"label": label, "local_time": local, **solar_position(lat, lon, when_utc).to_dict()}


# ------------------------------------------------------------------ claim validation
def test_normalize_claim_rounds_and_keeps_offset():
    c = normalize_claim({"place": "  Eiffel   Tower, Paris ", "lat": 48.85837, "lon": 2.294481,
                         "taken_at": "2025-06-14T20:40:00+02:00"})
    assert c == {"place": "Eiffel Tower, Paris", "lat": 48.86, "lon": 2.29, "taken_at": "2025-06-14T20:40:00+02:00"}
    assert normalize_claim({"taken_at": "2025-06-14T18:40:00Z"}) == {"taken_at": "2025-06-14T18:40:00+00:00"}
    assert normalize_claim(None) is None and normalize_claim({"place": "  "}) is None


@pytest.mark.parametrize(("raw", "message"), [
    ({"lat": 10}, "both lat and lon"),
    ({"lat": 91, "lon": 0}, "between -90 and 90"),
    ({"lat": "48", "lon": 2}, "must be numbers"),
    ({"lat": True, "lon": 2}, "must be numbers"),
    ({"lat": float("nan"), "lon": 2}, "must be numbers"),
    ({"taken_at": "2025-06-14T20:40:00"}, "time zone offset"),
    ({"taken_at": "yesterday"}, "time zone offset"),
    ({"taken_at": "1850-01-01T00:00:00+00:00"}, "too early"),
    ({"place": "x" * 121}, "at most 120"),
    ({"place": 5}, "must be text"),
    ({"street": "1 Main St"}, "unknown claim field"),
    ("Paris", "must be an object"),
])
def test_normalize_claim_rejects(raw, message):
    with pytest.raises(ValueError, match=message):
        normalize_claim(raw)


def test_future_claim_refused():
    future = (datetime.now(UTC) + timedelta(days=3)).isoformat()
    with pytest.raises(ValueError, match="future"):
        normalize_claim({"taken_at": future})


def test_parsers():
    assert parse_aware("2025-06-14T20:40:00") is None
    assert parse_aware("2025-06-14T20:40:00+02:00").utcoffset() == timedelta(hours=2)
    assert parse_exif_time("2025:06:14 20:40:00") == datetime(2025, 6, 14, 20, 40)
    assert parse_exif_time("2025:06:14 20:40:00", "+02:00").utcoffset() == timedelta(hours=2)
    assert parse_exif_time("0000:00:00 00:00:00") is None and parse_exif_time(None) is None
    assert haversine_km(48.86, 2.29, 45.76, 4.84) == pytest.approx(392, abs=3)   # Paris - Lyon
    assert place_phrases("Eiffel Tower, Paris (75007)", ["Paris"]) == ["eiffel tower", "paris"]


# ------------------------------------------------------------------ assess_claim
def test_everything_consistent():
    exif = {"datetime": "2025:06:14 20:40:00", "gps_lat": 48.86, "gps_lon": 2.29, "software": "ExampleOS 1.0"}
    claim = {"place": "Eiffel Tower, Paris", **EIFFEL, "taken_at": "2025-06-14T20:40:00+02:00"}
    utc = datetime(2025, 6, 14, 18, 40, tzinfo=UTC)
    sun = [sun_row("camera", 48.86, 2.29, utc, "2025-06-14T20:40")]
    weather = [{"label": "camera", "summary": "clear sky", "kind": "clear", "temperature_c": 24.2, "cloud_cover": 5,
                "precipitation_mm": 0}]
    lens = [{"title": "Sunset at the Eiffel Tower - travel blog"}, {"title": "Paris skyline"}, {"title": "Wallpaper"}]
    checks = by_key(assess_claim(exif, claim, sun, weather, lens, camera_utc=utc, claim_place_offset="+02:00",
                                 timezone_name="Europe/Paris"))
    assert checks["location_distance"].verdict == "consistent"
    assert checks["location_distance"].title.startswith("Camera GPS is 0.0 km")
    assert checks["time_difference"].verdict == "consistent"
    assert checks["time_zone"].verdict == "consistent"
    sun_check = checks["sun_camera"]
    assert sun_check.verdict == "cant_tell"           # only a person looking at the photo can tell
    assert "20:40 local" in sun_check.reason and "10° above the horizon" in sun_check.reason
    assert "very long shadows" in sun_check.reason and "point ESE" in sun_check.look_for
    assert checks["weather_camera"].title == "Clear sky at the camera time"
    assert checks["lens_place"].verdict == "consistent"
    assert checks["lens_place"].title == "Google Lens titles mention Eiffel Tower, Paris"
    assert "camera_metadata" not in checks and "edited" not in checks


def test_far_gps_wrong_time_and_wrong_zone():
    exif = {"datetime": "2025:06:14 20:40:00", "gps_lat": 45.76, "gps_lon": 4.84, "software": "Adobe Photoshop 25.0"}
    claim = {"place": "Paris", **EIFFEL, "taken_at": "2025-06-14T08:30:00+01:00"}
    camera_utc = datetime(2025, 6, 14, 18, 40, tzinfo=UTC)
    checks = by_key(assess_claim(exif, claim, [], [], [], camera_utc=camera_utc, claim_place_offset="+02:00",
                                 timezone_name="Europe/Paris"))
    loc = checks["location_distance"]
    assert loc.verdict == "inconsistent" and "395 km" in loc.title
    t = checks["time_difference"]
    assert t.verdict == "inconsistent" and "11.2 hours" in t.title and "2025-06-14 20:40" in t.reason
    z = checks["time_zone"]
    assert z.verdict == "inconsistent" and "UTC+02:00 (Europe/Paris)" in z.reason and "UTC+01:00" in z.reason
    assert checks["edited"].verdict == "cant_tell" and "Photoshop" in checks["edited"].title
    assert checks["lens_place"].title == "No Google Lens matches to compare"


def test_in_between_distances_and_times_cannot_tell():
    exif = {"datetime": "2025:06:14 20:40:00", "gps_lat": 48.86, "gps_lon": 2.42}   # ~9.5 km east
    claim = {**EIFFEL, "taken_at": "2025-06-14T19:30:00+02:00"}
    checks = by_key(assess_claim(exif, claim, None, None, None,
                                 camera_utc=datetime(2025, 6, 14, 18, 40, tzinfo=UTC)))
    assert checks["location_distance"].verdict == "cant_tell"
    assert checks["time_difference"].verdict == "cant_tell" and "70 minutes" in checks["time_difference"].title


def test_coarse_claim_place_allows_a_wider_area():
    exif = {"gps_lat": 48.86, "gps_lon": 2.42}
    claim = {"place": "Paris", "resolved": {"lat": 48.85, "lon": 2.35, "label": "Paris, France", "precise": False}}
    checks = by_key(assess_claim(exif, claim, [], [], []))
    assert checks["location_distance"].verdict == "consistent"


def test_no_metadata_and_no_gps():
    checks = by_key(assess_claim({}, {"place": "Paris", **EIFFEL}, [], [], [{"title": "Rome at night"}]))
    assert checks["camera_metadata"].verdict == "cant_tell"
    assert "says nothing for or against" in checks["camera_metadata"].reason
    assert checks["location_distance"].verdict == "cant_tell"
    assert checks["location_distance"].title == "No camera GPS to compare with the claimed place"
    lens = checks["lens_place"]
    assert lens.verdict == "cant_tell" and "not a contradiction" in lens.reason


def test_rain_snow_fog_cold_and_night():
    claim_sun = sun_row("claim", 48.86, 2.29, datetime(2025, 1, 10, 23, 0, tzinfo=UTC), "2025-01-11T00:00")
    weather = [
        {"label": "claim", "summary": "heavy rain", "kind": "wet", "precipitation_mm": 6.2, "temperature_c": -1},
        {"label": "camera", "summary": "snow", "kind": "snow", "temperature_c": 12},
    ]
    checks = by_key(assess_claim({}, {"taken_at": "2025-01-11T00:00:00+01:00"}, [claim_sun], weather, []))
    rain = checks["weather_claim"]
    assert rain.title == "Raining heavily at the claimed time" and "wet ground" in rain.look_for
    assert "6.2 mm of rain" in rain.reason
    assert checks["temperature_claim"].title == "Freezing at the claimed time (-1 °C)"
    assert checks["weather_camera"].title == "Snow at the camera time"
    night = checks["sun_claim"]
    assert night.title == "Dark at the claimed time" and "night" in night.reason
    fog = by_key(assess_claim({}, {}, [], [{"label": "claim", "summary": "fog", "kind": "fog"}], []))
    assert "haze" in fog["weather_claim"].look_for


def test_lens_compares_with_the_photo_place_without_a_claim():
    checks = by_key(assess_claim({"gps_lat": 48.86, "gps_lon": 2.29}, None, [], [],
                                 [{"title": "Trip to the 16th Arrondissement of Paris"}],
                                 place={"district": "16th Arrondissement", "city": "Paris", "country": "France"}))
    lens = checks["lens_place"]
    assert lens.verdict == "consistent" and "the place where the camera says it was" in lens.reason
    assert "location_distance" not in checks          # nothing claimed: nothing to compare


def test_no_overall_score_and_summary_words():
    checks = assess_claim({}, None, [], [], [])
    assert all(set(c.to_dict()) == {"key", "verdict", "title", "reason", "look_for"} for c in checks)
    assert summarize(checks) == "1 to look at"
    assert summarize([Check("a", "consistent", "t", "r"), Check("b", "inconsistent", "t", "r")]) == \
        "1 consistent, 1 inconsistent"
    assert summarize([]) == "nothing to check yet"
