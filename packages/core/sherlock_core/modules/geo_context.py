"""Where and when: context to check a photo's location and time claim (places and conditions, never people).

For the photo's location (camera GPS, else the user's claimed place) and time (camera time and/or
the claimed time) this module looks up, from free public sources:

  geo-sun      sun azimuth/elevation and the expected shadows (computed locally, `geo.solar`)
  geo-weather  the weather that hour (Open-Meteo archive / forecast APIs, keyless)
  geo-place    a coarse place name: district, city, country (OpenStreetMap Nominatim, keyless,
               at most one request per second; street names, house numbers and postcodes are dropped)
  geo-street   ready-made links to OpenStreetMap / Google Maps / Street View / Mapillary
  geo-checks   plain-language consistency checks (`geo.claims.assess_claim`), each with a verdict

Two optional modules in this file need a free key and report themselves unavailable without it:
  geo_webcams        -> geo-webcams        public webcams nearby (Windy Webcams API, WINDY_WEBCAMS_KEY)
  geo_street_images  -> geo-street-images  nearest public Mapillary images (MAPILLARY_TOKEN)
They locate the photo the same way (camera GPS, else the claim).

The EXIF data is read here from the image itself rather than from the case's `image_meta` finding:
media jobs of one search run at the same time, so that finding may not exist yet, and reading the
file again keeps this module independent (and re-runnable alone with a new claim). Coordinates are
rounded to 2 decimals (about 1 km) before any request and in everything stored.

Google Lens titles come from the case's `reverse_image` findings, read through the store; when the
Lens job of the same search is still running this module waits for it briefly. Each facet always
produces its row (found, not_found with a reason, or error), so re-running with a new claim replaces
every row. No face detection or recognition is performed.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import zoneinfo
from datetime import UTC, date, datetime, timedelta, timezone, tzinfo
from typing import Any

import httpx
import PIL  # noqa: F401 - optional dep: ImportError => module skipped by the registry

from sherlock_core import uploads
from sherlock_core.geo import claims as geo_claims
from sherlock_core.geo.solar import shadow_words, solar_position
from sherlock_core.geo.weather import HOURLY_VARS, hour_at, weather_sentence
from sherlock_core.modules import register
from sherlock_core.modules._util import (
    UpstreamError,
    clean,
    describe_http_error,
    fetch_capped,
    is_public_http_url,
)
from sherlock_core.modules.avatar_hash import open_image
from sherlock_core.modules.base import DEFAULT_UA, Module, ModuleContext, Target
from sherlock_core.modules.image_meta import MAX_IMAGE_BYTES, read_exif

log = logging.getLogger("sherlock.module.geo_context")

OPEN_METEO_FORECAST = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
NOMINATIM = "https://nominatim.openstreetmap.org"
WINDY_WEBCAMS = "https://api.windy.com/webcams/api/v3/webcams"
MAPILLARY_IMAGES = "https://graph.mapillary.com/images"
OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
WEATHER_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"

ARCHIVE_LAG_DAYS = 5          # the reanalysis archive trails real time by about five days
FORECAST_AHEAD_DAYS = 15
NOMINATIM_MIN_INTERVAL_S = 1.1  # usage policy: at most one request per second
WEBCAM_RADIUS_KM = 15
STREET_BOX_DEG = 0.01         # about 1 km around the (rounded) point
MAX_WEBCAMS = 6
MAX_STREET_IMAGES = 6
LENS_WAIT_S = 40.0
LENS_POLL_S = 3.0
_OFFSET_TIME_ORIGINAL = 0x9011
_IFD_EXIF = 0x8769
# Coarse address fields kept from reverse geocoding; everything else (road, house_number,
# postcode, neighbourhood, city_block...) is dropped before storage.
_DISTRICT_KEYS = ("city_district", "suburb", "borough", "district")
_CITY_KEYS = ("city", "town", "village", "municipality")
_LANDMARK_CATEGORIES = frozenset({"tourism", "historic", "man_made", "natural", "leisure"})
NO_LOCATION = ("No location to check: the photo has no camera GPS and no claimed place was given. "
               "Add the place the photo is said to show.")
NO_TIME = ("No time to check: the photo has no camera time and no claimed time was given. "
           "Add the date and time the photo is said to be from.")

_nominatim_locks: dict[asyncio.AbstractEventLoop, asyncio.Lock] = {}
_nominatim_last = 0.0
_reverse_cache: dict[tuple[float, float], dict[str, Any]] = {}


# ----------------------------------------------------------------------------- helpers
def _r(v: float) -> float:
    return geo_claims.round_coord(v)


def links_for(lat: float, lon: float) -> dict[str, str]:
    """Ready-made links to open a (rounded) point on public maps and street-level imagery."""
    lat, lon = _r(lat), _r(lon)
    return {
        "openstreetmap": f"https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=16/{lat}/{lon}",
        "google_maps": f"https://www.google.com/maps/search/?api=1&query={lat},{lon}",
        "google_street_view": f"https://www.google.com/maps/@?api=1&map_action=pano&viewpoint={lat},{lon}",
        "mapillary": f"https://www.mapillary.com/app/?lat={lat}&lng={lon}&z=16",
    }


def coarse_address(address: Any) -> dict[str, str]:
    """District / city / state / country only. Never a street, house number or postcode."""
    if not isinstance(address, dict):
        return {}
    city = next((str(address[k]) for k in _CITY_KEYS if address.get(k)), None)
    district = next((str(address[k]) for k in _DISTRICT_KEYS if address.get(k) and address.get(k) != city), None)
    out = {
        "district": district, "city": city, "state": address.get("state"),
        "country": address.get("country"),
        "country_code": str(address.get("country_code") or "").upper() or None,
    }
    return {k: str(v)[:80] for k, v in out.items() if v}


def place_label(place: dict[str, Any]) -> str | None:
    parts = [place.get("landmark"), place.get("district"), place.get("city"), place.get("country")]
    seen: list[str] = []
    for p in parts:
        if p and p not in seen:
            seen.append(p)
    return ", ".join(seen) or None


def _zone(name: str | None, offset_s: int | None) -> tuple[tzinfo | None, bool]:
    """(tzinfo, exact). Exact = a real IANA zone (DST aware), else Open-Meteo's single offset."""
    if name:
        try:
            return zoneinfo.ZoneInfo(name), True
        except (zoneinfo.ZoneInfoNotFoundError, ValueError):
            pass
    if offset_s is not None:
        return timezone(timedelta(seconds=offset_s)), False
    return None, False


