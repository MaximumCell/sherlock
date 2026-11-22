import { describe, expect, it } from "vitest";
import { savePhotoReminder, takePhotoReminder } from "./pending-search";
import {
  IDLE,
  NOT_SET_UP_MESSAGE,
  checkPhotoFile,
  classifyUploadError,
  displayTargetValue,
  formatBytes,
  hasExifGps,
  photoObjectPath,
  photoPath,
  photoTarget,
  uploadReducer,
  type ChosenPhoto,
  type UploadState,
} from "./uploads";

const UID = "00000000-0000-4000-8000-0000000000aa";
const FILE = "0a0b0c0d-1e1f-4a2b-8c3d-4e5f6a7b8c9d";

/** A minimal JPEG: SOI, an APP1 Exif block (little-endian TIFF), optionally with a GPS IFD. */
function jpegWithExif(gps: boolean): Uint8Array {
  const tiff: number[] = [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00];
  const entry = (tag: number, type: number, count: number, value: number) => [
    tag & 0xff, tag >> 8, type & 0xff, type >> 8,
    count & 0xff, (count >> 8) & 0xff, 0, 0,
    value & 0xff, (value >> 8) & 0xff, 0, 0,
  ];
  // IFD0 at 8: one entry (Make or GPS pointer), next-IFD 0
  if (gps) tiff.push(1, 0, ...entry(0x8825, 4, 1, 26), 0, 0, 0, 0);
  else tiff.push(1, 0, ...entry(0x010f, 2, 4, 0x0041), 0, 0, 0, 0);
  // GPS IFD at 26: GPSLatitudeRef + GPSLatitude
  if (gps) tiff.push(2, 0, ...entry(0x0001, 2, 2, 0x4e), ...entry(0x0002, 5, 3, 0), 0, 0, 0, 0);
  const exif = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const len = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...exif, 0xff, 0xda, 0, 2]);
}

const photo: ChosenPhoto = { file: new Blob(["x"]), previewUrl: "blob:x", size: 1, mime: "image/png", gps: false };

describe("photo file checks", () => {
  it("accepts the four image types up to 8 MB", () => {
    expect(checkPhotoFile({ type: "image/jpeg", size: 1_200_000 })).toEqual({ ok: true, ext: "jpg" });
    expect(checkPhotoFile({ type: "image/webp", size: 8_000_000 })).toEqual({ ok: true, ext: "webp" });
    expect(checkPhotoFile({ type: "image/gif", size: 10 })).toEqual({ ok: true, ext: "gif" });
  });
  it("refuses other types, empty and oversized files with plain reasons", () => {
    expect(checkPhotoFile({ type: "image/svg+xml", size: 10 })).toMatchObject({ ok: false, error: expect.stringContaining("JPEG, PNG, WebP or GIF") });
    expect(checkPhotoFile({ type: "application/pdf", size: 10 }).ok).toBe(false);
    expect(checkPhotoFile({ type: "image/png", size: 0 }).ok).toBe(false);
    expect(checkPhotoFile({ type: "image/png", size: 8_000_001 })).toEqual({ ok: false, error: "This photo is 8.0 MB. Photos can be up to 8 MB." });
  });
  it("formats sizes", () => {
    expect(formatBytes(1_234_567)).toBe("1.2 MB");
    expect(formatBytes(340_400)).toBe("340 KB");
    expect(formatBytes(900)).toBe("900 bytes");
  });
});

describe("photo targets", () => {
  it("builds the object path and the storage target from ids only", () => {
    const path = photoObjectPath(UID.toUpperCase(), FILE, "png");
    expect(path).toBe(`uploads/${UID}/${FILE}.png`);
    expect(photoTarget(path)).toEqual({ type: "image", value: `storage://media/uploads/${UID}/${FILE}.png` });
    expect(photoPath(photoTarget(path).value)).toEqual({ path, ownerId: UID });
  });
  it("never builds a path from a file name or traversal", () => {
    expect(() => photoObjectPath(UID, "../holiday", "png")).toThrow();
    expect(() => photoObjectPath("../x", FILE, "png")).toThrow();
    expect(() => photoObjectPath(UID, FILE, "svg")).toThrow();
    expect(photoPath(`storage://media/uploads/${UID}/../${FILE}.png`)).toBeNull();
    expect(photoPath(`storage://other/uploads/${UID}/${FILE}.png`)).toBeNull();
  });
  it("shows an upload as Uploaded photo, never its path", () => {
    expect(displayTargetValue(`storage://media/uploads/${UID}/${FILE}.png`)).toBe("Uploaded photo");
    expect(displayTargetValue("https://x.example/a.png")).toBe("https://x.example/a.png");
  });
});

