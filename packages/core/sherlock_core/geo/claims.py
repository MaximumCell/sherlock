"""Where and when a photo could have been taken: the user's claim and plain-language checks.

`assess_claim` compares what the camera recorded (EXIF), what the user claims, where the sun
was, what the weather was and what Google Lens titles say. Each `Check` stands on its own with
a verdict (consistent / inconsistent / cant_tell), the reason, and what to look at in the photo.
There is deliberately no overall score: the checks support a person's judgement, they prove
nothing (EXIF is easy to strip or fake, camera clocks are often wrong).

Pure: no network, no store. The `geo_context` module gathers the inputs.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta, timezone
from typing import Any, Literal

from sherlock_core.geo.solar import shadow_words

Verdict = Literal["consistent", "inconsistent", "cant_tell"]
VERDICTS: tuple[str, ...] = ("consistent", "inconsistent", "cant_tell")

# Camera GPS is rounded to 2 decimals (about 1 km); a claimed point is rounded the same way.
COORD_DECIMALS = 2
NEAR_KM = 3.0                 # a precise claimed point (map pick or landmark)
NEAR_KM_COARSE = 25.0         # a claimed town or area
FAR_FACTOR = 4.0              # beyond NEAR * FAR_FACTOR the places do not match
TIME_MATCH_MIN = 15
TIME_LOOSE_H = 3              # camera clocks are often off by an hour or two (time zone, DST)
EDITING_SOFTWARE = ("photoshop", "lightroom", "gimp", "snapseed", "picsart", "affinity", "pixelmator",
                    "canva", "facetune", "vsco", "afterlight")
_STOP = frozenset({"the", "of", "and", "near", "in", "at", "de", "la", "le", "du", "des", "street", "road"})
MAX_PLACE_LEN = 120


@dataclass(frozen=True)
class Check:
    key: str
    verdict: Verdict
    title: str
    reason: str
    look_for: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ----------------------------------------------------------------------------- claim parsing
def round_coord(v: float) -> float:
    return round(float(v), COORD_DECIMALS)


def parse_aware(value: Any) -> datetime | None:
    """An ISO 8601 date-time WITH an offset ('2026-06-14T19:40:00+02:00', 'Z' allowed), else None."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        dt = datetime.fromisoformat(value.strip().replace("Z", "+00:00").replace("z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo is not None and dt.utcoffset() is not None else None


