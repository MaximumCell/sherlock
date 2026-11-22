"""Hourly weather in plain words, from Open-Meteo's WMO weather codes and hourly values."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

# WMO 4677 codes as Open-Meteo documents them (https://open-meteo.com/en/docs, "WMO Weather interpretation codes").
WMO_WORDS: dict[int, str] = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
    45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle",
    56: "light freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain",
    66: "light freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains",
    80: "light rain showers", 81: "rain showers", 82: "violent rain showers",
    85: "light snow showers", 86: "heavy snow showers",
    95: "thunderstorm", 96: "thunderstorm with light hail", 99: "thunderstorm with heavy hail",
}

WET_CODES = frozenset({51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99})
SNOW_CODES = frozenset({71, 73, 75, 77, 85, 86})
FOG_CODES = frozenset({45, 48})
HOURLY_VARS = ("temperature_2m", "cloud_cover", "precipitation", "rain", "snowfall", "weather_code", "is_day")


def weather_words(code: Any) -> str:
    """'light rain', 'clear sky'... ('unknown weather' for codes Open-Meteo does not document)."""
    try:
        return WMO_WORDS.get(int(code), "unknown weather")
    except (TypeError, ValueError):
        return "unknown weather"


def kind_of(code: Any) -> str:
    """Coarse kind used by the checks: wet | snow | fog | clear | cloudy | unknown."""
    try:
        c = int(code)
    except (TypeError, ValueError):
        return "unknown"
    if c in WET_CODES:
        return "wet"
    if c in SNOW_CODES:
        return "snow"
    if c in FOG_CODES:
        return "fog"
    if c in (0, 1):
        return "clear"
    if c in (2, 3):
        return "cloudy"
    return "unknown"


def hour_at(body: dict[str, Any], when_utc: datetime) -> dict[str, Any] | None:
    """The hourly row of an Open-Meteo response closest to `when_utc` (within 90 minutes).

    Open-Meteo returns local wall-clock strings shifted by ONE `utc_offset_seconds` for the
    whole response (the archive API uses the offset of today, not of the requested date, as
    checked on 2026-11-22), so the strings are turned back into UTC with that same offset.
    """
    hourly = body.get("hourly") if isinstance(body, dict) else None
    if not isinstance(hourly, dict) or not isinstance(hourly.get("time"), list):
        return None
    offset = timedelta(seconds=int(body.get("utc_offset_seconds") or 0))
    target = when_utc.astimezone(UTC)
    best, best_gap = None, timedelta(minutes=90)
    for i, stamp in enumerate(hourly["time"]):
        try:
            at = datetime.fromisoformat(str(stamp)).replace(tzinfo=UTC) - offset
        except ValueError:
            continue
        gap = abs(at - target)
        if gap <= best_gap:
            best, best_gap = i, gap
    if best is None:
        return None

    def val(name: str) -> Any:
        col = hourly.get(name)
        return col[best] if isinstance(col, list) and best < len(col) else None

    code = val("weather_code")
    hour_utc = (datetime.fromisoformat(str(hourly["time"][best])).replace(tzinfo=UTC) - offset)
    return {
        "hour_utc": hour_utc.isoformat().replace("+00:00", "Z"),
        "temperature_c": val("temperature_2m"),
        "cloud_cover": val("cloud_cover"),
        "precipitation_mm": val("precipitation"),
        "rain_mm": val("rain"),
        "snowfall_cm": val("snowfall"),
        "weather_code": code,
        "is_day": bool(val("is_day")) if val("is_day") is not None else None,
        "summary": weather_words(code),
        "kind": kind_of(code),
    }


def weather_sentence(hour: dict[str, Any]) -> str:
    """'light rain, 14 °C, 90% cloud cover, 0.6 mm of rain in that hour'."""
    parts = [str(hour.get("summary") or "unknown weather")]
    if isinstance(hour.get("temperature_c"), int | float):
        parts.append(f"{round(hour['temperature_c'])} °C")
    if isinstance(hour.get("cloud_cover"), int | float):
        parts.append(f"{round(hour['cloud_cover'])}% cloud cover")
    p = hour.get("precipitation_mm")
    if isinstance(p, int | float) and p > 0:
        parts.append(f"{p:g} mm of precipitation in that hour")
    return ", ".join(parts)
