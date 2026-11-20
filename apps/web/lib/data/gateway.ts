/**
 * Gateway command client. The gateway runs on a free host that sleeps, so every
 * command retries with backoff on network errors and 502/503/504 for about a
 * minute, and reports its progress to `gatewayStatus` (never a silent failure).
 */
import { gatewayStatus, type GatewayStatusStore } from "./gateway-status";

export class GatewayError extends Error {
  readonly status: number;
  readonly detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = "GatewayError";
    this.status = status;
    this.detail = detail;
  }
  /** The service never answered (asleep, offline, or blocked). */
  get unreachable(): boolean {
    return this.status === 0 || RETRY_STATUSES.has(this.status);
  }
}

export const RETRY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
/** Waits between attempts; about 65 s in total, enough for a cold start. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 8000, 10000, 10000, 15000, 15000];

export interface GatewayRequest {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  token?: string | null;
  /** How to read a successful response. Default "json". */
  parse?: "json" | "text" | "none";
  /** Disable retries (used for best-effort calls such as /wake). */
  retry?: boolean;
  signal?: AbortSignal;
}

export interface GatewayDeps {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  status?: GatewayStatusStore;
  delays?: readonly number[];
}

/**
 * A 503 the gateway itself answered with `{detail}` (for example "Searches are paused by the
 * operator") is a decision, not a cold start: it is shown at once instead of retried.
 */
export function isGatewayRefusal(status: number, body: string): boolean {
  if (status !== 503) return false;
  try {
    const parsed: unknown = JSON.parse(body);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { detail?: unknown }).detail === "string"
    );
  } catch {
    return false;
  }
}

class FinalError {
  constructor(readonly error: GatewayError) {}
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** FastAPI errors are `{detail: string}` or `{detail: [{loc, msg}]}`. */
export function parseErrorDetail(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "detail" in parsed) {
      const detail = (parsed as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
      if (Array.isArray(detail) && detail.length > 0) {
        const first: unknown = detail[0];
        if (typeof first === "object" && first !== null && "msg" in first) {
          const { msg, loc } = first as { msg: unknown; loc?: unknown };
          const where = Array.isArray(loc) ? loc.filter((p) => p !== "body").join(".") : "";
          return where ? `${where}: ${String(msg)}` : String(msg);
        }
      }
    }
  } catch {
    // not JSON
  }
  const text = body.trim();
  return text && text.length < 200 ? text : `Request failed (${status})`;
}

export function createGateway(deps: GatewayDeps) {
  const sleep = deps.sleep ?? defaultSleep;
  const status = deps.status ?? gatewayStatus;
  const delays = deps.delays ?? RETRY_DELAYS_MS;

  return async function request<T>(path: string, options: GatewayRequest = {}): Promise<T> {
    const doFetch = deps.fetchImpl ?? fetch;
    const { method = "GET", body, token, parse = "json", retry = true, signal } = options;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    const activity = status.begin();
    try {
      for (let attempt = 0; ; attempt++) {
        let failure: GatewayError;
        try {
          const res = await doFetch(`${deps.baseUrl}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
            signal,
          });
          if (res.ok) {
            if (parse === "none" || res.status === 204) return undefined as T;
            if (parse === "text") return (await res.text()) as T;
            return (await res.json()) as T;
          }
          const text = await res.text();
          failure = new GatewayError(res.status, parseErrorDetail(res.status, text));
          if (!RETRY_STATUSES.has(res.status) || isGatewayRefusal(res.status, text)) throw new FinalError(failure);
        } catch (err) {
          if (err instanceof FinalError) throw err.error;
          if (err instanceof GatewayError) {
            if (!RETRY_STATUSES.has(err.status)) throw err;
            failure = err;
          } else if (signal?.aborted) {
            throw err;
          } else {
            failure = new GatewayError(0, "The scan service could not be reached.");
          }
        }
        const delay = delays[attempt];
        if (!retry || delay === undefined) {
          throw new GatewayError(
            failure.status,
            "The scan service did not respond. It may still be starting; try again in a moment.",
          );
        }
        activity.retry(attempt + 1);
        await sleep(delay);
      }
    } finally {
      activity.end();
    }
  };
}

export type GatewayClient = ReturnType<typeof createGateway>;

export function describeError(err: unknown): string {
  if (err instanceof GatewayError) {
    if (err.status === 403) return err.detail || "You are not allowed to do that.";
    if (err.status === 429) return err.detail || "Rate limit reached. Try again later.";
    return err.detail;
  }
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
