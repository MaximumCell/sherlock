/**
 * "Where and when": the photo location check (`geo_context` findings) gathered for the case page,
 * plus the pure geometry its graphics use (sun dial, OpenStreetMap tiles) and the claim form's
 * time handling. Places and conditions only, never people: coordinates are always rounded to two
 * decimals (about 1 km), as stored.
 */
import type { Finding, JsonObject, JsonValue, PhotoClaim } from "./types";

export const GEO_MODULE = "geo_context";

export type Verdict = "consistent" | "inconsistent" | "cant_tell";

export interface GeoCheck {
  key: string;
  verdict: Verdict;
  title: string;
  reason: string;
  lookFor: string | null;
}

export interface SunMoment {
  label: "camera" | "claim";
  lat: number;
  lon: number;
  localTime: string | null; // "2025-06-14T20:40"
  utcOffset: string | null; // "+02:00"
  timezone: string | null;
  approximate: boolean;
  azimuth: number;
  elevation: number;
  shadowAzimuth: number | null;
  shadowRatio: number | null;
  daylight: "day" | "twilight" | "night";
  compass: string;
  shadowCompass: string | null;
}

export interface WeatherMoment {
  label: "camera" | "claim";
  summary: string;
  kind: string;
  temperatureC: number | null;
  cloudCover: number | null;
  precipitationMm: number | null;
}

export type { PhotoClaim };

export interface Point {
  lat: number;
  lon: number;
}

export interface Webcam {
  id: string;
  title: string;
  url: string | null;
  thumbnail: string | null;
  distanceKm: number | null;
}

export interface StreetImage {
  id: string;
  url: string;
  thumbnail: string | null;
  capturedOn: string | null;
  distanceKm: number | null;
}

export interface GeoView {
  /** geo_context ran (any row for this photo). */
  ran: boolean;
  checks: GeoCheck[];
  summary: string | null;
  claim: PhotoClaim | null;
  /** The photo's location used for the context, and where it came from. */
  location: (Point & { source: "camera" | "claim" }) | null;
  cameraPoint: Point | null;
  claimPoint: Point | null;
  placeLabel: string | null;
  claimPlaceLabel: string | null;
  claimDistanceKm: number | null;
  timezone: string | null;
  cameraTime: string | null;
  camera: string | null;
  sun: SunMoment[];
  weather: WeatherMoment[];
  webcams: Webcam[];
  webcamsNote: string | null;
  webcamsDirectory: string | null;
  streetImages: StreetImage[];
  streetLinks: { key: string; label: string; url: string }[];
  /** Plain notes for facets that were skipped or failed ("No time to check: ..."). */
  notes: { facet: string; text: string; error: boolean }[];
  lensState: "ready" | "pending" | "none" | null;
  attributions: string[];
}

const isObj = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: JsonValue | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: JsonValue | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const httpUrl = (v: JsonValue | undefined): string | null => {
  const s = str(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
};
const imageSrc = (v: JsonValue | undefined): string | null => {
  const s = str(v);
  return s && (/^https?:\/\//i.test(s) || /^data:image\//i.test(s) || s.startsWith("/")) ? s : null;
};
const round2 = (v: number) => Math.round(v * 100) / 100;

function point(v: JsonValue | undefined): Point | null {
  if (!isObj(v)) return null;
  const lat = num(v.lat);
  const lon = num(v.lon);
  return lat === null || lon === null ? null : { lat: round2(lat), lon: round2(lon) };
}

function meta(f: Finding): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(f.extra_metadata))
    if (k !== "extra" && k !== "url" && v !== undefined) out[k] = v;
  return out;
}

function note(f: Finding): string | null {
  const extra = f.extra_metadata.extra;
  return (isObj(extra) ? str(extra.note) : null) ?? str(f.extra_metadata.reason);
}

const VERDICTS: readonly Verdict[] = ["consistent", "inconsistent", "cant_tell"];

