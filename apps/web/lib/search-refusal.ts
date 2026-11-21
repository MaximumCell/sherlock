/**
 * Why the gateway refused a search, in words a visitor can act on (pure; see docs/CONTRACTS.md,
 * "Search limits"). The gateway's `detail` is already specific; this adds a title, the kind of
 * refusal (which decides the UI: toast, sign-in dialog or the "previous search" dialog) and the
 * wait from `Retry-After` when the message does not say it.
 */
import { GatewayError, type ActiveSearch } from "./data/gateway";
import type { QueueStatus } from "./types";

export type RefusalKind =
  "sign_in" | "active_search" | "busy" | "limit" | "paused" | "blocked" | "forbidden";

export interface Refusal {
  kind: RefusalKind;
  title: string;
  description: string;
  retryAfterS: number | null;
  activeSearch: ActiveSearch | null;
}

export const SIGN_IN_REASON = "Sign in to run your own search — the demo needs no account.";

/** "about a minute", "about 4 minutes", "about 3 hours" (same wording as the gateway). */
export function formatWait(seconds: number): string {
  if (seconds <= 90) return "about a minute";
  if (seconds < 3600) return `about ${Math.ceil(seconds / 60)} minutes`;
  const hours = Math.round(seconds / 3600);
  return hours <= 1 ? "about an hour" : `about ${hours} hours`;
}

function withWait(detail: string, retryAfterS: number | null): string {
  if (retryAfterS === null || /\bin about\b/i.test(detail)) return detail;
  return `${detail} You can try again in ${formatWait(retryAfterS)}.`;
}

/** A refusal to search, or null when the error is something else (network, 404, 500...). */
export function classifyRefusal(err: unknown): Refusal | null {
  if (!(err instanceof GatewayError)) return null;
  const { status, detail, retryAfterS, activeSearch } = err;
  const base = { retryAfterS, activeSearch: null, description: detail };
  if (status === 401 && /sign in|signed-in|account/i.test(detail)) {
    return { ...base, kind: "sign_in", title: "Sign in to search" };
  }
  if (status === 429 && activeSearch) {
    return {
      ...base,
      kind: "active_search",
      title: "Your previous search is still running",
      activeSearch,
    };
  }
  if (status === 429) {
    return {
      ...base,
      kind: "limit",
      title: "Search limit reached",
      description: withWait(detail || "Too many searches. Try again later.", retryAfterS),
    };
  }
  if (status === 503 && /paused/i.test(detail)) {
    return { ...base, kind: "paused", title: "Searches are paused" };
  }
  if (status === 503 && /busy/i.test(detail)) {
    return {
      ...base,
      kind: "busy",
      title: "Sherlock is busy",
      description: withWait(detail, retryAfterS),
    };
  }
  if (status === 403 && /blocked/i.test(detail)) {
    return { ...base, kind: "blocked", title: "Searching is blocked" };
  }
  if (status === 403 && /sign|anonymous|account/i.test(detail)) {
    return { ...base, kind: "forbidden", title: "Sign in for this search" };
  }
  return null;
}

export interface WaitingText {
  headline: string;
  detail: string | null;
}

/** "Waiting for other searches to finish · N ahead of you", only while the search really waits. */
export function waitingText(status: QueueStatus | null | undefined): WaitingText | null {
  if (!status?.waiting || status.ahead <= 0) return null;
  const n = status.ahead;
  return {
    headline: `Waiting for other searches to finish · ${n} ahead of you`,
    detail:
      status.estimated_wait_s !== null
        ? `Your search starts in ${formatWait(status.estimated_wait_s)}. Keep this page open, or come back later: it keeps running.`
        : "Your search starts as soon as a slot frees up. It keeps running if you leave.",
  };
}
