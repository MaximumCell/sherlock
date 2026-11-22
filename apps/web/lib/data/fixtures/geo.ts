/**
 * Demo data for "Where and when" (the `geo_context` location check), fully offline.
 *
 * A fictional but realistic example: an illustrative evening picture of a public landmark (the
 * Eiffel Tower, Paris; never a photo of a person) whose camera data says 2025-06-14 20:40 at
 * 48.86, 2.29, checked against a claim that it was taken that morning. Re-checks in the demo
 * recompute the sun with the same NOAA equations as the Python module (simplified port) and use
 * canned weather; the real checks come from `sherlock_core.geo.claims.assess_claim`.
 */
import type { Finding, Job, JsonObject, PhotoClaim } from "../../types";

export const PHOTO_CASE_ID = "c0ffee00-0000-4000-8000-000000000006";
export const GEO_PHOTO_URL = "https://photos.sherlock-demo.example/landmark-evening.jpg";
/** Illustrative stand-in for the demo photo (abstract drawing, bundled in /public). */
export const GEO_PHOTO_ASSET = "/demo/where-when-landmark.svg";
export const DEMO_CLAIM: PhotoClaim = {
  place: "Eiffel Tower, Paris",
  taken_at: "2025-06-14T08:30:00+02:00",
};

interface Camera {
  lat: number;
  lon: number;
  local: string; // "2025-06-14T20:40"
  exif: string; // "2025:06:14 20:40:00"
  make: string;
}
const DEMO_CAMERA: Camera = {
  lat: 48.86,
  lon: 2.29,
  local: "2025-06-14T20:40",
  exif: "2025:06:14 20:40:00",
  make: "ExampleCam Model X",
};

/** Places the demo knows (the place search and the free-text claim use them). */
export const DEMO_PLACES = [
  {
    id: "p1",
    label: "Eiffel Tower",
    detail: "Paris, France",
    lat: 48.86,
    lon: 2.29,
    landmark: true,
  },
  {
    id: "p2",
    label: "Paris",
    detail: "Île-de-France, France",
    lat: 48.85,
    lon: 2.35,
    landmark: false,
  },
  {
    id: "p3",
    label: "Lyon",
    detail: "Auvergne-Rhône-Alpes, France",
    lat: 45.76,
    lon: 4.84,
    landmark: false,
  },
  {
    id: "p4",
    label: "London",
    detail: "England, United Kingdom",
    lat: 51.51,
    lon: -0.13,
    landmark: false,
  },
  {
    id: "p5",
    label: "Brussels",
    detail: "Brussels Capital, Belgium",
    lat: 50.85,
    lon: 4.35,
    landmark: false,
  },
  {
    id: "p6",
    label: "Marseille",
    detail: "Provence-Alpes-Côte d'Azur, France",
    lat: 43.3,
    lon: 5.37,
    landmark: false,
  },
];

const r2 = (v: number) => Math.round(v * 100) / 100;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const COMPASS = [
  "N",
  "NNE",
  "NE",
  "ENE",
  "E",
  "ESE",
  "SE",
  "SSE",
  "S",
  "SSW",
  "SW",
  "WSW",
  "W",
  "WNW",
  "NW",
  "NNW",
];
const compass = (a: number) =>
  COMPASS[Math.floor(((((a % 360) + 360) % 360) + 11.25) / 22.5) % 16]!;

