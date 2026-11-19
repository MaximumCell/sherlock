/** localStorage helpers that never throw (private mode, blocked storage, SSR). */

export function readStorage(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export const CONSENT_KEY = "sherlock.authorised-use.v1";
export const THEME_KEY = "sherlock.theme";

/** The one-time "I am authorised / it is my own data" acknowledgement. */
export function hasAcknowledged(): boolean {
  return readStorage(CONSENT_KEY) !== null;
}

export function recordAcknowledgement(now: Date = new Date()): void {
  writeStorage(CONSENT_KEY, now.toISOString());
}
