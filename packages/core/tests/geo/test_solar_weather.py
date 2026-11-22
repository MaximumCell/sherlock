"""Solar position against published reference values, and the weather wording."""
import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sherlock_core.geo.solar import compass, describe, shadow_words, solar_position
from sherlock_core.geo.weather import hour_at, kind_of, weather_sentence, weather_words

FIXTURES = Path(__file__).parents[1] / "modules" / "fixtures"


def test_spa_reference_example():
    """NREL SPA paper (Reda & Andreas 2004, table A4.1): 2003-10-17 12:30:30 -07:00, Golden CO:
    topocentric zenith 50.11162 deg, azimuth 194.34024 deg."""
    sun = solar_position(39.742476, -105.1786, datetime(2003, 10, 17, 12, 30, 30, tzinfo=timezone(timedelta(hours=-7))))
    assert sun.azimuth == pytest.approx(194.34024, abs=0.03)
    assert 90 - sun.elevation == pytest.approx(50.11162, abs=0.03)


# Cross-checked with NREL SPA as implemented by pvlib 0.16 (spa_python, apparent elevation).
@pytest.mark.parametrize(("when", "lat", "lon", "azimuth", "elevation"), [
    ("2025-06-14T18:40:00+00:00", 48.86, 2.29, 294.350, 9.894),
    ("2020-12-21T12:00:00+00:00", -33.87, 151.21, 209.193, -26.661),
    ("2019-09-01T03:15:00+00:00", 64.15, -21.94, 27.416, -14.685),
    ("2010-01-15T22:30:00+00:00", 35.68, 139.69, 121.516, 6.391),
])
def test_matches_spa_reference_values(when, lat, lon, azimuth, elevation):
    sun = solar_position(lat, lon, datetime.fromisoformat(when))
    assert sun.azimuth == pytest.approx(azimuth, abs=0.05)
    assert sun.elevation == pytest.approx(elevation, abs=0.05)


def test_equinox_sunrise_and_noon():
    # equator at the March equinox: the sun rises due east and stands almost overhead at noon
    rise = solar_position(0.0, 0.0, datetime(2024, 3, 20, 6, 0, tzinfo=UTC))
    assert rise.azimuth == pytest.approx(89.95, abs=0.1)
    assert -2.2 < rise.elevation < -1.4             # just below the horizon (refraction models differ here)
    noon = solar_position(0.0, 0.0, datetime(2024, 3, 20, 12, 7, tzinfo=UTC))
    assert noon.elevation > 89.5


def test_naive_datetime_is_utc_and_bad_coordinates_refused():
    a = solar_position(48.86, 2.29, datetime(2025, 6, 14, 18, 40))
    b = solar_position(48.86, 2.29, datetime(2025, 6, 14, 20, 40, tzinfo=timezone(timedelta(hours=2))))
    assert a == b
    with pytest.raises(ValueError):
        solar_position(91, 0, datetime(2025, 1, 1, tzinfo=UTC))


def test_shadow_direction_and_length():
    s = describe(294.35, 9.9)
    assert s.shadow_azimuth == pytest.approx(114.35) and s.shadow_compass == "ESE"
    assert s.shadow_ratio == pytest.approx(5.73, abs=0.01)
    assert s.daylight == "day" and s.compass == "WNW"
    assert shadow_words(s).startswith("very long shadows (about 5.7 times")
    assert describe(180, 45).shadow_ratio == pytest.approx(1.0)
    high = describe(180, 80)
    assert shadow_words(high).startswith("short")
    low = describe(270, 0.01)
    assert low.shadow_ratio == 50.0                  # capped near the horizon
    dusk, night = describe(300, -3), describe(0, -20)
    assert (dusk.daylight, dusk.shadow_ratio, dusk.shadow_compass) == ("twilight", None, None)
    assert night.daylight == "night" and "below the horizon" in shadow_words(night)
    assert [compass(a) for a in (0, 11.3, 90, 191, 359)] == ["N", "NNE", "E", "S", "N"]


def test_weather_words_and_kinds():
    assert weather_words(0) == "clear sky" and weather_words(61) == "light rain"
    assert weather_words(65) == "heavy rain" and weather_words("95") == "thunderstorm"
    assert weather_words(42) == "unknown weather" and weather_words(None) == "unknown weather"
    assert [kind_of(c) for c in (0, 2, 45, 63, 73, 99, None)] == [
        "clear", "cloudy", "fog", "wet", "snow", "wet", "unknown"]


def test_hour_at_uses_the_response_offset():
    body = json.loads((FIXTURES / "geo_openmeteo_archive.json").read_text())
    assert body["utc_offset_seconds"] == 3600          # recorded quirk: today's offset, in June
    hour = hour_at(body, datetime(2025, 6, 14, 18, 40, tzinfo=UTC))
    # 18:40 UTC -> nearest hourly row 19:00 UTC, stored as "2025-06-14T20:00" with the +1 offset
    i = body["hourly"]["time"].index("2025-06-14T20:00")
    assert hour["hour_utc"] == "2025-06-14T19:00:00Z"
    assert hour["temperature_c"] == body["hourly"]["temperature_2m"][i]
    assert hour["summary"] == weather_words(body["hourly"]["weather_code"][i])
    assert hour_at(body, datetime(2025, 7, 1, tzinfo=UTC)) is None   # outside the range
    assert hour_at({}, datetime(2025, 6, 14, tzinfo=UTC)) is None


def test_weather_sentence():
    s = weather_sentence({"summary": "light rain", "temperature_c": 14.4, "cloud_cover": 90, "precipitation_mm": 0.6})
    assert s == "light rain, 14 °C, 90% cloud cover, 0.6 mm of precipitation in that hour"
    assert weather_sentence({"summary": "clear sky", "precipitation_mm": 0}) == "clear sky"
