/**
 * Photo uploads for an image search: pure rules shared by the search box, the data layer and
 * the results view. A photo goes to the PRIVATE Storage bucket `media` under
 * `uploads/<auth uid>/<random uuid>.<ext>` (never the original file name) and the search runs on
 * `storage://media/uploads/<uid>/<file>`. The gateway accepts that value only from the uploader;
 * the photo is deleted with the investigation.
 */
import type { TargetType } from "./types";

export const PHOTO_MAX_BYTES = 8_000_000;
/** Search-engine links built for an uploaded photo stop working after this long. */
export const SIGNED_URL_TTL_S = 3600;
export const PHOTO_BUCKET = "media";
export const PHOTO_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
export const PHOTO_ACCEPT = Object.keys(PHOTO_TYPES).join(",");
export const NOT_SET_UP_MESSAGE =
  "Photo upload is not set up on this server yet. You can still search by image link.";
export const PHOTO_NEEDS_SIGN_IN =
  "Sign in to search with your photo. If signing in opens another page, choose the photo again when you are back.";
export const PHOTO_REPICK_MESSAGE =
  "You are signed in. Photos cannot be kept across the sign-in page, so choose your photo again to search.";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UPLOAD_RE = new RegExp(
  `^storage://media/(uploads/(${UUID})/${UUID}\\.(?:jpg|png|webp|gif))$`,
);
const UUID_RE = new RegExp(`^${UUID}$`);

export type PhotoCheck = { ok: true; ext: string } | { ok: false; error: string };

/** Type and size, checked in the browser before anything is uploaded. */
export function checkPhotoFile(file: { type: string; size: number }): PhotoCheck {
  const ext = PHOTO_TYPES[file.type.toLowerCase()];
  if (!ext) return { ok: false, error: "Choose a JPEG, PNG, WebP or GIF photo." };
  if (file.size <= 0) return { ok: false, error: "This file is empty. Choose another photo." };
  if (file.size > PHOTO_MAX_BYTES)
    return {
      ok: false,
      error: `This photo is ${formatBytes(file.size)}. Photos can be up to 8 MB.`,
    };
  return { ok: true, ext };
}

/** "1.2 MB", "340 KB", "900 bytes" (decimal units, like the 8 MB limit). */
export function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} bytes`;
}

/** Object path inside the bucket. Throws for anything but a user id, a random id and a known extension. */
export function photoObjectPath(userId: string, fileId: string, ext: string): string {
  const uid = userId.toLowerCase();
  const id = fileId.toLowerCase();
  if (!UUID_RE.test(uid) || !UUID_RE.test(id) || !Object.values(PHOTO_TYPES).includes(ext))
    throw new Error("Could not prepare the photo upload.");
  return `uploads/${uid}/${id}.${ext}`;
}

export function photoTarget(path: string): { type: TargetType; value: string } {
  return { type: "image", value: `storage://${PHOTO_BUCKET}/${path}` };
}

/** Any `storage://` value (valid or not): it is never shown as text. */
export function isUploadedPhoto(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase().startsWith("storage://");
}

/** The object path of a valid upload value, else null. */
export function photoPath(value: string): { path: string; ownerId: string } | null {
  const m = UPLOAD_RE.exec(value.trim().toLowerCase());
  return m?.[1] && m[2] ? { path: m[1], ownerId: m[2] } : null;
}

/** How a target value reads in the interface: an upload is "Uploaded photo", never its path. */
export function displayTargetValue(value: string): string {
  return isUploadedPhoto(value) ? "Uploaded photo" : value;
}

export type UploadErrorKind = "not_set_up" | "too_large" | "bad_type" | "signed_out" | "other";

/** Plain-English message for a failed upload. Storage errors carry `statusCode` / `message`. */
export function classifyUploadError(err: unknown): { kind: UploadErrorKind; message: string } {
  const rec = typeof err === "object" && err !== null ? (err as Record<string, unknown>) : {};
  const status = String(rec.statusCode ?? rec.status ?? "");
  const text =
    `${typeof rec.message === "string" ? rec.message : String(err)} ${typeof rec.error === "string" ? rec.error : ""}`.toLowerCase();
  if (status === "413" || /maximum allowed size|too large|payload/.test(text))
    return { kind: "too_large", message: "This photo is larger than the server accepts (8 MB)." };
  if (status === "415" || /mime type|content type/.test(text))
    return {
      kind: "bad_type",
      message: "The server does not accept this file type. Choose a JPEG, PNG, WebP or GIF photo.",
    };
  if (/not signed in|jwt|session/.test(text) && status === "401")
    return {
      kind: "signed_out",
      message: "Your session ended. Sign in again and choose the photo.",
    };
  if (
    ["400", "401", "403", "404"].includes(status) ||
    /row-level security|bucket not found|unauthorized|not found|policy/.test(text)
  )
    return { kind: "not_set_up", message: NOT_SET_UP_MESSAGE };
  return {
    kind: "other",
    message: "The photo could not be uploaded. Check your connection and try again.",
  };
}