describe("upload errors", () => {
  it("reads a storage permission error as 'not set up yet'", () => {
    const rls = { statusCode: "403", message: "new row violates row-level security policy" };
    expect(classifyUploadError(rls)).toEqual({ kind: "not_set_up", message: NOT_SET_UP_MESSAGE });
    expect(classifyUploadError({ statusCode: "404", message: "Bucket not found" }).kind).toBe("not_set_up");
  });
  it("names size and type refusals, and falls back to a connection hint", () => {
    expect(classifyUploadError({ statusCode: "413", message: "The object exceeded the maximum allowed size" }).kind).toBe("too_large");
    expect(classifyUploadError({ statusCode: "415", message: "mime type image/svg+xml is not supported" }).kind).toBe("bad_type");
    expect(classifyUploadError(new TypeError("Failed to fetch")).kind).toBe("other");
  });
});

describe("upload state machine", () => {
  const run = (events: Parameters<typeof uploadReducer>[1][], from: UploadState = IDLE) => events.reduce(uploadReducer, from);

  it("goes chosen, uploading, starting", () => {
    const s = run([{ type: "choose", photo }, { type: "upload" }, { type: "uploaded", value: "storage://v" }]);
    expect(s).toEqual({ phase: "starting", photo, value: "storage://v" });
  });
  it("waits for sign-in, then continues with the same photo", () => {
    const waiting = run([{ type: "choose", photo }, { type: "sign_in_required" }]);
    expect(waiting).toEqual({ phase: "needs_sign_in", photo });
    expect(uploadReducer(waiting, { type: "signed_in" })).toEqual({ phase: "chosen", photo, error: null });
  });
  it("keeps the photo with the reason when the upload fails", () => {
    const s = run([{ type: "choose", photo }, { type: "upload" }, { type: "failed", error: NOT_SET_UP_MESSAGE }]);
    expect(s).toEqual({ phase: "chosen", photo, error: NOT_SET_UP_MESSAGE });
  });
  it("remembers an uploaded photo when only starting the search failed", () => {
    const s = run([{ type: "choose", photo }, { type: "upload" }, { type: "uploaded", value: "storage://v" }, { type: "failed", error: "no" }]);
    expect(s).toEqual({ phase: "chosen", photo, error: "no", uploaded: "storage://v" });
  });
  it("ignores choose and clear while uploading; rejects show the reason", () => {
    const uploading = run([{ type: "choose", photo }, { type: "upload" }]);
    expect(uploadReducer(uploading, { type: "clear" })).toBe(uploading);
    expect(uploadReducer(uploading, { type: "choose", photo })).toBe(uploading);
    expect(uploadReducer(IDLE, { type: "reject", error: "bad" })).toEqual({ phase: "idle", error: "bad" });
    expect(run([{ type: "choose", photo }, { type: "clear" }])).toEqual(IDLE);
  });
});

describe("EXIF location check", () => {
  it("finds a GPS latitude in a JPEG", () => {
    expect(hasExifGps(jpegWithExif(true))).toBe(true);
  });
  it("is false without GPS, for other formats and for garbage", () => {
    expect(hasExifGps(jpegWithExif(false))).toBe(false);
    expect(hasExifGps(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(hasExifGps(jpegWithExif(true).slice(0, 20))).toBe(false);
    expect(hasExifGps(new Uint8Array([]))).toBe(false);
  });
});

describe("photo reminder across a sign-in page", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };
  it("is taken once, only by a signed-in session, within the hour", () => {
    const s = memory();
    savePhotoReminder(1_000, s);
    expect(takePhotoReminder({ anonymous: true }, 2_000, s)).toBe(false);
    expect(takePhotoReminder({ anonymous: false }, 2_000, s)).toBe(true);
    expect(takePhotoReminder({ anonymous: false }, 2_000, s)).toBe(false);
    savePhotoReminder(0, s);
    expect(takePhotoReminder({ anonymous: false }, 2 * 60 * 60 * 1000, s)).toBe(false);
  });
});