def _exif_extras(data: bytes) -> tuple[dict[str, Any], str | None]:
    """image_meta's EXIF subset plus OffsetTimeOriginal. Raises ValueError for unreadable images."""
    img = open_image(data)
    exif = read_exif(img)
    offset = None
    try:
        raw = img.getexif().get_ifd(_IFD_EXIF).get(_OFFSET_TIME_ORIGINAL)
        if raw:
            offset = (raw.decode("ascii", "replace") if isinstance(raw, bytes) else str(raw)).strip("\x00 ")
    except Exception:  # noqa: BLE001 - malformed EXIF never fails the module
        offset = None
    return exif, offset


def _row_reason(ctx: ModuleContext, module: Module, target: Target, platform: str, reason: str,
                *, status: str = "not_found", url: str | None = None, **meta: Any) -> dict[str, Any]:
    return ctx.finding(module, target, platform=platform, status=status, url=url,
                       extra={"note": reason[:300]}, meta=clean({"reason": reason[:300], **meta}))


# ----------------------------------------------------------------------------- module
@register
class GeoContext(Module):
    name = "geo_context"
    title = "Where and when (photo location check)"
    description = ("Sun position, weather, coarse place name and street-level links for where and when a photo "
                   "was taken or is claimed to be from, with plain-language consistency checks.")
    inputs = ("image",)
    queue = "media"
    source_url = "https://open-meteo.com/"
    timeout_s = 110.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        try:
            claim = geo_claims.normalize_claim(target.params.get("claim")) or {}
        except ValueError as e:
            ctx.log.info("ignoring an invalid claim: %s", e)
            claim = {}
        exif, offset, exif_error = await self._read_exif(target, ctx)
        if offset:
            exif = {**exif, "offset_time": offset}
        await ctx.progress(20, "photo metadata read")

        # the claimed place: a picked point, else the free-text place looked up (coarse)
        resolved: dict[str, Any] = {}
        resolve_error = None
        if claim.get("place") and claim.get("lat") is None:
            try:
                resolved = await self._search_place(ctx, claim["place"])
            except (httpx.HTTPError, UpstreamError) as e:
                resolve_error = f"could not look up the claimed place: {_why(e)}"
        claim_full = {**claim, **({"resolved": resolved} if resolved else {})}
        claim_point = ((claim["lat"], claim["lon"]) if claim.get("lat") is not None
                       else (resolved["lat"], resolved["lon"]) if resolved.get("lat") is not None else None)
        gps = ((exif["gps_lat"], exif["gps_lon"]) if isinstance(exif.get("gps_lat"), int | float)
               and isinstance(exif.get("gps_lon"), int | float) else None)
        location = gps or claim_point
        location_source = "camera" if gps else "claim" if claim_point else None

        cam_time = geo_claims.parse_exif_time(exif.get("datetime"), offset)
        claim_time = geo_claims.parse_aware(claim.get("taken_at"))
        moments: list[tuple[str, tuple[float, float], datetime]] = []
        if cam_time is not None and (gps or claim_point):
            moments.append(("camera", gps or claim_point, cam_time))   # type: ignore[arg-type]
        if claim_time is not None and (claim_point or gps):
            moments.append(("claim", claim_point or gps, claim_time))  # type: ignore[arg-type]

        rows: list[dict[str, Any]] = []
        sun_rows, weather_rows, tz_info, weather_errors = await self._moments(ctx, moments)
        await ctx.progress(55, "sun and weather worked out")
        camera_utc = next((datetime.fromisoformat(s["utc_time"].replace("Z", "+00:00"))
                           for s in sun_rows if s["label"] == "camera"), None)

        # --- sun
        if not location:
            rows.append(_row_reason(ctx, self, target, "geo-sun", NO_LOCATION))
        elif not moments:
            rows.append(_row_reason(ctx, self, target, "geo-sun", NO_TIME))
        else:
            first = sun_rows[0]
            note = (f"At {first['local_time'][11:16]} local time the sun was {first['elevation']:.0f}° "
                    f"{'above' if first['elevation'] > 0 else 'below'} the horizon in the {first['compass']}"
                    + (f": expect {shadow_words(_sun_obj(first))} pointing {first['shadow_compass']}."
                       if first.get("shadow_azimuth") is not None else "."))
            rows.append(ctx.finding(self, target, platform="geo-sun", url=None, extra={"note": note},
                                    meta={"moments": sun_rows, "method": "NOAA solar position equations"}))

        # --- weather
        if not location:
            rows.append(_row_reason(ctx, self, target, "geo-weather", NO_LOCATION))
        elif not moments:
            rows.append(_row_reason(ctx, self, target, "geo-weather", NO_TIME))
        elif weather_rows:
            w = weather_rows[0]
            note = f"{'Camera' if w['label'] == 'camera' else 'Claimed'} time: {weather_sentence(w)}."
            rows.append(ctx.finding(self, target, platform="geo-weather", url="https://open-meteo.com/",
                                    extra={"note": note},
                                    meta=clean({"moments": weather_rows, "attribution": WEATHER_ATTRIBUTION,
                                                "errors": weather_errors})))
        else:
            reason = "; ".join(weather_errors) or "no weather record for that hour"
            rows.append(_row_reason(ctx, self, target, "geo-weather", reason,
                                    status="error" if weather_errors and not any(
                                        "future" in e or "before" in e for e in weather_errors) else "not_found"))

        # --- place, street links (webcams and street images: the optional modules below)
        place: dict[str, Any] = {}
        if not location:
            for platform in ("geo-place", "geo-street"):
                rows.append(_row_reason(ctx, self, target, platform, NO_LOCATION))
        else:
            lat, lon = _r(location[0]), _r(location[1])
            try:
                place = await self._reverse(ctx, lat, lon)
            except (httpx.HTTPError, UpstreamError) as e:
                rows.append(_row_reason(ctx, self, target, "geo-place", f"place lookup failed: {_why(e)}",
                                        status="error", lat=lat, lon=lon, source=location_source))
            else:
                label = place_label(place) or f"{lat:.2f}, {lon:.2f}"
                claim_km = (round(geo_claims.haversine_km(lat, lon, *claim_point), 1)
                            if claim_point and gps else None)
                rows.append(ctx.finding(
                    self, target, platform="geo-place", url=links_for(lat, lon)["openstreetmap"],
                    extra=clean({"location": label,
                                 "note": f"{'Camera GPS' if gps else 'Claimed place'}: near {label}."}),
                    meta=clean({"lat": lat, "lon": lon, "source": location_source, "place": place,
                                "label": label, "timezone": tz_info.get("timezone"),
                                "claim_point": ({"lat": claim_point[0], "lon": claim_point[1]}
                                                if claim_point else None),
                                "claim_place": resolved or None, "claim_distance_km": claim_km,
                                "claim_lookup_error": resolve_error, "attribution": OSM_ATTRIBUTION}),
                ))
            rows.append(self._street(ctx, target, lat, lon))
        await ctx.progress(80, "places looked up")

        # --- checks (Google Lens titles, waiting briefly for the Lens job of the same search)
        lens, lens_state = await self._lens_matches(ctx, target)
        checks = geo_claims.assess_claim(
            exif, claim_full, sun_rows, weather_rows, lens, place=place or None, camera_utc=camera_utc,
            claim_place_offset=tz_info.get("claim_offset"), timezone_name=tz_info.get("timezone"),
        )
        basis = clean({
            "lat": _r(location[0]) if location else None, "lon": _r(location[1]) if location else None,
            "location_source": location_source,
            "camera_gps": {"lat": gps[0], "lon": gps[1]} if gps else None,
            "camera_time": exif.get("datetime"), "camera_offset": offset,
            "camera_utc": camera_utc.isoformat().replace("+00:00", "Z") if camera_utc else None,
            "claimed_time": claim.get("taken_at"), "timezone": tz_info.get("timezone"),
            "timezone_exact": tz_info.get("exact"), "camera": " ".join(
                x for x in (exif.get("camera_make"), exif.get("camera_model")) if x) or None,
        })
        rows.append(ctx.finding(
            self, target, platform="geo-checks",
            url=links_for(*location)["openstreetmap"] if location else None,
            extra=clean({"note": geo_claims.summarize(checks)}),
            meta=clean({"checks": [c.to_dict() for c in checks], "claim": claim or None,
                        "claim_place": resolved or None, "basis": basis, "lens": lens_state,
                        "lens_titles": len(lens), "exif_error": exif_error}),
        ))
        return rows

    # ------------------------------------------------------------------ EXIF
    async def _read_exif(self, target: Target, ctx: ModuleContext) -> tuple[dict[str, Any], str | None, str | None]:
        value = target.value.strip()
        try:
            if uploads.is_upload(value):
                _, data = await uploads.read_upload(value, max_bytes=MAX_IMAGE_BYTES)
            else:
                if not is_public_http_url(value):
                    return {}, None, "not a public http(s) image URL"
                data, _ = await fetch_capped(ctx.http, value, max_bytes=MAX_IMAGE_BYTES, timeout=20.0)
            exif, offset = await asyncio.to_thread(_exif_extras, data)
            return exif, offset, None
        except (ValueError, uploads.UploadUnavailable, UpstreamError) as e:
            return {}, None, f"could not read the photo: {e}"[:200]
        except httpx.HTTPError as e:
            return {}, None, f"could not fetch the photo: {type(e).__name__}"

    # ------------------------------------------------------------------ sun + weather
    async def _moments(self, ctx: ModuleContext, moments: list[tuple[str, tuple[float, float], datetime]]
                       ) -> tuple[list[dict], list[dict], dict[str, Any], list[str]]:
        sun_rows: list[dict] = []
        weather_rows: list[dict] = []
        errors: list[str] = []
        tz: dict[str, Any] = {}
        bodies: dict[tuple, dict | None] = {}
        for label, (lat, lon), when in moments:
            lat, lon = _r(lat), _r(lon)
            day = when.date()
            key = (lat, lon, day)
            if key not in bodies:
                try:
                    bodies[key] = await self._weather(ctx, lat, lon, day)
                except (httpx.HTTPError, UpstreamError) as e:
                    bodies[key] = None
                    errors.append(f"weather for the {label} time: {_why(e)}")
            body = bodies[key]
            name = body.get("timezone") if body else None
            offset_s = body.get("utc_offset_seconds") if body else None
            zone, exact = _zone(name if isinstance(name, str) else None,
                                offset_s if isinstance(offset_s, int) else None)
            approx = False
            if zone is None:      # no weather answer: solar time from the longitude, clearly approximate
                zone, approx = timezone(timedelta(hours=round(lon / 15))), True
            aware = when.replace(tzinfo=zone) if when.tzinfo is None else when
            utc = aware.astimezone(UTC)
            local = utc.astimezone(zone)
            if name and not tz.get("timezone"):
                tz.update(timezone=name, exact=exact)
            if label == "claim" and not approx:
                tz["claim_offset"] = geo_claims.format_offset(local.utcoffset())
            sun = solar_position(lat, lon, utc)
            sun_rows.append(clean({
                "label": label, "lat": lat, "lon": lon,
                "local_time": local.replace(tzinfo=None).isoformat(timespec="minutes"),
                "utc_offset": geo_claims.format_offset(local.utcoffset()),
                "utc_time": utc.isoformat(timespec="minutes").replace("+00:00", "Z"),
                "timezone": name, "timezone_approximate": approx or None, **sun.to_dict(),
            }))
            hour = hour_at(body, utc) if body else None
            if hour:
                weather_rows.append({"label": label, **hour})
        return sun_rows, weather_rows, tz, errors

    async def _weather(self, ctx: ModuleContext, lat: float, lon: float, day: date) -> dict[str, Any]:
        today = datetime.now(UTC).date()
        if day > today + timedelta(days=FORECAST_AHEAD_DAYS):
            raise UpstreamError("the date is in the future, past the forecast range")
        if day < date(1940, 1, 2):
            raise UpstreamError("the weather archive starts in 1940; the date is before that")
        start, end = day - timedelta(days=1), min(day + timedelta(days=1), today + timedelta(days=FORECAST_AHEAD_DAYS))
        url = OPEN_METEO_ARCHIVE if end < today - timedelta(days=ARCHIVE_LAG_DAYS) else OPEN_METEO_FORECAST
        r = await ctx.http.get(url, params={
            "latitude": lat, "longitude": lon, "start_date": start.isoformat(), "end_date": end.isoformat(),
            "hourly": ",".join(HOURLY_VARS), "timezone": "auto",
        }, headers={"User-Agent": DEFAULT_UA}, timeout=15.0)
        body = _json(r)
        if r.status_code != 200 or not isinstance(body, dict) or "hourly" not in body:
            reason = body.get("reason") if isinstance(body, dict) else None
            raise UpstreamError(str(reason or describe_http_error(r))[:200])
        body["_source"] = "archive" if url == OPEN_METEO_ARCHIVE else "forecast"
        return body

    # ------------------------------------------------------------------ places (Nominatim)
    async def _nominatim(self, ctx: ModuleContext, path: str, params: dict[str, Any]) -> Any:
        global _nominatim_last
        loop = asyncio.get_running_loop()
        lock = _nominatim_locks.get(loop)
        if lock is None:
            _nominatim_locks.clear()
            lock = _nominatim_locks[loop] = asyncio.Lock()
        async with lock:      # one request at a time per worker, at most one per second
            wait = NOMINATIM_MIN_INTERVAL_S - (time.monotonic() - _nominatim_last)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                r = await ctx.http.get(f"{NOMINATIM}/{path}", params={**params, "format": "jsonv2",
                                                                       "accept-language": "en"},
                                       headers={"User-Agent": DEFAULT_UA}, timeout=12.0)
            finally:
                _nominatim_last = time.monotonic()
        if r.status_code != 200:
            raise UpstreamError(describe_http_error(r))
        return _json(r)

    async def _reverse(self, ctx: ModuleContext, lat: float, lon: float) -> dict[str, Any]:
        key = (lat, lon)
        if key in _reverse_cache:
            return dict(_reverse_cache[key])
        body = await self._nominatim(ctx, "reverse", {"lat": lat, "lon": lon, "zoom": 14, "addressdetails": 1})
        if not isinstance(body, dict) or body.get("error"):
            place: dict[str, Any] = {}
        else:
            place = coarse_address(body.get("address"))
        if len(_reverse_cache) > 256:
            _reverse_cache.clear()
        _reverse_cache[key] = place
        return dict(place)

    async def _search_place(self, ctx: ModuleContext, text: str) -> dict[str, Any]:
        body = await self._nominatim(ctx, "search", {"q": text, "limit": 1, "addressdetails": 1})
        if not isinstance(body, list) or not body or not isinstance(body[0], dict):
            return {}
        hit = body[0]
        try:
            lat, lon = _r(float(hit["lat"])), _r(float(hit["lon"]))
        except (KeyError, TypeError, ValueError):
            return {}
        out: dict[str, Any] = {"lat": lat, "lon": lon, **coarse_address(hit.get("address"))}
        if hit.get("category") in _LANDMARK_CATEGORIES and hit.get("name"):
            out["landmark"] = str(hit["name"])[:80]
        rank = hit.get("place_rank")
        out["precise"] = isinstance(rank, int) and rank >= 25
        out["label"] = place_label(out) or text
        return out

    # ------------------------------------------------------------------ where, for the optional modules
    async def _locate(self, target: Target, ctx: ModuleContext) -> tuple[float, float] | None:
        """The (rounded) point the context is about: camera GPS, else the claimed point or place."""
        try:
            claim = geo_claims.normalize_claim(target.params.get("claim")) or {}
        except ValueError:
            claim = {}
        exif, _, _ = await self._read_exif(target, ctx)
        if isinstance(exif.get("gps_lat"), int | float) and isinstance(exif.get("gps_lon"), int | float):
            return _r(exif["gps_lat"]), _r(exif["gps_lon"])
        if claim.get("lat") is not None:
            return claim["lat"], claim["lon"]
        if claim.get("place"):
            try:
                hit = await self._search_place(ctx, claim["place"])
            except (httpx.HTTPError, UpstreamError):
                return None
            if hit.get("lat") is not None:
                return hit["lat"], hit["lon"]
        return None

    # ------------------------------------------------------------------ street-level links (keyless)
    def _street(self, ctx: ModuleContext, target: Target, lat: float, lon: float) -> dict[str, Any]:
        links = links_for(lat, lon)
        return ctx.finding(self, target, platform="geo-street", url=links["openstreetmap"],
                           extra={"note": "Open the spot on public maps and street-level imagery to compare it "
                                          "with the photo."},
                           meta={"links": links})

    # ------------------------------------------------------------------ Google Lens titles
    async def _lens_matches(self, ctx: ModuleContext, target: Target) -> tuple[list[dict[str, Any]], str]:
        """(matches, state). State: ready | none (no Lens job in this case) | pending (still running)."""
        from sherlock_core.store import get_store

        def snapshot() -> tuple[list[dict[str, Any]], bool, bool]:
            store = get_store()
            rows = [f for f in store.list_findings(ctx.case_id)
                    if f.get("module") == "reverse_image" and f.get("identifier_value") == target.value]
            found = [{"title": (f.get("extra_metadata") or {}).get("title"),
                      "source": (f.get("extra_metadata") or {}).get("source")}
                     for f in rows if f.get("status") == "found"]
            jobs = [j for j in store.list_jobs(ctx.case_id) if j.get("module") == "reverse_image"
                    and j.get("target_value") == target.value]
            running = any(j.get("status") == "running" for j in jobs)
            return found, running, bool(jobs or rows)

        try:
            deadline = time.monotonic() + LENS_WAIT_S
            found, running, ran = await asyncio.to_thread(snapshot)
            while running and not found and time.monotonic() < deadline:
                await asyncio.sleep(LENS_POLL_S)
                found, running, ran = await asyncio.to_thread(snapshot)
        except Exception as e:  # noqa: BLE001 - Lens titles are optional context
            log.info("could not read Google Lens matches: %s", type(e).__name__)
            return [], "none"
        return found, "ready" if found or (ran and not running) else "pending" if running else "none"


