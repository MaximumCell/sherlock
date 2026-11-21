/** Pure helpers for the operator panel: labels, chart geometry, filters. No React, no I/O. */
import type { DayPoint, FlagSeverity, MisuseFlag, SearchOutcome, SessionBrief } from "./types";
import { SEARCH_OUTCOMES } from "./types";

export const OUTCOME_LABELS: Record<SearchOutcome, string> = {
  accepted: "Accepted",
  rate_limited: "Rate limited",
  blocked: "Blocked",
  paused: "Paused",
  forbidden: "Not allowed",
  invalid: "Invalid",
  burst_limited: "Too many at once",
  active_search: "Search still running",
  busy: "Server busy",
  sign_in_required: "Needed sign-in",
};

/** Badge variants of the UI kit, per outcome. */
export const OUTCOME_TONES: Record<SearchOutcome, "success" | "warning" | "danger" | "muted"> = {
  accepted: "success",
  rate_limited: "warning",
  blocked: "danger",
  paused: "muted",
  forbidden: "danger",
  invalid: "muted",
  burst_limited: "warning",
  active_search: "muted",
  busy: "warning",
  sign_in_required: "muted",
};

/** Chart fills (Tailwind classes on SVG rects), stacked in SEARCH_OUTCOMES order. */
export const OUTCOME_FILLS: Record<SearchOutcome, string> = {
  accepted: "fill-success",
  rate_limited: "fill-warning",
  blocked: "fill-danger",
  paused: "fill-muted-foreground/50",
  forbidden: "fill-danger/60",
  invalid: "fill-muted-foreground/30",
  burst_limited: "fill-warning/70",
  active_search: "fill-accent/40",
  busy: "fill-warning/40",
  sign_in_required: "fill-muted-foreground/20",
};

export const SEVERITY_LABELS: Record<FlagSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SEVERITY_RANK: Record<FlagSeverity, number> = { high: 0, medium: 1, low: 2 };

export function severityTone(severity: FlagSeverity): "danger" | "warning" | "muted" {
  return severity === "high" ? "danger" : severity === "medium" ? "warning" : "muted";
}

/** The most severe flag first; null when there are none. */
export function topFlag(flags: readonly MisuseFlag[]): MisuseFlag | null {
  return (
    [...flags].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0] ?? null
  );
}