// ----------------------------------------------------------------------------- upload state machine
export interface ChosenPhoto {
  file: Blob;
  /** Object URL for the thumbnail (revoked by whoever created it). */
  previewUrl: string;
  size: number;
  mime: string;
  /** EXIF location data found in the file (JPEG only); null when unknown. */
  gps: boolean | null;
}

export type UploadState =
  | { phase: "idle"; error: string | null }
  /** `uploaded`: the photo is already in Storage (starting the search failed); reuse it. */
  | { phase: "chosen"; photo: ChosenPhoto; error: string | null; uploaded?: string }
  | { phase: "needs_sign_in"; photo: ChosenPhoto }
  | { phase: "uploading"; photo: ChosenPhoto }
  | { phase: "starting"; photo: ChosenPhoto; value: string };

export type UploadEvent =
  | { type: "choose"; photo: ChosenPhoto }
  | { type: "reject"; error: string }
  | { type: "clear" }
  | { type: "sign_in_required" }
  | { type: "signed_in" }
  | { type: "upload" }
  | { type: "uploaded"; value: string }
  | { type: "failed"; error: string };

export const IDLE: UploadState = { phase: "idle", error: null };

export function uploadReducer(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case "choose":
      return state.phase === "uploading" || state.phase === "starting"
        ? state
        : { phase: "chosen", photo: event.photo, error: null };
    case "reject":
      return state.phase === "chosen"
        ? { ...state, error: event.error }
        : { phase: "idle", error: event.error };
    case "clear":
      return state.phase === "uploading" ? state : IDLE;
    case "sign_in_required":
      return state.phase === "chosen" ? { phase: "needs_sign_in", photo: state.photo } : state;
    case "signed_in":
      return state.phase === "needs_sign_in"
        ? { phase: "chosen", photo: state.photo, error: null }
        : state;
    case "upload":
      return state.phase === "chosen" || state.phase === "needs_sign_in"
        ? { phase: "uploading", photo: state.photo }
        : state;
    case "uploaded":
      return state.phase === "uploading"
        ? { phase: "starting", photo: state.photo, value: event.value }
        : state;
    case "failed":
      if (state.phase === "starting")
        return { phase: "chosen", photo: state.photo, error: event.error, uploaded: state.value };
      return "photo" in state
        ? { phase: "chosen", photo: state.photo, error: event.error }
        : { phase: "idle", error: event.error };
  }
}

// ----------------------------------------------------------------------------- EXIF location check
/**
 * True when a JPEG's EXIF block has a GPS section with a latitude. Reads only the bytes given
 * (the first 128 KB are enough: EXIF sits at the start). False for other formats or no EXIF.
 */
export function hasExifGps(bytes: Uint8Array): boolean {
  const b = (i: number) => bytes[i] ?? 0;
  if (bytes.length < 4 || b(0) !== 0xff || b(1) !== 0xd8) return false;
  let at = 2;
  while (at + 4 <= bytes.length && b(at) === 0xff) {
    const marker = b(at + 1);
    const len = (b(at + 2) << 8) | b(at + 3);
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(at + 4, at + 10)) === "Exif\0\0")
      return tiffHasGps(bytes.subarray(at + 10, at + 2 + len));
    if (marker === 0xda || len < 2) return false; // image data started: no EXIF
    at += 2 + len;
  }
  return false;
}

function tiffHasGps(t: Uint8Array): boolean {
  if (t.length < 8) return false;
  const b = (i: number) => t[i] ?? 0;
  const little = b(0) === 0x49 && b(1) === 0x49;
  const u16 = (o: number) =>
    o + 2 > t.length ? -1 : little ? b(o) | (b(o + 1) << 8) : (b(o) << 8) | b(o + 1);
  const u32 = (o: number) => {
    if (o + 4 > t.length) return -1;
    const [lo, hi] = little ? [u16(o), u16(o + 2)] : [u16(o + 2), u16(o)];
    return (lo | (hi << 16)) >>> 0;
  };
  const findTag = (ifd: number, tag: number): number => {
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > t.length) return -1;
      if (u16(entry) === tag) return u32(entry + 8);
    }
    return -1;
  };
  const ifd0 = u32(4);
  if (ifd0 < 8) return false;
  const gps = findTag(ifd0, 0x8825);
  return gps >= 8 && findTag(gps, 0x0002) >= 0;
}