export function parseCheck(v: JsonValue): GeoCheck | null {
  if (!isObj(v)) return null;
  const title = str(v.title);
  const reason = str(v.reason);
  if (!title || !reason) return null;
  const verdict = VERDICTS.includes(v.verdict as Verdict) ? (v.verdict as Verdict) : "cant_tell";
  return { key: str(v.key) ?? title, verdict, title, reason, lookFor: str(v.look_for) };
}

function parseSun(v: JsonValue): SunMoment | null {
  if (!isObj(v)) return null;
  const azimuth = num(v.azimuth);
  const elevation = num(v.elevation);
  const lat = num(v.lat);
  const lon = num(v.lon);
  if (azimuth === null || elevation === null || lat === null || lon === null) return null;
  const daylight = v.daylight === "night" || v.daylight === "twilight" ? v.daylight : "day";
  return {
    label: v.label === "claim" ? "claim" : "camera",
    lat: round2(lat),
    lon: round2(lon),
    localTime: str(v.local_time),
    utcOffset: str(v.utc_offset),
    timezone: str(v.timezone),
    approximate: v.timezone_approximate === true,
    azimuth,
    elevation,
    shadowAzimuth: num(v.shadow_azimuth),
    shadowRatio: num(v.shadow_ratio),
    daylight,
    compass: str(v.compass) ?? "",
    shadowCompass: str(v.shadow_compass),
  };
}

function parseWeather(v: JsonValue): WeatherMoment | null {
  if (!isObj(v)) return null;
  return {
    label: v.label === "claim" ? "claim" : "camera",
    summary: str(v.summary) ?? "unknown weather",
    kind: str(v.kind) ?? "unknown",
    temperatureC: num(v.temperature_c),
    cloudCover: num(v.cloud_cover),
    precipitationMm: num(v.precipitation_mm),
  };
}

function parseClaim(v: JsonValue | undefined): PhotoClaim | null {
  if (!isObj(v)) return null;
  const out: PhotoClaim = {};
  const place = str(v.place);
  if (place) out.place = place;
  const lat = num(v.lat);
  const lon = num(v.lon);
  if (lat !== null && lon !== null) {
    out.lat = round2(lat);
    out.lon = round2(lon);
  }
  const taken = str(v.taken_at);
  if (taken) out.taken_at = taken;
  return Object.keys(out).length ? out : null;
}

const STREET_LABELS: Record<string, string> = {
  openstreetmap: "OpenStreetMap",
  google_maps: "Google Maps",
  google_street_view: "Street View",
  mapillary: "Mapillary",
};

/** True for rows of the location check: context about a photo, never an account. */
export const isGeoFinding = (f: Pick<Finding, "module">) => f.module === GEO_MODULE;

