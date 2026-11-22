/**
 * Town and area search for the claim form: Open-Meteo's free geocoding API (GeoNames data,
 * no key, CORS enabled, made for search boxes). Called from the browser after the user stops
 * typing; only the typed place name is sent. Landmarks are not in it: pick the spot on the map,
 * or type the landmark and the location check looks it up once (OpenStreetMap Nominatim).
 */
import type { PlaceHit } from "./geo";

export const PLACE_SEARCH_URL = "https://geocoding-api.open-meteo.com/v1/search";
export const PLACE_SEARCH_MIN_CHARS = 2;
export const PLACE_SEARCH_DEBOUNCE_MS = 450;

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Open-Meteo search results as place hits, coordinates rounded to two decimals. */
export function toPlaceHits(body: unknown): PlaceHit[] {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((r: Row) => {
    const name = text(r.name);
    const lat = typeof r.latitude === "number" ? r.latitude : null;
    const lon = typeof r.longitude === "number" ? r.longitude : null;
    if (!name || lat === null || lon === null) return [];
    const detail = [text(r.admin1), text(r.country)].filter(
      (x): x is string => x !== null && x !== name,
    );
    return [
      {
        id: String(r.id ?? `${name}:${lat}:${lon}`),
        label: name,
        detail: detail.length ? detail.join(", ") : null,
        lat: Math.round(lat * 100) / 100,
        lon: Math.round(lon * 100) / 100,
      },
    ];
  });
}

export async function searchPlacesOnline(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < PLACE_SEARCH_MIN_CHARS) return [];
  const url = `${PLACE_SEARCH_URL}?name=${encodeURIComponent(q.slice(0, 80))}&count=6&language=en&format=json`;
  const res = await fetch(url, { signal, referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status})`);
  return toPlaceHits(await res.json());
}
