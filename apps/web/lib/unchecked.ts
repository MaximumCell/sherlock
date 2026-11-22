/**
 * "Couldn't check automatically": sites a search could not answer for (login walls, blocks,
 * rate limits, pages that did not clearly say). Stored as `status = "error"` rows with
 * `extra_metadata.reason` in UNKNOWN_REASONS (see docs/CONTRACTS.md, "Unknown results").
 * They are never accounts: counts, links and the score use found rows only.
 */
import { safeUrl } from "./findings";
import { platformLabel, resolvePlatform } from "./platforms";
import type { Finding } from "./types";

export const UNKNOWN_REASONS = [
  "login_wall",
  "blocked",
  "rate_limited",
  "ambiguous",
  "rule_disabled",
] as const;
export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

const isReason = (v: unknown): v is UnknownReason =>
  typeof v === "string" && (UNKNOWN_REASONS as readonly string[]).includes(v);

/** True for a "could not be checked" row (not a plain error, not a coverage summary). */
export function isUnknownFinding(f: Pick<Finding, "status" | "extra_metadata">): boolean {
  const m = f.extra_metadata;
  return f.status === "error" && m.summary !== true && (m.unknown === true || isReason(m.reason));
}

/** The reason in plain words, e.g. "Instagram only shows profiles to signed-in users". */
export function uncheckedReasonText(reason: UnknownReason, label: string): string {
  switch (reason) {
    case "login_wall":
      return `${label} only shows profiles to signed-in users`;
    case "blocked":
      return `${label} turned away our automatic check`;
    case "rate_limited":
      return `${label} asked us to slow down before it answered`;
    case "ambiguous":
      return `The ${label} page did not clearly show whether this profile exists`;
    case "rule_disabled":
      return `Our check for ${label} no longer gives reliable answers`;
  }
}

export interface UncheckedSite {
  /** Canonical platform key (one entry per platform). */
  key: string;
  /** Platform name as stored, for the icon. */
  platform: string;
  label: string;
  /** The exact profile URL to open by hand, when known. */
  url: string | null;
  reason: UnknownReason;
  text: string;
  /** What was looked up, e.g. the username. */
  identifier: string;
  findingId: string;
}

/** Walls first (the person can open those), then blocks, then the rest; well-known platforms first. */
const REASON_ORDER: Record<UnknownReason, number> = {
  login_wall: 0,
  ambiguous: 1,
  blocked: 2,
  rate_limited: 3,
  rule_disabled: 4,
};

/**
 * One entry per platform that could not be checked, leaving out platforms where any
 * source found an account (a found result beats a "could not check").
 */
export function uncheckedSites(findings: readonly Finding[]): UncheckedSite[] {
  const foundKeys = new Set(
    findings.filter((f) => f.status === "found").map((f) => resolvePlatform(f.platform).key),
  );
  const out = new Map<string, UncheckedSite>();
  for (const f of findings) {
    if (!isUnknownFinding(f)) continue;
    const info = resolvePlatform(f.platform, null);
    if (foundKeys.has(info.key)) continue;
    const reason = isReason(f.extra_metadata.reason) ? f.extra_metadata.reason : "blocked";
    const url = typeof f.extra_metadata.url === "string" ? safeUrl(f.extra_metadata.url) : null;
    const label = platformLabel(f.platform);
    const prev = out.get(info.key);
    if (prev && REASON_ORDER[prev.reason] <= REASON_ORDER[reason] && (prev.url || !url)) continue;
    out.set(info.key, {
      key: info.key,
      platform: f.platform,
      label,
      url: url ?? prev?.url ?? null,
      reason,
      text: uncheckedReasonText(reason, label),
      identifier: f.identifier_value,
      findingId: f.id,
    });
  }
  return [...out.values()].sort(
    (a, b) =>
      REASON_ORDER[a.reason] - REASON_ORDER[b.reason] ||
      Number(!resolvePlatform(a.platform).known) - Number(!resolvePlatform(b.platform).known) ||
      a.label.localeCompare(b.label),
  );
}

/** Distinct platforms with a found result (for "Found on 12 sites"). */
export function foundSiteCount(findings: readonly Finding[]): number {
  return new Set(
    findings
      .filter((f) => f.status === "found" && f.extra_metadata.summary !== true)
      .map((f) => resolvePlatform(f.platform).key),
  ).size;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Found on 12 sites · 4 couldn't be checked" (the second part only when there are any). */
export function coverageText(found: number, unchecked: number): string {
  const head = `Found on ${plural(found, "site")}`;
  return unchecked ? `${head} · ${unchecked} couldn't be checked` : head;
}
