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

/**
 * Inline script run before first paint (app/layout.tsx): dark is the default look; a stored
 * "light" choice wins. It also marks the page hidden/visible so CSS loops can pause.
 */
export const THEME_SCRIPT = `(function(){var d=true;try{d=localStorage.getItem(${JSON.stringify(THEME_KEY)})!=="light";}catch(e){}var h=document.documentElement;h.classList.toggle("dark",d);document.addEventListener("visibilitychange",function(){if(document.hidden)h.setAttribute("data-hidden","");else h.removeAttribute("data-hidden");});})()`;

/** True when a keyboard event comes from a field the user is typing in. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
