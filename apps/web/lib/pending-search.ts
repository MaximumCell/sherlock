/**
 * A search an anonymous visitor started before signing in, kept in sessionStorage so it can
 * resume after the sign-in round trip (OAuth or magic-link redirects reload the page).
 * Every access is wrapped: private windows and blocked storage simply lose the pending search.
 */
import { TARGET_TYPES, type NameHints, type TargetType } from "./types";

export const PENDING_SEARCH_KEY = "sherlock.pending-search.v1";
/** A pending search older than this is dropped instead of resumed. */
export const PENDING_MAX_AGE_MS = 60 * 60 * 1000;

export interface PendingSearch {
  type: TargetType;
  value: string;
  hints: NameHints;
  title: string;
  tags: string;
  excluded: string[];
  modules?: string[];
  /** Set when the search adds a target to an existing case instead of creating one. */
  caseId?: string;
  savedAt: number;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function store(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Validates a parsed value; anything malformed is null. */
export function toPendingSearch(raw: unknown, now: number = Date.now()): PendingSearch | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.type !== "string" || !(TARGET_TYPES as readonly string[]).includes(r.type))
    return null;
  if (typeof r.value !== "string" || !r.value.trim()) return null;
  if (
    typeof r.savedAt !== "number" ||
    now - r.savedAt > PENDING_MAX_AGE_MS ||
    r.savedAt > now + 60_000
  )
    return null;
  const hints: NameHints = {};
  if (typeof r.hints === "object" && r.hints !== null) {
    const h = r.hints as Record<string, unknown>;
    if (typeof h.city === "string") hints.city = h.city;
    if (typeof h.employer === "string") hints.employer = h.employer;
    if (typeof h.school === "string") hints.school = h.school;
    if (typeof h.keywords === "string") hints.keywords = h.keywords;
  }
  return {
    type: r.type as TargetType,
    value: r.value,
    hints,
    title: typeof r.title === "string" ? r.title : "",
    tags: typeof r.tags === "string" ? r.tags : "",
    excluded: isStringArray(r.excluded) ? r.excluded : [],
    ...(isStringArray(r.modules) ? { modules: r.modules } : {}),
    ...(typeof r.caseId === "string" && r.caseId ? { caseId: r.caseId } : {}),
    savedAt: r.savedAt,
  };
}

export function savePendingSearch(
  p: Omit<PendingSearch, "savedAt">,
  now: number = Date.now(),
  s = store(),
): boolean {
  try {
    s?.setItem(PENDING_SEARCH_KEY, JSON.stringify({ ...p, savedAt: now }));
    return s !== null;
  } catch {
    return false;
  }
}

export function loadPendingSearch(now: number = Date.now(), s = store()): PendingSearch | null {
  try {
    const text = s?.getItem(PENDING_SEARCH_KEY);
    return text ? toPendingSearch(JSON.parse(text), now) : null;
  } catch {
    return null;
  }
}

export function clearPendingSearch(s = store()): void {
  try {
    s?.removeItem(PENDING_SEARCH_KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}

/**
 * Take the pending search once the session can run it: signed in (or anonymous searching is
 * allowed). It is removed as it is taken, so a reload never runs it twice.
 */
export function takePendingSearch(
  session: { anonymous: boolean } | null | undefined,
  needsAccount: boolean,
  now: number = Date.now(),
  s = store(),
): PendingSearch | null {
  if (!session || (needsAccount && session.anonymous)) return null;
  const pending = loadPendingSearch(now, s);
  clearPendingSearch(s);
  return pending;
}

/**
 * A photo cannot be kept across a sign-in redirect (files do not fit in sessionStorage and must
 * not linger there). Only a reminder is kept, so the start page can ask for the photo again.
 */
export const PHOTO_REMINDER_KEY = "sherlock.pending-photo.v1";

export function savePhotoReminder(now: number = Date.now(), s = store()): void {
  try {
    s?.setItem(PHOTO_REMINDER_KEY, String(now));
  } catch {
    // storage unavailable: the reminder is lost, the search box still explains it
  }
}

export function clearPhotoReminder(s = store()): void {
  try {
    s?.removeItem(PHOTO_REMINDER_KEY);
  } catch {
    // nothing to clear
  }
}

/** True once (it is removed as it is read) when a signed-in visitor left to sign in with a photo chosen. */
export function takePhotoReminder(
  session: { anonymous: boolean } | null | undefined,
  now: number = Date.now(),
  s = store(),
): boolean {
  if (!session || session.anonymous) return false;
  try {
    const saved = Number(s?.getItem(PHOTO_REMINDER_KEY) ?? NaN);
    if (!Number.isFinite(saved)) return false;
    s?.removeItem(PHOTO_REMINDER_KEY);
    return now - saved <= PENDING_MAX_AGE_MS && saved <= now + 60_000;
  } catch {
    return false;
  }
}
