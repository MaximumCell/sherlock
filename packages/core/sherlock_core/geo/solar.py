"""Where the sun was: solar azimuth and elevation for a place and an instant, in pure Python.

The NOAA solar calculator equations (Meeus, "Astronomical Algorithms"), with NOAA's
atmospheric refraction correction. Accuracy is a few hundredths of a degree for dates
between 1800 and 2100, far finer than anything a photo can show. UT is used for TT
(delta T is about a minute, a 0.004 degree error).

Shadows: a vertical object casts its shadow away from the sun (azimuth + 180) with a length
of 1 / tan(elevation) times its height. Below the horizon there is no direct shadow.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from datetime import UTC, datetime

COMPASS_16 = ("N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
              "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW")
# Civil twilight ends 6 degrees below the horizon.
CIVIL_TWILIGHT = -6.0
# A shadow longer than this many heights is "very long"; capped so near-horizon suns stay readable.
MAX_SHADOW_RATIO = 50.0


@dataclass(frozen=True)
class SunPosition:
    azimuth: float               # degrees clockwise from true north, 0..360
    elevation: float             # degrees above the horizon, refraction included
    shadow_azimuth: float | None  # where shadows of vertical objects point (None: sun down)
    shadow_ratio: float | None   # shadow length / object height (None: sun down)
    daylight: str                # "day" | "twilight" | "night"
    compass: str                 # 16-point compass name of the sun's azimuth
    shadow_compass: str | None

    def to_dict(self) -> dict:
        return asdict(self)


def compass(azimuth: float) -> str:
    return COMPASS_16[int(((azimuth % 360) + 11.25) // 22.5) % 16]


def julian_day(when: datetime) -> float:
    """Julian day of an aware datetime (naive values are taken as UTC)."""
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    when = when.astimezone(UTC)
    return when.timestamp() / 86400.0 + 2440587.5


def _refraction(elevation: float) -> float:
    """NOAA's approximate atmospheric refraction, in degrees, for a geometric elevation."""
    if elevation > 85.0:
        return 0.0
    te = math.tan(math.radians(elevation))
    if elevation > 5.0:
        arcsec = 58.1 / te - 0.07 / te**3 + 0.000086 / te**5
    elif elevation > -0.575:
        arcsec = 1735.0 + elevation * (-518.2 + elevation * (103.4 + elevation * (-12.79 + elevation * 0.711)))
    else:
        arcsec = -20.772 / te
    return arcsec / 3600.0


def solar_position(lat: float, lon: float, when: datetime) -> SunPosition:
    """Sun azimuth/elevation seen from (lat, lon) at `when` (aware; naive means UTC)."""
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        raise ValueError("latitude/longitude out of range")
    jd = julian_day(when)
    t = (jd - 2451545.0) / 36525.0
    l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360.0
    m = 357.52911 + t * (35999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    mr = math.radians(m)
    c = (math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t))
         + math.sin(2 * mr) * (0.019993 - 0.000101 * t) + math.sin(3 * mr) * 0.000289)
    omega = math.radians(125.04 - 1934.136 * t)
    app_long = math.radians(l0 + c - 0.00569 - 0.00478 * math.sin(omega))
    eps0 = 23.0 + (26.0 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0
    eps = math.radians(eps0 + 0.00256 * math.cos(omega))
    decl = math.asin(math.sin(eps) * math.sin(app_long))

    y = math.tan(eps / 2) ** 2
    l0r = math.radians(l0)
    eot = 4.0 * math.degrees(
        y * math.sin(2 * l0r) - 2 * e * math.sin(mr) + 4 * e * y * math.sin(mr) * math.cos(2 * l0r)
        - 0.5 * y * y * math.sin(4 * l0r) - 1.25 * e * e * math.sin(2 * mr)
    )  # minutes

    utc = (when if when.tzinfo else when.replace(tzinfo=UTC)).astimezone(UTC)
    minutes = utc.hour * 60 + utc.minute + utc.second / 60 + utc.microsecond / 6e7
    tst = (minutes + eot + 4.0 * lon) % 1440.0
    hour_angle = tst / 4.0 - 180.0 if tst >= 0 else tst / 4.0 + 180.0
    latr, har = math.radians(lat), math.radians(hour_angle)
    cos_zen = math.sin(latr) * math.sin(decl) + math.cos(latr) * math.cos(decl) * math.cos(har)
    zenith = math.acos(max(-1.0, min(1.0, cos_zen)))
    geometric = 90.0 - math.degrees(zenith)

    denom = math.cos(latr) * math.sin(zenith)
    if abs(denom) < 1e-12:           # sun straight overhead or at a pole
        azimuth = 180.0 if lat > math.degrees(decl) else 0.0
    else:
        cos_az = (math.sin(latr) * math.cos(zenith) - math.sin(decl)) / denom
        a = math.degrees(math.acos(max(-1.0, min(1.0, cos_az))))
        azimuth = (a + 180.0) % 360.0 if hour_angle > 0 else (540.0 - a) % 360.0

    elevation = geometric + _refraction(geometric)
    return describe(azimuth, elevation)


def describe(azimuth: float, elevation: float) -> SunPosition:
    """Shadow and daylight wording for a sun position (rounded for display)."""
    azimuth = round(azimuth % 360.0, 2)
    elevation = round(elevation, 2)
    if elevation > 0:
        shadow_az = round((azimuth + 180.0) % 360.0, 2)
        ratio = round(min(MAX_SHADOW_RATIO, 1.0 / math.tan(math.radians(elevation))), 2)
        shadow_c: str | None = compass(shadow_az)
    else:
        shadow_az, ratio, shadow_c = None, None, None
    daylight = "day" if elevation > 0 else "twilight" if elevation > CIVIL_TWILIGHT else "night"
    return SunPosition(azimuth=azimuth, elevation=elevation, shadow_azimuth=shadow_az, shadow_ratio=ratio,
                       daylight=daylight, compass=compass(azimuth), shadow_compass=shadow_c)


def shadow_words(sun: SunPosition) -> str:
    """'long shadows (about 5.7 times the height of the object)' and similar plain words."""
    if sun.shadow_ratio is None:
        return "no direct shadows (the sun was below the horizon)"
    r = sun.shadow_ratio
    size = ("very long" if r >= 4 else "long" if r >= 1.5 else "medium" if r >= 0.7 else "short")
    times = f"{r:.1f}" if r < 10 else f"{r:.0f}"
    return f"{size} shadows (about {times} times the height of the object)"
