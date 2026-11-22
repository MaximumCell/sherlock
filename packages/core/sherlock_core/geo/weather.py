"""Hourly weather in plain words: Open-Meteo's WMO weather codes, or NASA POWER's hourly values.

NASA POWER (https://power.larc.nasa.gov/, keyless) is the fallback when Open-Meteo is out of
quota or down. Its hourly point API (community RE, time-standard UTC) answers, as checked on
2026-11-22: T2M (°C), PRECTOTCORR (mm/hour), CLOUD_AMT (%), ALLSKY_SFC_SW_DWN and
CLRSKY_SFC_SW_DWN (Wh/m²; their ratio is a cloudiness proxy in daylight). Sources MERRA-2 and
CERES SYN1deg, so the record trails real time (recent days come back as the fill value -999).
"""
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
NASA_POWER_PARAMS = ("T2M", "PRECTOTCORR", "CLOUD_AMT", "ALLSKY_SFC_SW_DWN", "CLRSKY_SFC_SW_DWN")
NASA_FILL = -999.0
WET_MM = 0.1           # mm in the hour; reanalysis drizzles a few hundredths almost everywhere
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


# ----------------------------------------------------------------------------- NASA POWER
def _num(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, int | float) or v <= NASA_FILL + 1:
        return None
    return float(v)


def cloud_words(cloud_pct: float) -> str:
    return ("clear" if cloud_pct < 20 else "partly cloudy" if cloud_pct < 50
            else "cloudy" if cloud_pct < 80 else "overcast")


def _sunlight_words(allsky: float, clrsky: float) -> str:
    """Cloudiness from how much of the clear-sky sunlight reached the ground (daylight only)."""
    ratio = allsky / clrsky
    return ("clear" if ratio >= 0.85 else "partly cloudy" if ratio >= 0.6
            else "cloudy" if ratio >= 0.3 else "overcast")


def nasa_hour_at(body: dict[str, Any], when_utc: datetime) -> dict[str, Any] | None:
    """The hourly row of a NASA POWER response (time-standard UTC) for the hour nearest `when_utc`,
    in the same shape as `hour_at`. None when that hour is missing or holds only fill values
    (too recent: the record trails real time)."""
    props = body.get("properties") if isinstance(body, dict) else None
    params = props.get("parameter") if isinstance(props, dict) else None
    if not isinstance(params, dict):
        return None
    hour = (when_utc.astimezone(UTC) + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)
    stamp = hour.strftime("%Y%m%d%H")

    def val(name: str) -> float | None:
        col = params.get(name)
        return _num(col.get(stamp)) if isinstance(col, dict) else None

    temp, precip, cloud = val("T2M"), val("PRECTOTCORR"), val("CLOUD_AMT")
    allsky, clrsky = val("ALLSKY_SFC_SW_DWN"), val("CLRSKY_SFC_SW_DWN")
    if temp is None and precip is None and cloud is None and allsky is None:
        return None
    estimate = None
    if precip is not None and precip >= WET_MM:
        if temp is not None and temp <= 0:
            summary, kind = ("light snow" if precip < 1 else "snow"), "snow"
        else:
            summary, kind = ("light rain" if precip < 1 else "rain" if precip < 4 else "heavy rain"), "wet"
    elif cloud is not None:
        summary = cloud_words(cloud)
        kind = "clear" if summary == "clear" else "cloudy"
    elif allsky is not None and clrsky is not None and clrsky >= 50:
        summary, estimate = _sunlight_words(allsky, clrsky), "from sunlight reaching the ground"
        kind = "clear" if summary == "clear" else "cloudy"
    else:
        summary, kind = "no cloud data", "unknown"
    return {
        "hour_utc": hour.isoformat().replace("+00:00", "Z"),
        "temperature_c": round(temp, 1) if temp is not None else None,
        "cloud_cover": round(cloud) if cloud is not None else None,
        "precipitation_mm": round(precip, 2) if precip is not None else None,
        "rain_mm": None, "snowfall_cm": None, "weather_code": None,
        "is_day": (clrsky > 0) if clrsky is not None else None,
        "summary": summary, "kind": kind,
        **({"cloud_estimate": estimate} if estimate else {}),
    }