# ----------------------------------------------------------------------------- small helpers
def _json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except ValueError:
        return None


def _why(e: Exception) -> str:
    return str(e) if isinstance(e, UpstreamError) else type(e).__name__


def _sun_obj(row: dict[str, Any]):
    from sherlock_core.geo.solar import describe

    return describe(row["azimuth"], row["elevation"])


def _mapillary_images(body: dict[str, Any], lat: float, lon: float) -> list[dict[str, Any]]:
    out = []
    for img in body.get("data") or []:
        if not isinstance(img, dict) or not img.get("id"):
            continue
        geom = img.get("computed_geometry") if isinstance(img.get("computed_geometry"), dict) else {}
        coords = geom.get("coordinates") if isinstance(geom.get("coordinates"), list) else None
        km = None
        if coords and len(coords) == 2 and all(isinstance(c, int | float) for c in coords):
            km = round(geo_claims.haversine_km(lat, lon, coords[1], coords[0]), 2)
        captured = img.get("captured_at")
        when = (datetime.fromtimestamp(captured / 1000, UTC).date().isoformat()
                if isinstance(captured, int | float) else None)
        out.append(clean({
            "id": str(img["id"]), "thumbnail": img.get("thumb_256_url"), "captured_on": when,
            "url": f"https://www.mapillary.com/app/?pKey={img['id']}", "distance_km": km,
        }))
    out.sort(key=lambda i: i.get("distance_km", 1e9))
    return out[:MAX_STREET_IMAGES]


