/**
 * What an image search found, gathered for the results view: the photo's details
 * (`image_meta`), reverse image matches (`reverse_image`, Google Lens via SerpApi) and the
 * ready-made search-engine links (`reverse_image_links`). Matches are copies of the same image,
 * never "the same face": Sherlock does no face recognition.
 */
import { parseImage, type ImageInfo } from "./finding-extras";
import type { Finding, JsonObject, JsonValue } from "./types";

export interface PhotoMatch {
  id: string;
  title: string;
  source: string | null;
  thumbnail: string | null;
  link: string;
}

export interface EngineLink {
  key: string;
  label: string;
  url: string;
}

export interface PhotoResults {
  details: ImageInfo | null;
  /** The photo carries GPS coordinates in its EXIF data. */
  hasLocation: boolean;
  /** Plain note from the metadata module (e.g. "This photo contains location data"). */
  locationNote: string | null;
  matches: PhotoMatch[];
  links: EngineLink[];
  /** E.g. the links stop working after an hour (uploaded photos). */
  linksNote: string | null;
  /** Reason the metadata could not be read, when it failed. */
  detailsError: string | null;
  /** Reverse image search ran (any reverse_image row, found or not). */
  reverseSearched: boolean;
}

const ENGINE_LABELS: Record<string, string> = {
  google_lens: "Google Lens",
  yandex: "Yandex",
  tineye: "TinEye",
  bing: "Bing",
};

const isObj = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: JsonValue | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const httpUrl = (v: string | null): string | null => (v && /^https?:\/\//i.test(v) ? v : null);
/** Thumbnails may also be inline images (the demo's invented matches). */
const imageUrl = (v: string | null): string | null =>
  httpUrl(v) ?? (v && /^data:image\//i.test(v) ? v : null);

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function split(f: Finding): { meta: JsonObject; extra: JsonObject } {
  const meta: JsonObject = {};
  for (const [k, v] of Object.entries(f.extra_metadata))
    if (k !== "extra" && v !== undefined) meta[k] = v;
  const extra = f.extra_metadata.extra;
  return { meta, extra: isObj(extra) ? extra : {} };
}

/** Results for one image target (`value` is its URL or `storage://` reference). */
export function photoResults(findings: Finding[], value: string): PhotoResults {
  const mine = findings.filter(
    (f) => f.identifier_type === "image" && f.identifier_value === value,
  );
  const metaRow = mine.find((f) => f.module === "image_meta" && f.status === "found");
  const metaError = mine.find((f) => f.module === "image_meta" && f.status === "error");
  const parts = metaRow ? split(metaRow) : null;
  const details = parts ? parseImage(parts.meta, parts.extra) : null;

  const matches: PhotoMatch[] = mine
    .filter((f) => f.module === "reverse_image" && f.status === "found")
    .flatMap((f) => {
      const { meta } = split(f);
      const link = httpUrl(str(f.extra_metadata.url));
      if (!link) return [];
      const position = typeof meta.position === "number" ? meta.position : 999;
      return [
        {
          id: f.id,
          title: str(meta.title) ?? link,
          source: str(meta.source) ?? hostOf(link),
          thumbnail: imageUrl(str(meta.thumbnail)),
          link,
          position,
        },
      ];
    })
    .sort((a, b) => a.position - b.position)
    .map(({ position: _position, ...m }) => m);

  const linksRow = mine.find((f) => f.module === "reverse_image_links" && f.status === "found");
  const linkParts = linksRow ? split(linksRow) : null;
  const engines = linkParts && isObj(linkParts.meta.engines) ? linkParts.meta.engines : {};
  const links: EngineLink[] = Object.entries(engines).flatMap(([key, url]) => {
    const u = httpUrl(str(url));
    return u ? [{ key, label: ENGINE_LABELS[key] ?? key, url: u }] : [];
  });

  return {
    details,
    hasLocation: details?.gpsPresent === true,
    locationNote: parts ? str(parts.extra.note) : null,
    matches,
    links,
    linksNote: linkParts ? str(linkParts.extra.note) : null,
    detailsError: metaError
      ? (str(split(metaError).meta.reason) ?? "The photo could not be read.")
      : null,
    reverseSearched: mine.some((f) => f.module === "reverse_image"),
  };
}