/** Everything the "Where and when" section shows for one photo (`value` is its target value). */
export function geoView(findings: readonly Finding[], value: string): GeoView {
  const mine = findings.filter((f) => isGeoFinding(f) && f.identifier_value === value);
  const row = (platform: string) => mine.find((f) => f.platform === platform);
  const found = (platform: string) => {
    const f = row(platform);
    return f && f.status === "found" ? meta(f) : null;
  };
  const notes: GeoView["notes"] = [];
  for (const [platform, facet] of [
    ["geo-sun", "Sun"],
    ["geo-weather", "Weather"],
    ["geo-place", "Place"],
  ] as const) {
    const f = row(platform);
    const text = f && f.status !== "found" ? note(f) : null;
    if (text && !notes.some((n) => n.text === text))
      notes.push({ facet, text, error: f?.status === "error" });
  }

  const checksRow = row("geo-checks");
  const cm = checksRow ? meta(checksRow) : {};
  const basis = isObj(cm.basis) ? cm.basis : {};
  const place = found("geo-place");
  const sunMeta = found("geo-sun");
  const weatherMeta = found("geo-weather");
  const cams = found("geo-webcams");
  const camsRow = row("geo-webcams");
  const street = found("geo-street");

  const lat = num(basis.lat) ?? num(place?.lat);
  const lon = num(basis.lon) ?? num(place?.lon);
  const source = (str(basis.location_source) ?? str(place?.source)) === "claim" ? "claim" : "camera";
  const claimPlace = isObj(cm.claim_place) ? cm.claim_place : isObj(place?.claim_place) ? place.claim_place : null;
  const claim = parseClaim(cm.claim);
  const claimPoint =
    (claim?.lat !== undefined && claim.lon !== undefined ? { lat: claim.lat, lon: claim.lon } : null) ??
    point(claimPlace ?? undefined) ??
    point(place?.claim_point);

  const camsMeta = cams ?? (camsRow ? meta(camsRow) : null);
  return {
    ran: mine.length > 0,
    checks: (Array.isArray(cm.checks) ? cm.checks : []).flatMap((c) => parseCheck(c) ?? []),
    summary: checksRow ? note(checksRow) : null,
    claim,
    location: lat !== null && lon !== null ? { lat: round2(lat), lon: round2(lon), source } : null,
    cameraPoint: point(basis.camera_gps),
    claimPoint,
    placeLabel: str(place?.label),
    claimPlaceLabel: claimPlace ? str(claimPlace.label) : null,
    claimDistanceKm: num(place?.claim_distance_km),
    timezone: str(basis.timezone) ?? str(place?.timezone),
    cameraTime: str(basis.camera_time),
    camera: str(basis.camera),
    sun: (Array.isArray(sunMeta?.moments) ? sunMeta.moments : []).flatMap((m) => parseSun(m) ?? []),
    weather: (Array.isArray(weatherMeta?.moments) ? weatherMeta.moments : []).flatMap(
      (m) => parseWeather(m) ?? [],
    ),
    webcams: (Array.isArray(cams?.webcams) ? cams.webcams : []).flatMap((w) => {
      if (!isObj(w)) return [];
      return [
        {
          id: str(w.id) ?? str(w.title) ?? "webcam",
          title: str(w.title) ?? "Webcam",
          url: httpUrl(w.url),
          thumbnail: imageSrc(w.thumbnail),
          distanceKm: num(w.distance_km),
        },
      ];
    }),
    webcamsNote: camsRow ? note(camsRow) : null,
    webcamsDirectory: camsMeta ? httpUrl(camsMeta.directory) : null,
    streetImages: (Array.isArray(street?.images) ? street.images : []).flatMap((i) => {
      if (!isObj(i)) return [];
      const url = httpUrl(i.url);
      return url
        ? [
            {
              id: str(i.id) ?? url,
              url,
              thumbnail: imageSrc(i.thumbnail),
              capturedOn: str(i.captured_on),
              distanceKm: num(i.distance_km),
            },
          ]
        : [];
    }),
    streetLinks: Object.entries(isObj(street?.links) ? street.links : {}).flatMap(([key, v]) => {
      const url = httpUrl(v);
      return url ? [{ key, label: STREET_LABELS[key] ?? key, url }] : [];
    }),
    notes,
    lensState:
      cm.lens === "ready" || cm.lens === "pending" || cm.lens === "none" ? cm.lens : null,
    attributions: [str(place?.attribution), str(weatherMeta?.attribution), str(cams?.attribution)].filter(
      (a): a is string => a !== null,
    ),
  };
}

// ------------------------------------------------------------------ verdicts
export const VERDICT_META: Record<Verdict, { label: string; tone: "success" | "danger" | "muted" }> = {
  consistent: { label: "Consistent", tone: "success" },
  inconsistent: { label: "Inconsistent", tone: "danger" },
  cant_tell: { label: "Can't tell", tone: "muted" },
};

/** Inconsistent first (they need attention), then the ones to look at, then the consistent ones. */
export function sortChecks(checks: readonly GeoCheck[]): GeoCheck[] {
  const order: Record<Verdict, number> = { inconsistent: 0, cant_tell: 1, consistent: 2 };
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => order[a.c.verdict] - order[b.c.verdict] || a.i - b.i)
    .map(({ c }) => c);
}

export function verdictCounts(checks: readonly GeoCheck[]): Record<Verdict, number> {
  const out: Record<Verdict, number> = { consistent: 0, inconsistent: 0, cant_tell: 0 };
  for (const c of checks) out[c.verdict] += 1;
  return out;
}