def _obj(v: Any) -> dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _webcam_rows(body: dict[str, Any], lat: float, lon: float) -> list[dict[str, Any]]:
    cams = []
    for w in body.get("webcams") or []:
        if not isinstance(w, dict) or w.get("status", "active") != "active":
            continue
        loc, urls = _obj(w.get("location")), _obj(w.get("urls"))
        current = _obj(_obj(w.get("images")).get("current"))
        wid = w.get("webcamId") or w.get("id")
        km = None
        if isinstance(loc.get("latitude"), int | float) and isinstance(loc.get("longitude"), int | float):
            km = round(geo_claims.haversine_km(lat, lon, loc["latitude"], loc["longitude"]), 1)
        cams.append(clean({
            "id": str(wid) if wid else None, "title": str(w.get("title") or "Webcam")[:120],
            "url": urls.get("detail") or (f"https://www.windy.com/webcams/{wid}" if wid else None),
            "thumbnail": current.get("thumbnail") or current.get("preview"),
            "city": loc.get("city"), "distance_km": km, "provider": "Windy Webcams",
        }))
    cams.sort(key=lambda c: c.get("distance_km", 1e9))
    return cams


# ----------------------------------------------------------------------------- optional modules (free keys)
@register
class GeoWebcams(GeoContext):
    """Public, operator-published webcams near the photo's place (Windy Webcams API, free key)."""
    name = "geo_webcams"
    title = "Where and when: public webcams nearby"
    description = ("Public webcams listed by Windy within 15 km of where a photo was taken or is claimed to be "
                   "from; their archives can show the light and weather at that hour.")
    requires_env = ("WINDY_WEBCAMS_KEY",)
    source_url = "https://api.windy.com/webcams/docs"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        key = os.getenv("WINDY_WEBCAMS_KEY", "").strip()
        if not key:
            raise RuntimeError("WINDY_WEBCAMS_KEY is not set")
        point = await self._locate(target, ctx)
        if point is None:
            return [_row_reason(ctx, self, target, "geo-webcams", NO_LOCATION)]
        lat, lon = point
        directory = f"https://www.windy.com/-Webcams/webcams?{lat},{lon},12"
        try:
            r = await ctx.http.get(WINDY_WEBCAMS, params={
                "nearby": f"{lat},{lon},{WEBCAM_RADIUS_KM}", "limit": MAX_WEBCAMS,
                "include": "images,urls,location",
            }, headers={"x-windy-api-key": key, "User-Agent": DEFAULT_UA}, timeout=12.0)
        except httpx.HTTPError as e:   # never echo the request (the key is a header, but stay terse)
            return [_row_reason(ctx, self, target, "geo-webcams", f"webcam lookup failed: {type(e).__name__}",
                                status="error", directory=directory)]
        body = _json(r)
        if r.status_code != 200 or not isinstance(body, dict):
            return [_row_reason(ctx, self, target, "geo-webcams", f"webcam lookup failed: {describe_http_error(r)}",
                                status="error", directory=directory)]
        cams = _webcam_rows(body, lat, lon)
        if not cams:
            return [_row_reason(ctx, self, target, "geo-webcams",
                                f"No public webcams listed within {WEBCAM_RADIUS_KM} km.", url=directory,
                                directory=directory)]
        return [ctx.finding(self, target, platform="geo-webcams", url=directory,
                            extra={"note": f"{len(cams)} public webcam{'s' if len(cams) != 1 else ''} within "
                                           f"{WEBCAM_RADIUS_KM} km. Their archives can show the weather and light "
                                           "around the claimed time."},
                            meta={"webcams": cams, "directory": directory,
                                  "attribution": "Webcams provided by windy.com"})]