/** NOAA solar position (port of sherlock_core.geo.solar, refraction left out below -0.575°). */
export function demoSun(lat: number, lon: number, utc: Date) {
  const jd = utc.getTime() / 86_400_000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = rad(357.52911 + t * (35999.05029 - 0.0001537 * t));
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289;
  const omega = rad(125.04 - 1934.136 * t);
  const app = rad(l0 + c - 0.00569 - 0.00478 * Math.sin(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = rad(eps0 + 0.00256 * Math.cos(omega));
  const decl = Math.asin(Math.sin(eps) * Math.sin(app));
  const y = Math.tan(eps / 2) ** 2;
  const l0r = rad(l0);
  const eot =
    4 *
    deg(
      y * Math.sin(2 * l0r) -
        2 * e * Math.sin(m) +
        4 * e * y * Math.sin(m) * Math.cos(2 * l0r) -
        0.5 * y * y * Math.sin(4 * l0r) -
        1.25 * e * e * Math.sin(2 * m),
    );
  const minutes = utc.getUTCHours() * 60 + utc.getUTCMinutes() + utc.getUTCSeconds() / 60;
  const tst = (((minutes + eot + 4 * lon) % 1440) + 1440) % 1440;
  const ha = rad(tst / 4 - 180);
  const latr = rad(lat);
  const cosZ = Math.sin(latr) * Math.sin(decl) + Math.cos(latr) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const geometric = 90 - deg(zen);
  const cosAz =
    (Math.sin(latr) * Math.cos(zen) - Math.sin(decl)) / (Math.cos(latr) * Math.sin(zen));
  const a = deg(Math.acos(Math.max(-1, Math.min(1, cosAz))));
  const azimuth = tst / 4 - 180 > 0 ? (a + 180) % 360 : (540 - a) % 360;
  const te = Math.tan(rad(geometric));
  const refr =
    geometric > 85
      ? 0
      : geometric > 5
        ? (58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5) / 3600
        : geometric > -0.575
          ? (1735 +
              geometric *
                (-518.2 + geometric * (103.4 + geometric * (-12.79 + geometric * 0.711)))) /
            3600
          : 0;
  const elevation = Math.round((geometric + refr) * 100) / 100;
  const az = Math.round(azimuth * 100) / 100;
  const up = elevation > 0;
  const shadowAz = up ? Math.round(((az + 180) % 360) * 100) / 100 : null;
  return {
    azimuth: az,
    elevation,
    shadow_azimuth: shadowAz,
    shadow_ratio: up ? Math.round(Math.min(50, 1 / Math.tan(rad(elevation))) * 100) / 100 : null,
    daylight: up ? "day" : elevation > -6 ? "twilight" : "night",
    compass: compass(az),
    shadow_compass: shadowAz === null ? null : compass(shadowAz),
  };
}

/** Central European offset at a UTC instant (EU rule: summer time from the last Sunday of March). */
function parisOffsetMinutes(utc: Date): number {
  const y = utc.getUTCFullYear();
  const lastSunday = (month: number) => {
    const d = new Date(Date.UTC(y, month + 1, 0, 1));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime();
  };
  const t = utc.getTime();
  return t >= lastSunday(2) && t < lastSunday(9) ? 120 : 60;
}

const offsetText = (m: number) =>
  `${m < 0 ? "-" : "+"}${String(Math.floor(Math.abs(m) / 60)).padStart(2, "0")}:${String(Math.abs(m) % 60).padStart(2, "0")}`;

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const h =
    Math.sin((p2 - p1) / 2) ** 2 +
    Math.cos(p1) * Math.cos(p2) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function cannedWeather(localHour: number, month: number) {
  const summer = month >= 5 && month <= 8;
  if (localHour >= 6 && localHour < 11)
    return {
      summary: "light rain",
      kind: "wet",
      temperature_c: summer ? 17.2 : 6.1,
      cloud_cover: 96,
      precipitation_mm: 0.8,
    };
  if (localHour >= 11 && localHour < 17)
    return {
      summary: "partly cloudy",
      kind: "cloudy",
      temperature_c: summer ? 23.5 : 9.4,
      cloud_cover: 48,
      precipitation_mm: 0,
    };
  return {
    summary: "clear sky",
    kind: "clear",
    temperature_c: summer ? 24.2 : 4.3,
    cloud_cover: 4,
    precipitation_mm: 0,
  };
}

function resolvePlace(text: string | undefined) {
  if (!text) return null;
  const t = text.toLowerCase();
  return DEMO_PLACES.find((p) => t.includes(p.label.toLowerCase())) ?? null;
}

function coarsePlace(p: { lat: number; lon: number }): Record<string, string> {
  const paris = haversineKm(p, { lat: 48.86, lon: 2.34 }) < 15;
  if (paris)
    return {
      district: "16th Arrondissement",
      city: "Paris",
      state: "Ile-de-France",
      country: "France",
      country_code: "FR",
    };
  const near = [...DEMO_PLACES].sort((a, b) => haversineKm(p, a) - haversineKm(p, b))[0]!;
  return haversineKm(p, near) < 40
    ? { city: near.label, country: near.detail?.split(", ").pop() ?? "" }
    : { country: "Demo region" };
}

const label = (pl: Record<string, string | undefined>) =>
  [pl.landmark, pl.district, pl.city, pl.country]
    .filter((x, i, all) => x && all.indexOf(x) === i)
    .join(", ");

const LENS_TITLES = [
  "Evening light on the Eiffel Tower – travel photo diary",
  "Paris in June: the tower from the Trocadéro",
  "Wallpaper: city skyline at dusk",
];

function check(
  key: string,
  verdict: string,
  title: string,
  reason: string,
  look_for: string | null = null,
): JsonObject {
  return { key, verdict, title, reason, ...(look_for ? { look_for } : {}) };
}

/**
 * The six `geo_context` rows for one photo. `camera` is the photo's EXIF (null: none), the claim
 * as the gateway stores it. Ids are stable per photo, so a re-check replaces the rows.
 */
export function geoFindings(
  caseId: string,
  value: string,
  claim: PhotoClaim | null,
  now: number,
  opts: { camera?: boolean; lens?: boolean; jobId?: string | null } = {},
): Finding[] {
  const cam = opts.camera ? DEMO_CAMERA : null;
  const resolved = claim?.place && claim.lat === undefined ? resolvePlace(claim.place) : null;
  const claimPoint =
    claim?.lat !== undefined && claim.lon !== undefined
      ? { lat: r2(claim.lat), lon: r2(claim.lon) }
      : resolved
        ? { lat: resolved.lat, lon: resolved.lon }
        : null;
  const gps = cam ? { lat: cam.lat, lon: cam.lon } : null;
  const location = gps ?? claimPoint;
  const source = gps ? "camera" : claimPoint ? "claim" : null;

  const moments: { label: "camera" | "claim"; at: { lat: number; lon: number }; utc: Date }[] = [];
  if (cam && location) {
    const naive = new Date(`${cam.local}:00Z`);
    moments.push({
      label: "camera",
      at: location,
      utc: new Date(naive.getTime() - parisOffsetMinutes(naive) * 60_000),
    });
  }
  if (claim?.taken_at && location)
    moments.push({ label: "claim", at: claimPoint ?? location, utc: new Date(claim.taken_at) });

  const sun = moments.map((m) => {
    const offset = parisOffsetMinutes(m.utc);
    const local = new Date(m.utc.getTime() + offset * 60_000).toISOString().slice(0, 16);
    return {
      label: m.label,
      lat: m.at.lat,
      lon: m.at.lon,
      local_time: local,
      utc_offset: offsetText(offset),
      utc_time: `${m.utc.toISOString().slice(0, 16)}Z`,
      timezone: "Europe/Paris",
      ...demoSun(m.at.lat, m.at.lon, m.utc),
    };
  });
  const weather = sun.map((s) => ({
    label: s.label,
    ...cannedWeather(Number(s.local_time.slice(11, 13)), Number(s.local_time.slice(5, 7))),
  }));

  // checks (a short demo version of assess_claim)
  const checks: JsonObject[] = [];
  if (!cam) {
    checks.push(
      check(
        "camera_metadata",
        "cant_tell",
        "No camera time or location in the file",
        "The photo carries no camera time or GPS. That is normal: most sites and messaging apps strip it. It says nothing for or against the claim.",
        "Rely on what the picture itself shows: signs, landmarks, shadows, weather, vegetation.",
      ),
    );
  }
  const claimLabel =
    claim?.place ??
    (claimPoint ? `${claimPoint.lat.toFixed(2)}, ${claimPoint.lon.toFixed(2)}` : null);
  if (claimPoint && gps) {
    const km = haversineKm(gps, claimPoint);
    const near = claim?.lat !== undefined || resolved?.landmark ? 3 : 25;
    const words = km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString("en")} km`;
    checks.push(
      km <= near
        ? check(
            "location_distance",
            "consistent",
            `Camera GPS is ${words} from the claimed place`,
            `The location saved by the camera is within ${near} km of ${claimLabel} (both are rounded to about 1 km).`,
            "Check that the landmarks, signs and terrain in the photo fit that place.",
          )
        : km <= near * 4
          ? check(
              "location_distance",
              "cant_tell",
              `Camera GPS is ${words} from the claimed place`,
              `Close to ${claimLabel}, but further than a precise match.`,
              "Look for something in the photo that pins the exact spot: a street sign, a building, a view.",
            )
          : check(
              "location_distance",
              "inconsistent",
              `Camera GPS is ${words} from the claimed place`,
              `The camera recorded a location far from ${claimLabel}. Either the claim is wrong, the photo was re-saved on another device, or the GPS data was changed.`,
              "Compare what the photo shows with both places; search for the scene near the camera location.",
            ),
    );
  } else if (claimPoint) {
    checks.push(
      check(
        "location_distance",
        "cant_tell",
        "No camera GPS to compare with the claimed place",
        `The file has no GPS data, so nothing in it confirms or contradicts ${claimLabel}.`,
        "Compare the photo with street-level imagery of the claimed place (links below).",
      ),
    );
  }
  const camSun = sun.find((s) => s.label === "camera");
  const claimSun = sun.find((s) => s.label === "claim");
  if (camSun && claim?.taken_at) {
    const minutes =
      (Date.parse(claim.taken_at) - Date.parse(camSun.utc_time.replace("Z", ":00Z"))) / 60_000;
    const words =
      Math.abs(minutes) < 90
        ? `${Math.round(Math.abs(minutes))} minutes`
        : `${(Math.abs(minutes) / 60).toFixed(1).replace(".0", "")} hours`;
    const camLocal = camSun.local_time.replace("T", " ");
    checks.push(
      Math.abs(minutes) <= 15
        ? check(
            "time_difference",
            "consistent",
            "Camera time matches the claimed time",
            `The camera clock says ${camLocal} local time, within 15 minutes of the claim.`,
            "Camera clocks can be set to anything, so also check the light and shadows.",
          )
        : Math.abs(minutes) <= 180
          ? check(
              "time_difference",
              "cant_tell",
              `Camera time is ${words} from the claim`,
              `The camera clock says ${camLocal} local time. Clocks are often off by an hour or two, so this neither confirms nor contradicts the claim.`,
              "Compare the sun's direction and the shadow length for both times (see the sun dial).",
            )
          : check(
              "time_difference",
              "inconsistent",
              `Camera time is ${words} from the claim`,
              `The camera clock says ${camLocal} local time. A wrong camera clock can explain this, but it does not fit the claimed time.`,
              "Check whether the light, shadows and weather fit the camera time or the claimed time.",
            ),
    );
  }
  if (claimSun && claim?.taken_at) {
    const given = claim.taken_at.slice(-6).replace("Z", "+00:00");
    checks.push(
      given === claimSun.utc_offset
        ? check(
            "time_zone",
            "consistent",
            `Time zone ${given} is local time there`,
            `On that date the local time at the claimed place is UTC${claimSun.utc_offset} (Europe/Paris).`,
          )
        : check(
            "time_zone",
            "inconsistent",
            `Time zone ${given} is not local time there`,
            `On that date the local time at the claimed place is UTC${claimSun.utc_offset} (Europe/Paris), not UTC${given}.`,
            "Make sure which local time the claim means before comparing the light.",
          ),
    );
  }
  for (const s of sun) {
    const who = s.label === "camera" ? "camera time" : "claimed time";
    const at = s.local_time.slice(11, 16);
    if (s.daylight === "day") {
      const ratio = s.shadow_ratio ?? 0;
      const size =
        ratio >= 4 ? "very long" : ratio >= 1.5 ? "long" : ratio >= 0.7 ? "medium" : "short";
      checks.push(
        check(
          `sun_${s.label}`,
          "cant_tell",
          `Sun ${Math.round(s.elevation)}° above the horizon at the ${who}`,
          `At the ${who} (${at} local) the sun stood in the ${s.compass} (azimuth ${Math.round(s.azimuth)}°), ${Math.round(s.elevation)}° above the horizon: expect ${size} shadows (about ${ratio.toFixed(1)} times the height of the object).`,
          `Shadows of upright things (poles, people, walls) should point ${s.shadow_compass} (about ${Math.round(s.shadow_azimuth ?? 0)}° from north). If they point another way, or the light is from the wrong side of a known landmark, the time or place is off.`,
        ),
      );
    } else {
      checks.push(
        check(
          `sun_${s.label}`,
          "cant_tell",
          s.daylight === "night" ? `Dark at the ${who}` : `Twilight at the ${who}`,
          `At the ${who} (${at} local) the sun was ${Math.abs(Math.round(s.elevation))}° below the horizon.`,
          "A photo in daylight does not fit this time; artificial light, a dark sky and lit windows do.",
        ),
      );
    }
  }
  for (const w of weather) {
    const who = w.label === "camera" ? "camera time" : "claimed time";
    const temp = `, ${Math.round(w.temperature_c)} °C`;
    if (w.kind === "wet")
      checks.push(
        check(
          `weather_${w.label}`,
          "cant_tell",
          `Rain at the ${who}`,
          `The weather record for that hour says ${w.summary}${temp}, ${w.precipitation_mm} mm of rain.`,
          "Check whether the photo shows wet ground, puddles, umbrellas, raindrops or a grey sky.",
        ),
      );
    else if (w.kind === "clear")
      checks.push(
        check(
          `weather_${w.label}`,
          "cant_tell",
          `Clear sky at the ${who}`,
          `The weather record for that hour says ${w.summary}${temp}.`,
          "A sunny photo with hard shadows fits; a heavily overcast or rainy scene does not.",
        ),
      );
    else
      checks.push(
        check(
          `weather_${w.label}`,
          "cant_tell",
          `Partly cloudy at the ${who}`,
          `The weather record for that hour says ${w.summary}${temp}, ${w.cloud_cover}% cloud cover.`,
          "Expect soft light and weak or no shadows when it was overcast.",
        ),
      );
  }
  const phrases = (claim?.place ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  if (phrases.length) {
    if (!opts.lens) {
      checks.push(
        check(
          "lens_place",
          "cant_tell",
          "No Google Lens matches to compare",
          "Reverse image search found no pages with this picture yet (or it is not set up on this server).",
          "Try the manual reverse image search links; an older copy of the photo can show where it really comes from.",
        ),
      );
    } else {
      const hits = phrases.filter((p) =>
        LENS_TITLES.some((t) => t.toLowerCase().includes(p.toLowerCase())),
      );
      checks.push(
        hits.length
          ? check(
              "lens_place",
              "consistent",
              `Google Lens titles mention ${hits.join(", ")}`,
              `${LENS_TITLES.filter((t) => t.toLowerCase().includes(hits[0]!.toLowerCase())).length} of ${LENS_TITLES.length} pages showing this picture mention ${hits.join(", ")}, consistent with the claimed place.`,
              "Open the earliest of those pages: an older copy may show the original context and date.",
            )
          : check(
              "lens_place",
              "cant_tell",
              "Google Lens titles do not mention the claimed place",
              `None of the ${LENS_TITLES.length} page titles showing this picture mention ${phrases.join(", ")}. Titles are often vague, so this is not a contradiction.`,
              "Read the matching pages: if they place the same picture somewhere else, the claim is doubtful.",
            ),
      );
    }
  }
  const counts = { consistent: 0, inconsistent: 0, cant_tell: 0 } as Record<string, number>;
  checks.forEach((c) => (counts[c.verdict as string] = (counts[c.verdict as string] ?? 0) + 1));
  const summary = [
    counts.consistent ? `${counts.consistent} consistent` : "",
    counts.inconsistent ? `${counts.inconsistent} inconsistent` : "",
    counts.cant_tell ? `${counts.cant_tell} to look at` : "",
  ]
    .filter(Boolean)
    .join(", ");

  const noLoc =
    "No location to check: the photo has no camera GPS and no claimed place was given. Add the place the photo is said to show.";
  const noTime =
    "No time to check: the photo has no camera time and no claimed time was given. Add the date and time the photo is said to be from.";
  const place = location ? coarsePlace(location) : null;
  const claimPlace = resolved
    ? {
        lat: resolved.lat,
        lon: resolved.lon,
        ...(resolved.landmark ? { landmark: resolved.label } : {}),
        city: resolved.landmark ? "Paris" : resolved.label,
        label: resolved.landmark
          ? `${resolved.label}, 7th Arrondissement, Paris, France`
          : `${resolved.label}, ${resolved.detail}`,
        precise: resolved.landmark,
      }
    : null;
  const lat = location ? r2(location.lat) : 0;
  const lon = location ? r2(location.lon) : 0;
  const links = {
    openstreetmap: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`,
    google_maps: `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`,
    google_street_view: `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`,
    mapillary: `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=16`,
  };

  const rows: {
    platform: string;
    status: Finding["status"];
    url: string | null;
    extra: JsonObject;
    meta: JsonObject;
  }[] = [];
  const skipped = (platform: string, text: string, meta: JsonObject = {}) =>
    rows.push({
      platform,
      status: "not_found",
      url: null,
      extra: { note: text },
      meta: { reason: text, ...meta },
    });
  if (!location) {
    ["geo-sun", "geo-weather", "geo-place", "geo-webcams", "geo-street"].forEach((p) =>
      skipped(p, noLoc),
    );
  } else {
    if (!sun.length) {
      skipped("geo-sun", noTime);
      skipped("geo-weather", noTime);
    } else {
      const f = sun[0]!;
      rows.push({
        platform: "geo-sun",
        status: "found",
        url: null,
        extra: {
          note: `At ${f.local_time.slice(11, 16)} local time the sun was ${Math.round(f.elevation)}° ${f.elevation > 0 ? "above" : "below"} the horizon in the ${f.compass}.`,
        },
        meta: { moments: sun, method: "NOAA solar position equations" },
      });
      rows.push({
        platform: "geo-weather",
        status: "found",
        url: "https://open-meteo.com/",
        extra: {
          note: `${weather[0]!.label === "camera" ? "Camera" : "Claimed"} time: ${weather[0]!.summary}.`,
        },
        meta: { moments: weather, attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" },
      });
    }
    const placeLabel = label(place ?? {});
    rows.push({
      platform: "geo-place",
      status: "found",
      url: links.openstreetmap,
      extra: {
        location: placeLabel,
        note: `${source === "camera" ? "Camera GPS" : "Claimed place"}: near ${placeLabel}.`,
      },
      meta: {
        lat,
        lon,
        source: source ?? "camera",
        place: place ?? {},
        label: placeLabel,
        timezone: "Europe/Paris",
        ...(claimPoint ? { claim_point: claimPoint } : {}),
        ...(claimPlace ? { claim_place: claimPlace } : {}),
        ...(claimPoint && gps
          ? { claim_distance_km: Math.round(haversineKm(gps, claimPoint) * 10) / 10 }
          : {}),
        attribution: "© OpenStreetMap contributors (ODbL)",
      },
    });
    const nearParis = haversineKm(location, { lat: 48.86, lon: 2.34 }) < 15;
    if (nearParis) {
      rows.push({
        platform: "geo-webcams",
        status: "found",
        url: `https://www.windy.com/-Webcams/webcams?${lat},${lon},12`,
        extra: {
          note: "2 public webcams within 15 km. Their archives can show the weather and light around the claimed time.",
        },
        meta: {
          webcams: [
            {
              id: "demo-cam-1",
              title: "Paris: Champ de Mars (demo)",
              url: "https://www.windy.com/-Webcams/webcams",
              thumbnail: "/demo/where-when-webcam.svg",
              distance_km: 0.6,
              provider: "Windy Webcams",
            },
            {
              id: "demo-cam-2",
              title: "Paris: Seine river view (demo)",
              url: "https://www.windy.com/-Webcams/webcams",
              thumbnail: "/demo/where-when-webcam.svg",
              distance_km: 2.4,
              provider: "Windy Webcams",
            },
          ],
          directory: `https://www.windy.com/-Webcams/webcams?${lat},${lon},12`,
          attribution: "Webcams provided by windy.com",
        },
      });
    } else {
      skipped(
        "geo-webcams",
        "Nearby webcams need a free Windy Webcams API key (WINDY_WEBCAMS_KEY) on this server. You can browse public webcams on the map instead.",
        {
          directory: `https://www.windy.com/-Webcams/webcams?${lat},${lon},12`,
          requires_env: "WINDY_WEBCAMS_KEY",
        },
      );
    }
    rows.push({
      platform: "geo-street",
      status: "found",
      url: links.openstreetmap,
      extra: {
        note: "Open the spot on public maps and street-level imagery to compare it with the photo.",
      },
      meta: { links, mapillary: "not configured (MAPILLARY_TOKEN)" },
    });
  }
  rows.push({
    platform: "geo-checks",
    status: "found",
    url: location ? links.openstreetmap : null,
    extra: summary ? { note: summary } : {},
    meta: {
      checks,
      ...(claim ? { claim: claim as JsonObject } : {}),
      ...(claimPlace ? { claim_place: claimPlace } : {}),
      basis: {
        ...(location ? { lat, lon, location_source: source } : {}),
        ...(gps ? { camera_gps: gps, camera_time: cam!.exif, camera: cam!.make } : {}),
        ...(camSun ? { camera_utc: camSun.utc_time } : {}),
        ...(claim?.taken_at ? { claimed_time: claim.taken_at } : {}),
        timezone: "Europe/Paris",
        timezone_exact: true,
      },
      lens: opts.lens ? "ready" : "none",
      lens_titles: opts.lens ? LENS_TITLES.length : 0,
    },
  });

  const tag = value.length.toString(16).padStart(4, "0");
  return rows.map((r, i) => ({
    id: `f3${caseId.slice(-6)}-${tag}-4000-8000-${String(i + 1).padStart(12, "0")}`,
    case_id: caseId,
    identifier_type: "image",
    identifier_value: value,
    source_tool: r.platform === "geo-webcams" ? "geo_webcams" : "geo_context",
    module: r.platform === "geo-webcams" ? "geo_webcams" : "geo_context",
    platform: r.platform,
    status: r.status,
    finding_key: `geo-${caseId}-${value}-${r.platform}`,
    extra_metadata: { url: r.url, extra: r.extra, ...r.meta },
    curated: false,
    job_id: opts.jobId ?? null,
    collected_at: new Date(now).toISOString(),
  }));
}

/** The demo photo case's other rows: image details, the Google Lens matches, the manual links. */
export function photoCaseFindings(now: number): Finding[] {
  const at = new Date(now - 30 * 60_000).toISOString();
  const base = (
    n: number,
    module: string,
    platform: string,
    url: string | null,
    extra: JsonObject,
    meta: JsonObject,
  ): Finding => ({
    id: `f4000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    case_id: PHOTO_CASE_ID,
    identifier_type: "image",
    identifier_value: GEO_PHOTO_URL,
    source_tool: module,
    module,
    platform,
    status: "found",
    finding_key: `demo-${module}-${n}`,
    extra_metadata: { url, extra, ...meta },
    curated: false,
    job_id: null,
    collected_at: at,
  });
  const q = encodeURIComponent(GEO_PHOTO_URL);
  const engines = {
    google_lens: `https://lens.google.com/uploadbyurl?url=${q}`,
    yandex: `https://yandex.com/images/search?rpt=imageview&url=${q}`,
    tineye: `https://tineye.com/search?url=${q}`,
    bing: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${q}`,
  };
  return [
    base(
      1,
      "image_meta",
      "image",
      GEO_PHOTO_URL,
      { avatar_phash: "e1c3a59b2d4f8071", note: "This photo contains location data" },
      {
        category: "media",
        format: "JPEG",
        width: 1600,
        height: 1200,
        content_type: "image/jpeg",
        size_bytes: 412_334,
        sha256: "5f2c0e1b9a7d4c3e8f6a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6",
        exif: {
          camera_make: "ExampleCam",
          camera_model: "Model X",
          datetime: DEMO_CAMERA.exif,
          gps_present: true,
          gps_lat: 48.86,
          gps_lon: 2.29,
        },
        gps_present: true,
      },
    ),
    base(
      2,
      "reverse_image_links",
      "reverse-image-links",
      engines.google_lens,
      { links: Object.values(engines).join(", ") },
      { engines, manual: true },
    ),
    ...LENS_TITLES.map((title, i) =>
      base(
        3 + i,
        "reverse_image",
        "google-lens",
        `https://travel-${i + 1}.example/post/${120 + i}`,
        {},
        {
          title,
          source: `travel-${i + 1}.example`,
          position: i + 1,
          match: i === 0 ? "exact" : "similar",
          thumbnail: GEO_PHOTO_ASSET,
        },
      ),
    ),
    ...geoFindings(PHOTO_CASE_ID, GEO_PHOTO_URL, DEMO_CLAIM, now - 29 * 60_000, {
      camera: true,
      lens: true,
    }),
  ];
}

export function photoCaseJobs(now: number): Job[] {
  const iso = (m: number) => new Date(now - m * 60_000).toISOString();
  return ["image_meta", "reverse_image", "reverse_image_links", "geo_context"].map((module, i) => ({
    id: `b4000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    case_id: PHOTO_CASE_ID,
    batch_id: "ba400000-0000-4000-8000-000000000001",
    queue: "media",
    module,
    target_type: "image",
    target_value: GEO_PHOTO_URL,
    params: { claim: DEMO_CLAIM as JsonObject },
    status: "succeeded",
    progress: 100,
    progress_note: null,
    attempts: 1,
    max_attempts: 3,
    result: {
      findings: module === "geo_context" ? 6 : module === "reverse_image" ? 3 : 1,
      found: 1,
    },
    error: null,
    created_at: iso(32),
    started_at: iso(31),
    finished_at: iso(30),
  }));
}

/** Whether a photo value has the demo camera data (the bundled landmark example). */
export const hasDemoCamera = (value: string) => value === GEO_PHOTO_URL;
