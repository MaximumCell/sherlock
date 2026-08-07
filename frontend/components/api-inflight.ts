/** Window-level event bus for in-flight API calls. Lives in a "use client"
 *  file (global-progress.tsx) but exports the begin/end helpers from a
 *  plain module so they can be called from any context — server components,
 *  client components, or even the api() wrapper itself. The exports are
 *  safe no-ops outside the browser (typeof window === "undefined" check). */

const BEGIN = "sherlock:api:begin";
const END = "sherlock:api:end";

export function apiBegin() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BEGIN));
}

export function apiEnd() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(END));
}

export { BEGIN, END };