@register
class GeoStreetImages(GeoContext):
    """The nearest public street-level images (Mapillary, free client token)."""
    name = "geo_street_images"
    title = "Where and when: street-level images nearby"
    description = ("The nearest public Mapillary street-level images within about 1 km of where a photo was taken "
                   "or is claimed to be from, to compare buildings, signs and skyline.")
    requires_env = ("MAPILLARY_TOKEN",)
    source_url = "https://www.mapillary.com/developer/api-documentation"
    timeout_s = 60.0

    async def run(self, target: Target, ctx: ModuleContext) -> list[dict[str, Any]]:
        token = os.getenv("MAPILLARY_TOKEN", "").strip()
        if not token:
            raise RuntimeError("MAPILLARY_TOKEN is not set")
        point = await self._locate(target, ctx)
        if point is None:
            return [_row_reason(ctx, self, target, "geo-street-images", NO_LOCATION)]
        lat, lon = point
        url = links_for(lat, lon)["mapillary"]
        try:
            r = await ctx.http.get(MAPILLARY_IMAGES, params={
                "access_token": token, "fields": "id,thumb_256_url,captured_at,computed_geometry",
                "bbox": ",".join(f"{round(v, 4):g}" for v in (lon - STREET_BOX_DEG, lat - STREET_BOX_DEG,
                                                               lon + STREET_BOX_DEG, lat + STREET_BOX_DEG)),
                "limit": 20,
            }, timeout=12.0)
        except httpx.HTTPError as e:   # never echo the request URL: it carries the token
            return [_row_reason(ctx, self, target, "geo-street-images",
                                f"Mapillary lookup failed: {type(e).__name__}", status="error")]
        body = _json(r)
        if r.status_code != 200 or not isinstance(body, dict):
            return [_row_reason(ctx, self, target, "geo-street-images",
                                f"Mapillary lookup failed: {describe_http_error(r)}", status="error")]
        images = _mapillary_images(body, lat, lon)
        if not images:
            return [_row_reason(ctx, self, target, "geo-street-images",
                                "No public street-level images within about 1 km on Mapillary.", url=url)]
        return [ctx.finding(self, target, platform="geo-street-images", url=url,
                            extra={"note": f"{len(images)} public street-level image{'s' if len(images) != 1 else ''} "
                                           "within about 1 km (Mapillary)."},
                            meta={"images": images, "attribution": "Street-level images from Mapillary (CC BY-SA)"})]


GEO_MODULES = ("geo_context", "geo_webcams", "geo_street_images")