def normalize_claim(raw: Any) -> dict[str, Any] | None:
    """The claim as stored in job params: `{place?, lat?, lon?, taken_at?}`, coordinates rounded
    to 2 decimals and the time in ISO 8601 with its offset. Raises ValueError (message fit for the
    user) on a bad claim; returns None for an empty one."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("the claim must be an object")
    unknown = set(raw) - {"place", "lat", "lon", "taken_at"}
    if unknown:
        raise ValueError(f"unknown claim field(s): {', '.join(sorted(unknown))}")
    out: dict[str, Any] = {}
    place = raw.get("place")
    if place is not None:
        if not isinstance(place, str):
            raise ValueError("place must be text")
        place = re.sub(r"\s+", " ", place).strip()
        if len(place) > MAX_PLACE_LEN:
            raise ValueError(f"place must be at most {MAX_PLACE_LEN} characters")
        if place:
            out["place"] = place
    lat, lon = raw.get("lat"), raw.get("lon")
    if (lat is None) != (lon is None):
        raise ValueError("give both lat and lon, or neither")
    if lat is not None:
        if isinstance(lat, bool) or isinstance(lon, bool) or not isinstance(lat, int | float) \
                or not isinstance(lon, int | float) or not (math.isfinite(lat) and math.isfinite(lon)):
            raise ValueError("lat and lon must be numbers")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("lat must be between -90 and 90 and lon between -180 and 180")
        out["lat"], out["lon"] = round_coord(lat), round_coord(lon)
    taken = raw.get("taken_at")
    if taken is not None:
        dt = parse_aware(taken)
        if dt is None:
            raise ValueError("taken_at must be an ISO 8601 date and time with a time zone offset, "
                             "e.g. 2026-06-14T19:40:00+02:00")
        if dt.year < 1900:
            raise ValueError("taken_at is too early")
        if dt.astimezone(UTC) > datetime.now(UTC) + timedelta(days=1):
            raise ValueError("taken_at is in the future")
        out["taken_at"] = dt.isoformat()
    return out or None


# ----------------------------------------------------------------------------- small helpers
def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def parse_exif_time(value: Any, offset: Any = None) -> datetime | None:
    """EXIF 'YYYY:MM:DD HH:MM:SS' (naive local camera time), aware when an OffsetTime is given."""
    if not isinstance(value, str):
        return None
    m = re.match(r"^\s*(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?", value)
    if not m:
        return None
    try:
        dt = datetime(*(int(x or 0) for x in m.groups()))  # type: ignore[misc]
    except ValueError:
        return None
    if dt.year < 1900:
        return None
    om = re.match(r"^\s*([+-])(\d{2}):?(\d{2})\s*$", offset) if isinstance(offset, str) else None
    if om:
        sign = -1 if om.group(1) == "-" else 1
        dt = dt.replace(tzinfo=timezone(sign * timedelta(hours=int(om.group(2)), minutes=int(om.group(3)))))
    return dt


def format_offset(td: timedelta | None) -> str | None:
    if td is None:
        return None
    total = int(td.total_seconds() // 60)
    sign = "-" if total < 0 else "+"
    h, m = divmod(abs(total), 60)
    return f"{sign}{h:02d}:{m:02d}"


def hhmm(value: Any) -> str | None:
    """'18:40' from an ISO local time string."""
    if isinstance(value, datetime):
        return value.strftime("%H:%M")
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).strftime("%H:%M")
        except ValueError:
            return None
    return None


def _fold(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def place_phrases(*sources: Any) -> list[str]:
    """Distinct place names to look for in titles ('Eiffel Tower, Paris' -> eiffel tower, paris)."""
    out: list[str] = []
    for src in sources:
        items: Iterable[Any] = src if isinstance(src, list | tuple) else [src]
        for item in items:
            if not isinstance(item, str):
                continue
            for part in re.split(r"[,;/()|]", item):
                p = _fold(part)
                words = [w for w in p.split() if w not in _STOP and not w.isdigit()]
                if not words or (len(words) == 1 and len(words[0]) < 4):
                    continue
                phrase = " ".join(words)
                if phrase not in out:
                    out.append(phrase)
    return out


def _distance_words(km: float) -> str:
    return f"{km:.1f} km" if km < 10 else f"{km:,.0f} km"


def _duration_words(minutes: float) -> str:
    minutes = abs(minutes)
    if minutes < 90:
        return f"{round(minutes)} minutes"
    hours = minutes / 60
    if hours < 48:
        return f"{hours:.1f} hours".replace(".0 hours", " hours")
    return f"{round(hours / 24)} days"


# ----------------------------------------------------------------------------- the checks
def assess_claim(
    exif: dict[str, Any] | None,
    claim: dict[str, Any] | None,
    sun: list[dict[str, Any]] | None,
    weather: list[dict[str, Any]] | None,
    lens_matches: list[dict[str, Any]] | None,
    *,
    place: dict[str, Any] | None = None,
    camera_utc: datetime | None = None,
    claim_place_offset: str | None = None,
    timezone_name: str | None = None,
) -> list[Check]:
    """Plain-language checks of a photo's where-and-when.

    exif         image_meta's EXIF subset: `datetime` ('YYYY:MM:DD HH:MM:SS'), `gps_lat`, `gps_lon`,
                 `software` (optional `offset_time`).
    claim        `{place?, lat?, lon?, taken_at?}` plus `resolved: {lat, lon, label, precise}` when the
                 free-text place was looked up.
    sun          one entry per moment: `{label: "camera" | "claim", local_time, ...SunPosition}`.
    weather      one entry per moment: `{label, ...weather.hour_at() row}`.
    lens_matches Google Lens rows: `{title, source}`.
    place        coarse place names of the photo's location (`label`, `city`, `district`, `country`).
    camera_utc   the camera time in UTC (the EXIF time is local; the module knows the time zone).
    claim_place_offset  the local UTC offset at the claimed place and time ('+01:00').
    """
    exif = exif or {}
    claim = claim or {}
    checks: list[Check] = []
    resolved = claim.get("resolved") if isinstance(claim.get("resolved"), dict) else {}
    claim_lat = claim.get("lat", resolved.get("lat"))
    claim_lon = claim.get("lon", resolved.get("lon"))
    claim_label = claim.get("place") or resolved.get("label")
    precise = claim.get("lat") is not None or bool(resolved.get("precise"))
    cam_lat, cam_lon = exif.get("gps_lat"), exif.get("gps_lon")
    has_gps = isinstance(cam_lat, int | float) and isinstance(cam_lon, int | float)
    cam_time = parse_exif_time(exif.get("datetime"), exif.get("offset_time"))
    claim_time = parse_aware(claim.get("taken_at"))

    # 1. metadata present at all, and edited?
    if not has_gps and cam_time is None:
        checks.append(Check(
            "camera_metadata", "cant_tell", "No camera time or location in the file",
            "The photo carries no camera time or GPS. That is normal: most sites and messaging apps strip it. "
            "It says nothing for or against the claim.",
            "Rely on what the picture itself shows: signs, landmarks, shadows, weather, vegetation.",
        ))
    software = str(exif.get("software") or "")
    if software and any(s in software.lower() for s in EDITING_SOFTWARE):
        checks.append(Check(
            "edited", "cant_tell", f"Saved by editing software ({software[:60]})",
            "The file was last saved by an editing app, so its time and location data may have been changed.",
            "Treat the camera time and GPS below as hints only; look for an earlier copy of the picture.",
        ))

    # 2. where: camera GPS against the claimed place
    if claim_lat is not None and claim_lon is not None:
        where = claim_label or f"{claim_lat:.2f}, {claim_lon:.2f}"
        if has_gps:
            km = haversine_km(float(cam_lat), float(cam_lon), float(claim_lat), float(claim_lon))  # type: ignore[arg-type]
            near = NEAR_KM if precise else NEAR_KM_COARSE
            if km <= near:
                checks.append(Check(
                    "location_distance", "consistent", f"Camera GPS is {_distance_words(km)} from the claimed place",
                    f"The location saved by the camera is within {near:g} km of {where} (both are rounded to about 1 km).",
                    "Check that the landmarks, signs and terrain in the photo fit that place.",
                ))
            elif km <= near * FAR_FACTOR:
                checks.append(Check(
                    "location_distance", "cant_tell", f"Camera GPS is {_distance_words(km)} from the claimed place",
                    f"Close to {where}, but further than a precise match. The claim may name a wider area, or the "
                    "GPS fix may have been poor.",
                    "Look for something in the photo that pins the exact spot: a street sign, a building, a view.",
                ))
            else:
                checks.append(Check(
                    "location_distance", "inconsistent", f"Camera GPS is {_distance_words(km)} from the claimed place",
                    f"The camera recorded a location far from {where}. Either the claim is wrong, the photo was "
                    "re-saved on another device, or the GPS data was changed.",
                    "Compare what the photo shows with both places; search for the scene near the camera location.",
                ))
        else:
            checks.append(Check(
                "location_distance", "cant_tell", "No camera GPS to compare with the claimed place",
                f"The file has no GPS data, so nothing in it confirms or contradicts {where}.",
                "Compare the photo with street-level imagery of the claimed place (links below).",
            ))

    # 3. when: camera clock against the claimed time
    if claim_time is not None and cam_time is not None:
        cam_aware = cam_time if cam_time.tzinfo else (camera_utc.replace(tzinfo=UTC) if camera_utc and
                                                      camera_utc.tzinfo is None else camera_utc)
        if cam_aware is None:
            checks.append(Check(
                "time_difference", "cant_tell", "Camera time could not be placed in a time zone",
                f"The camera says {cam_time:%Y-%m-%d %H:%M} (local, no time zone) and the place's time zone is unknown.",
                "Compare the light in the photo with the claimed time of day.",
            ))
        else:
            minutes = (claim_time - cam_aware).total_seconds() / 60
            cam_local = cam_time.strftime("%Y-%m-%d %H:%M")
            if abs(minutes) <= TIME_MATCH_MIN:
                checks.append(Check(
                    "time_difference", "consistent", "Camera time matches the claimed time",
                    f"The camera clock says {cam_local} local time, within {TIME_MATCH_MIN} minutes of the claim.",
                    "Camera clocks can be set to anything, so also check the light and shadows.",
                ))
            elif abs(minutes) <= TIME_LOOSE_H * 60:
                checks.append(Check(
                    "time_difference", "cant_tell", f"Camera time is {_duration_words(minutes)} from the claim",
                    f"The camera clock says {cam_local} local time. Clocks are often off by an hour or two "
                    "(time zone or daylight saving not set), so this neither confirms nor contradicts the claim.",
                    "Compare the sun's direction and the shadow length for both times (see the sun dial).",
                ))
            else:
                checks.append(Check(
                    "time_difference", "inconsistent", f"Camera time is {_duration_words(minutes)} from the claim",
                    f"The camera clock says {cam_local} local time. A wrong camera clock can explain this, "
                    "but it does not fit the claimed time.",
                    "Check whether the light, shadows and weather fit the camera time or the claimed time.",
                ))

    # 4. the claim's own time zone against the local time at that place
    if claim_time is not None and claim_place_offset:
        given = format_offset(claim_time.utcoffset())
        tzn = f" ({timezone_name})" if timezone_name else ""
        if given == claim_place_offset:
            checks.append(Check(
                "time_zone", "consistent", f"Time zone {given} is local time there",
                f"On that date the local time at the claimed place is UTC{claim_place_offset}{tzn}.",
            ))
        else:
            checks.append(Check(
                "time_zone", "inconsistent", f"Time zone {given} is not local time there",
                f"On that date the local time at the claimed place is UTC{claim_place_offset}{tzn}, not "
                f"UTC{given}. The claimed time may be in another time zone, or the claim may be wrong.",
                "Make sure which local time the claim means before comparing the light.",
            ))

    # 5. sun: what the light should look like
    for s in sun or []:
        label = s.get("label")
        who = "camera time" if label == "camera" else "claimed time"
        at = hhmm(s.get("local_time"))
        solar = hhmm(s.get("solar_time"))      # zone unknown: approximate solar time, never "local"
        when = (f"At the {who} ({at} local)" if at else f"At the {who} (about {solar} solar time)" if solar
                else f"At the {who}")
        elev = s.get("elevation")
        if not isinstance(elev, int | float):
            continue
        if s.get("daylight") == "night":
            checks.append(Check(
                f"sun_{label}", "cant_tell", f"Dark at the {who}",
                f"{when} the sun was {abs(elev):.0f}° below the horizon: night.",
                "A photo in daylight does not fit this time; artificial light, a dark sky and lit windows do.",
            ))
        elif s.get("daylight") == "twilight":
            checks.append(Check(
                f"sun_{label}", "cant_tell", f"Twilight at the {who}",
                f"{when} the sun was just below the horizon ({elev:.0f}°): dusk or dawn light, no direct shadows.",
                f"Expect a bright sky towards the {s.get('compass')} and soft light without hard shadows.",
            ))
        else:
            checks.append(Check(
                f"sun_{label}", "cant_tell", f"Sun {elev:.0f}° above the horizon at the {who}",
                f"{when} the sun stood in the {s.get('compass')} (azimuth {s.get('azimuth', 0):.0f}°), "
                f"{elev:.0f}° above the horizon: expect {shadow_words_from(s)}.",
                f"Shadows of upright things (poles, people, walls) should point {s.get('shadow_compass')} "
                f"(about {s.get('shadow_azimuth', 0):.0f}° from north). If they point another way, or the light "
                "is from the wrong side of a known landmark, the time or place is off.",
            ))

    # 6. weather
    for w in weather or []:
        label = w.get("label")
        who = "camera time" if label == "camera" else "claimed time"
        kind = w.get("kind")
        summary = str(w.get("summary") or "unknown weather")
        temp = w.get("temperature_c")
        temp_words = f", {round(temp)} °C" if isinstance(temp, int | float) else ""
        precip = w.get("precipitation_mm")
        cloud = w.get("cloud_cover")
        if kind == "wet" or (isinstance(precip, int | float) and precip >= 0.5):
            heavy = isinstance(precip, int | float) and precip >= 4
            checks.append(Check(
                f"weather_{label}", "cant_tell",
                f"{'Raining heavily' if heavy else 'Rain'} at the {who}",
                f"The weather record for that hour says {summary}{temp_words}"
                + (f", {precip:g} mm of rain" if isinstance(precip, int | float) and precip > 0 else "") + ".",
                "Check whether the photo shows wet ground, puddles, umbrellas, raindrops or a grey sky.",
            ))
        elif kind == "snow":
            checks.append(Check(
                f"weather_{label}", "cant_tell", f"Snow at the {who}",
                f"The weather record for that hour says {summary}{temp_words}.",
                "Look for falling snow, snow on the ground or roofs, and winter clothing.",
            ))
        elif kind == "fog":
            checks.append(Check(
                f"weather_{label}", "cant_tell", f"Fog at the {who}",
                f"The weather record for that hour says {summary}{temp_words}.",
                "Distant buildings should fade into haze; a crisp, far view does not fit.",
            ))
        elif kind == "clear" or (isinstance(cloud, int | float) and cloud <= 20):
            checks.append(Check(
                f"weather_{label}", "cant_tell", f"Clear sky at the {who}",
                f"The weather record for that hour says {summary}{temp_words}.",
                "A sunny photo with hard shadows fits; a heavily overcast or rainy scene does not.",
            ))
        elif kind == "cloudy":
            checks.append(Check(
                f"weather_{label}", "cant_tell", f"{summary.capitalize()} at the {who}",
                f"The weather record for that hour says {summary}{temp_words}"
                + (f", {round(cloud)}% cloud cover" if isinstance(cloud, int | float) else "") + ".",
                "Expect soft light and weak or no shadows when it was overcast.",
            ))
        if isinstance(temp, int | float) and (temp <= 0 or temp >= 30):
            checks.append(Check(
                f"temperature_{label}", "cant_tell",
                f"{'Freezing' if temp <= 0 else 'Hot'} at the {who} ({round(temp)} °C)",
                f"The recorded temperature for that hour was {round(temp)} °C.",
                "Winter coats, ice or bare trees fit freezing weather; summer clothes and full foliage fit heat."
                if temp <= 0 else "Summer clothes and full foliage fit; heavy coats or snow would not.",
            ))

    # 7. Google Lens titles against the claimed place (or the photo's place)
    phrases = place_phrases(claim.get("place"), resolved.get("landmark"), resolved.get("city"))
    against = "the claimed place"
    if not phrases and place:
        phrases = place_phrases(place.get("landmark"), place.get("district"), place.get("city"))
        against = "the place where the camera says it was"
    titles = [str(m.get("title") or "") for m in lens_matches or [] if isinstance(m, dict) and m.get("title")]
    if phrases:
        if not titles:
            checks.append(Check(
                "lens_place", "cant_tell", "No Google Lens matches to compare",
                "Reverse image search found no pages with this picture yet (or it is not set up on this server).",
                "Try the manual reverse image search links; an older copy of the photo can show where it really comes from.",
            ))
        else:
            folded = [_fold(t) for t in titles]
            hits = {p: sum(1 for t in folded if re.search(rf"\b{re.escape(p)}\b", t)) for p in phrases}
            best = [p for p in phrases if hits[p]]
            if best:
                names = ", ".join(_title_case(p) for p in best[:3])
                n = max(hits[p] for p in best)
                checks.append(Check(
                    "lens_place", "consistent", f"Google Lens titles mention {names}",
                    f"{n} of {len(titles)} pages showing this picture mention {names}, consistent with {against}.",
                    "Open the earliest of those pages: an older copy may show the original context and date.",
                ))
            else:
                checks.append(Check(
                    "lens_place", "cant_tell", f"Google Lens titles do not mention {against}",
                    f"None of the {len(titles)} page titles showing this picture mention "
                    f"{', '.join(_title_case(p) for p in phrases[:3])}. Titles are often vague, so this is not a contradiction.",
                    "Read the matching pages: if they place the same picture somewhere else, the claim is doubtful.",
                ))
    return checks


def shadow_words_from(s: dict[str, Any]) -> str:
    from sherlock_core.geo.solar import describe

    return shadow_words(describe(float(s.get("azimuth") or 0), float(s.get("elevation") or 0)))


def _title_case(phrase: str) -> str:
    return " ".join(w.capitalize() for w in phrase.split())


def summarize(checks: list[Check]) -> str:
    """'1 consistent, 1 inconsistent, 4 to look at' (no overall score, on purpose)."""
    counts = {v: sum(1 for c in checks if c.verdict == v) for v in VERDICTS}
    parts = []
    if counts["consistent"]:
        parts.append(f"{counts['consistent']} consistent")
    if counts["inconsistent"]:
        parts.append(f"{counts['inconsistent']} inconsistent")
    if counts["cant_tell"]:
        parts.append(f"{counts['cant_tell']} to look at")
    return ", ".join(parts) if parts else "nothing to check yet"