/** One-line summary of a session's flags, for lists and screen readers. */
export function flagSummary(flags: readonly MisuseFlag[]): string {
  if (flags.length === 0) return "No warning signs";
  const top = topFlag(flags);
  const more = flags.length - 1;
  return more > 0 ? `${top?.label} (+${more} more)` : (top?.label ?? "");
}

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bCriOS\/|\bChrome\//, "Chrome"],
  [/\bVersion\/[\d.]+.*Safari\//, "Safari"],
  [/\bcurl\//i, "curl"],
  [/python-requests|httpx|aiohttp/i, "Python script"],
  [/\bbot\b|crawler|spider/i, "Bot"],
];

const SYSTEMS: [RegExp, string][] = [
  [/\biPhone\b|\biPad\b|\biOS\b/, "iOS"],
  [/\bAndroid\b/, "Android"],
  [/\bCrOS\b/, "ChromeOS"],
  [/\bWindows\b/, "Windows"],
  [/\bMac OS X\b|\bMacintosh\b/, "macOS"],
  [/\bLinux\b/, "Linux"],
];

/** "Firefox on macOS" from a raw user-agent string; "Unknown browser" when there is none. */
export function userAgentLabel(ua: string | null | undefined): string {
  const raw = (ua ?? "").trim();
  if (!raw) return "Unknown browser";
  const browser = BROWSERS.find(([rx]) => rx.test(raw))?.[1];
  const os = SYSTEMS.find(([rx]) => rx.test(raw))?.[1];
  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return `Browser on ${os}`;
  return "Other client";
}

/** Regional-indicator flag for an ISO 3166 alpha-2 code; empty for anything else. */
export function countryFlag(code: string | null | undefined): string {
  const cc = (code ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function shortId(userId: string): string {
  return userId.slice(0, 8);
}

/** "kit@example.com" or "Anonymous 1a2b3c4d". */
export function sessionName(s: Pick<SessionBrief, "user_id" | "is_anonymous" | "email">): string {
  if (!s.is_anonymous && s.email) return s.email;
  return `${s.is_anonymous ? "Anonymous" : "Signed in"} ${shortId(s.user_id)}`;
}

/** "Shared origin with 2 other sessions", or null when the origin is not shared. */
export function sharedOriginLabel(s: Pick<SessionBrief, "origin_sessions">): string | null {
  const others = s.origin_sessions - 1;
  if (others < 1) return null;
  return `Shared origin with ${others} other ${others === 1 ? "session" : "sessions"}`;
}

export interface ChartBar {
  day: string;
  total: number;
  segments: { outcome: SearchOutcome; value: number; y: number; height: number }[];
}

export interface ChartModel {
  max: number;
  ticks: number[];
  bars: ChartBar[];
  total: number;
}

/** A "nice" axis maximum: 1, 2 or 5 times a power of ten, at least `value`. */
export function niceMax(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * power;
    if (candidate >= value) return Math.max(4, Math.ceil(candidate));
  }
  return 10 * power;
}

/**
 * Stacked-bar geometry for the searches-per-day chart. Heights are in chart units
 * (0..height); y counts down from the top, segments stacked in SEARCH_OUTCOMES order.
 */
export function chartModel(series: readonly DayPoint[], height: number): ChartModel {
  const totals = series.map((p) => SEARCH_OUTCOMES.reduce((sum, o) => sum + (p[o] ?? 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const bars = series.map((p, i) => {
    let base = height;
    const segments = SEARCH_OUTCOMES.filter((o) => (p[o] ?? 0) > 0).map((outcome) => {
      const value = p[outcome];
      const h = (value / max) * height;
      base -= h;
      return { outcome, value, y: base, height: h };
    });
    return { day: p.day, total: totals[i] ?? 0, segments };
  });
  return {
    max,
    ticks: [...new Set([0, 1, 2, 3, 4].map((k) => Math.round((max * k) / 4)))],
    bars,
    total: totals.reduce((a, b) => a + b, 0),
  };
}

/** "Mon 3" style label for a YYYY-MM-DD day (UTC). */
export function dayLabel(day: string, short = false): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-GB", {
    timeZone: "UTC",
    ...(short ? { day: "numeric" } : { weekday: "short", day: "numeric", month: "short" }),
  });
}

/** Accessible one-sentence description of a day's bar. */
export function barDescription(bar: ChartBar): string {
  const parts = bar.segments.map((s) => `${s.value} ${OUTCOME_LABELS[s.outcome].toLowerCase()}`);
  return `${dayLabel(bar.day)}: ${bar.total} ${bar.total === 1 ? "search" : "searches"}${
    parts.length ? ` (${parts.join(", ")})` : ""
  }`;
}

/** Percentage (0..100) of a quota used, rounded down, never above 100. */
export function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.floor((used / limit) * 100));
}

/** Ids present in `next` but not in `previous`: the rows to highlight after a refresh. */
export function newRowIds(
  previous: readonly { id: number }[] | undefined,
  next: readonly { id: number }[],
): Set<number> {
  if (!previous) return new Set();
  const seen = new Set(previous.map((r) => r.id));
  return new Set(next.filter((r) => !seen.has(r.id)).map((r) => r.id));
}

/** Relative time for the feed: "just now", "4 min ago", "2 h ago", else a date. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Where the read-only case view lives (`/demo/admin/cases/...` inside the demo). */
export function adminCaseHref(pathname: string | null, caseId: string): string {
  const base = pathname?.startsWith("/demo") ? "/demo/admin" : "/admin";
  return `${base}/cases/${encodeURIComponent(caseId)}`;
}