// ------------------------------------------------------------------ sun dial geometry
/**
 * Polar position on a dial of radius `r` centred at (cx, cy): north up, azimuth clockwise,
 * the horizon on the rim and the zenith in the centre. Below the horizon stays on the rim.
 */
export function dialPoint(
  azimuth: number,
  elevation: number,
  r: number,
  cx = 0,
  cy = 0,
): { x: number; y: number } {
  const dist = r * (1 - Math.max(0, Math.min(90, elevation)) / 90);
  const a = (azimuth * Math.PI) / 180;
  return { x: round3(cx + dist * Math.sin(a)), y: round3(cy - dist * Math.cos(a)) };
}

/**
 * The shadow of a vertical pole standing at the dial centre: away from the sun, its length
 * proportional to 1 / tan(elevation), capped at `maxLen` so a low sun stays on the dial.
 * Null when the sun is down.
 */
export function shadowSegment(
  sun: Pick<SunMoment, "elevation" | "shadowAzimuth" | "shadowRatio" | "azimuth">,
  unit: number,
  maxLen: number,
  cx = 0,
  cy = 0,
): { x: number; y: number; length: number; capped: boolean } | null {
  if (sun.elevation <= 0) return null;
  const ratio = sun.shadowRatio ?? 1 / Math.tan((sun.elevation * Math.PI) / 180);
  const az = sun.shadowAzimuth ?? (sun.azimuth + 180) % 360;
  const raw = ratio * unit;
  const length = Math.min(raw, maxLen);
  const a = (az * Math.PI) / 180;
  return {
    x: round3(cx + length * Math.sin(a)),
    y: round3(cy - length * Math.cos(a)),
    length: round3(length),
    capped: raw > maxLen,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function sunSentence(s: SunMoment): string {
  const at = s.localTime ? `${s.localTime.slice(11, 16)} local time` : "that time";
  if (s.daylight === "night") return `At ${at} the sun was ${Math.abs(Math.round(s.elevation))}° below the horizon: night.`;
  if (s.daylight === "twilight") return `At ${at} the sun had just set or not yet risen: twilight, no direct shadows.`;
  const ratio = s.shadowRatio ?? 0;
  const times = ratio >= 10 ? ratio.toFixed(0) : ratio.toFixed(1);
  return `At ${at} the sun was ${Math.round(s.elevation)}° up in the ${s.compass}; shadows point ${s.shadowCompass} and are about ${times}× as long as the object is tall.`;
}

// ------------------------------------------------------------------ OpenStreetMap tiles
export const TILE_SIZE = 256;
export const MIN_ZOOM = 2;
export const MAX_ZOOM = 17;

/** Web Mercator world pixel of a point at `zoom`. */
export function project(p: Point, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-85.0511, Math.min(85.0511, p.lat));
  const s = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((p.lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** Inverse of `project`, rounded to two decimals like everything stored. */
export function unproject(x: number, y: number, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { lat: round2(Math.max(-85, Math.min(85, lat))), lon: round2(((((lon + 180) % 360) + 360) % 360) - 180) };
}

export interface Tile {
  key: string;
  x: number; // tile column (wrapped)
  y: number;
  z: number;
  left: number; // pixel position inside the viewport
  top: number;
}

/** Tiles covering a `width` × `height` viewport centred on `center`. */
export function visibleTiles(center: Point, zoom: number, width: number, height: number): Tile[] {
  const c = project(center, zoom);
  const x0 = c.x - width / 2;
  const y0 = c.y - height / 2;
  const n = 2 ** zoom;
  const tiles: Tile[] = [];
  for (let ty = Math.floor(y0 / TILE_SIZE); ty <= Math.floor((y0 + height) / TILE_SIZE); ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(x0 / TILE_SIZE); tx <= Math.floor((x0 + width) / TILE_SIZE); tx++) {
      const wrapped = ((tx % n) + n) % n;
      tiles.push({
        key: `${zoom}/${tx}/${ty}`,
        x: wrapped,
        y: ty,
        z: zoom,
        left: Math.round(tx * TILE_SIZE - x0),
        top: Math.round(ty * TILE_SIZE - y0),
      });
    }
  }
  return tiles;
}

export const tileUrl = (t: Pick<Tile, "x" | "y" | "z">) =>
  `https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;

/** Pixel offset of `p` inside a viewport centred on `center`. */
export function pointInView(p: Point, center: Point, zoom: number, width: number, height: number) {
  const a = project(p, zoom);
  const c = project(center, zoom);
  return { x: Math.round(a.x - c.x + width / 2), y: Math.round(a.y - c.y + height / 2) };
}

/** A zoom that fits every point (with padding) in the viewport, between MIN_ZOOM and 15. */
export function fitZoom(points: readonly Point[], width: number, height: number, pad = 48): number {
  if (points.length < 2) return 14;
  for (let z = 15; z > MIN_ZOOM; z--) {
    const ps = points.map((p) => project(p, z));
    const w = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    const h = Math.max(...ps.map((p) => p.y)) - Math.min(...ps.map((p) => p.y));
    if (w <= width - pad * 2 && h <= height - pad * 2) return z;
  }
  return MIN_ZOOM;
}

export function centerOf(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lon: points.reduce((s, p) => s + p.lon, 0) / points.length,
  };
}

// ------------------------------------------------------------------ claim form
/** Offsets offered in the form, -12:00 … +14:00 in quarter hours that exist somewhere. */
export const UTC_OFFSETS: string[] = (() => {
  const out: string[] = [];
  for (let m = -12 * 60; m <= 14 * 60; m += 15) {
    if (m % 60 === 0 || [-570, -210, 210, 270, 330, 345, 390, 525, 570, 630, 765].includes(m))
      out.push(formatOffset(m));
  }
  return out;
})();

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** The browser's own offset for a local date-time, as "+02:00" (a sensible default). */
export function browserOffset(localDateTime?: string): string {
  const d = localDateTime ? new Date(localDateTime) : new Date();
  return formatOffset(-(Number.isNaN(d.getTime()) ? new Date() : d).getTimezoneOffset());
}

/** "2025-06-14T20:40" + "+02:00" -> "2025-06-14T20:40:00+02:00"; null when incomplete or invalid. */
export function claimTime(localDateTime: string, offset: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime.trim());
  if (!m || !/^[+-]\d{2}:\d{2}$/.test(offset)) return null;
  const iso = `${localDateTime.trim()}:00${offset}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Split a stored ISO time with offset back into the form's two fields. */
export function splitClaimTime(iso: string | undefined): { local: string; offset: string } | null {
  const m = iso ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.exec(iso) : null;
  if (!m || !m[1] || !m[2]) return null;
  return { local: m[1], offset: m[2] === "Z" ? "+00:00" : m[2] };
}

export interface ClaimDraft {
  place: string;
  point: Point | null;
  local: string;
  offset: string;
}

/** The request body for a draft; errors are plain sentences for the form. */
export function buildClaim(d: ClaimDraft): { claim: PhotoClaim | null; error: string | null } {
  const claim: PhotoClaim = {};
  const place = d.place.trim().replace(/\s+/g, " ");
  if (place.length > 120) return { claim: null, error: "Keep the place under 120 characters." };
  if (place) claim.place = place;
  if (d.point) {
    claim.lat = round2(d.point.lat);
    claim.lon = round2(d.point.lon);
  }
  if (d.local.trim()) {
    const t = claimTime(d.local, d.offset);
    if (!t) return { claim: null, error: "Enter a full date and time." };
    if (Date.parse(t) > Date.now() + 86_400_000)
      return { claim: null, error: "The date is in the future." };
    claim.taken_at = t;
  }
  return { claim: Object.keys(claim).length ? claim : null, error: null };
}

export function formatClaimTime(iso: string | undefined): string | null {
  const parts = splitClaimTime(iso);
  if (!parts) return null;
  const [date, time] = parts.local.split("T");
  return `${date} ${time} (UTC${parts.offset})`;
}

/** A place search result for the claim form. */
export interface PlaceHit {
  id: string;
  label: string;
  detail: string | null;
  lat: number;
  lon: number;
}
