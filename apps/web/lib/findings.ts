import {
  STRUCTURED_EXTRA,
  STRUCTURED_META,
  flattenEntries,
  parseActivity,
  parseDns,
  parseImage,
  parseNetwork,
  parseWallet,
  type ActivityInfo,
  type DnsInfo,
  type ImageInfo,
  type NetworkInfo,
  type WalletInfo,
} from "./finding-extras";
import { platformLabel } from "./platforms";
import type { Finding, FindingStatus, JsonObject, JsonValue } from "./types";

export interface BreachInfo {
  name: string;
  date: string | null;
  dataClasses: string[];
}

/** Where profile details came from when not from an official API (`extra.preview`). */
export interface PreviewInfo {
  source: "page-meta" | "search-snippet";
  fetchedAt: string | null;
  /** The whole stored object, shown under Advanced. */
  raw: JsonObject;
}

export interface FindingView {
  url: string | null;
  category: string;
  fullname: string | null;
  bio: string | null;
  location: string | null;
  emails: string[];
  links: string[];
  avatarUrl: string | null;
  createdAt: string | null;
  followers: number | null;
  following: number | null;
  /** LinkedIn search results and person records. */
  headline: string | null;
  employer: string | null;
  education: string | null;
  snippet: string | null;
  preview: PreviewInfo | null;
  breach: BreachInfo | null;
  dns: DnsInfo | null;
  network: NetworkInfo | null;
  wallet: WalletInfo | null;
  image: ImageInfo | null;
  activity: ActivityInfo | null;
  error: string | null;
  /** Remaining scalar fields, for the generic key/value table. */
  other: [key: string, value: string][];
}

const str = (v: JsonValue | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
const int = (v: JsonValue | undefined): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Accepts a comma-separated string or an array of strings. */
export function splitList(v: JsonValue | undefined): string[] {
  const parts = Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string")
    : typeof v === "string"
      ? v.split(",")
      : [];
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
}

/** Only http(s) links are ever rendered as anchors. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("data:image/")) return value;
  return safeUrl(value);
}

function parsePreview(v: JsonValue | undefined): PreviewInfo | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const source = v.source;
  if (source !== "page-meta" && source !== "search-snippet") return null;
  return { source, fetchedAt: str(v.fetched_at), raw: v };
}

const KNOWN_EXTRA = new Set([
  "fullname",
  "bio",
  "location",
  "email",
  "emails",
  "links",
  "avatar_url",
  "created_at",
  "followers",
  "following",
  "headline",
  "employer",
  "company",
  "education",
  "snippet",
  "preview",
  "candidate_hint",
]);
const KNOWN_META = new Set([
  "url",
  "extra",
  "category",
  "breach_name",
  "breach_date",
  "data_classes",
  "error",
  "curated",
  "summary",
  // "could not be checked" rows (lib/unchecked.ts): shown as the error line, not as raw keys
  "unknown",
  "detail",
  "was",
]);

export const humanizeKey = (key: string): string => key.replace(/_/g, " ");

/** Normalise the free-form `extra_metadata` blob into the fields the UI knows how to render. */
export function parseFinding(f: Finding): FindingView {
  const meta = f.extra_metadata;
  const extra: JsonObject = meta.extra ?? {};
  const emails = [...new Set([...splitList(extra.email), ...splitList(extra.emails)])];
  const other: [string, string][] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (KNOWN_EXTRA.has(k) || STRUCTURED_EXTRA.has(k)) continue;
    flattenEntries(humanizeKey(k), v, other);
  }
  // FindingMetadata only differs from JsonObject by allowing undefined values
  const m = meta as JsonObject;
  const dns = parseDns(m);
  const network = parseNetwork(m, extra);
  const wallet = parseWallet(m, extra);
  const image = parseImage(m, extra);
  const activity = parseActivity(m);
  const owned = dns || network || wallet || image || activity;
  for (const [k, v] of Object.entries(meta)) {
    if (KNOWN_META.has(k) || (owned && STRUCTURED_META.has(k))) continue;
    if (k === "reason" && meta.unknown === true) continue;
    flattenEntries(humanizeKey(k), v, other);
  }
  const breachName = str(meta.breach_name);
  return {
    url: safeUrl(str(meta.url)),
    category: str(meta.category) ?? "other",
    fullname: str(extra.fullname),
    bio: str(extra.bio),
    location: str(extra.location),
    emails,
    links: splitList(extra.links),
    avatarUrl: safeImageUrl(str(extra.avatar_url)),
    createdAt: str(extra.created_at),
    followers: int(extra.followers),
    following: int(extra.following),
    headline: str(extra.headline),
    employer: str(extra.employer) ?? str(extra.company),
    education: str(extra.education),
    snippet: str(extra.snippet),
    preview: parsePreview(extra.preview),
    breach:
      f.platform === "breach" || breachName
        ? {
            name: breachName ?? "Unknown breach",
            date: str(meta.breach_date),
            dataClasses: splitList(meta.data_classes),
          }
        : null,
    dns,
    network,
    wallet,
    image,
    activity,
    error: str(meta.error) ?? (f.status === "error" ? str(meta.detail) : null),
    other,
  };
}

/** Short human label for a finding: breach name for breaches, otherwise the platform's one label. */
export function findingTitle(f: Finding): string {
  if (f.platform === "breach") {
    const name = f.extra_metadata.breach_name;
    return typeof name === "string" && name ? name : "Breach";
  }
  return platformLabel(f.platform);
}

export interface FindingFilters {
  query: string;
  module: string | null;
  platform: string | null;
  category: string | null;
  curatedOnly: boolean;
  /** When false only `found` rows are shown. */
  includeMisses: boolean;
  status: FindingStatus | null;
}

export const DEFAULT_FILTERS: FindingFilters = {
  query: "",
  module: null,
  platform: null,
  category: null,
  curatedOnly: false,
  includeMisses: false,
  status: null,
};

export const findingCategory = (f: Finding): string => {
  const c = f.extra_metadata.category;
  return typeof c === "string" && c ? c : "other";
};

export function filterFindings(findings: readonly Finding[], filters: FindingFilters): Finding[] {
  const q = filters.query.trim().toLowerCase();
  return findings.filter((f) => {
    if (!filters.includeMisses && f.status !== "found") return false;
    if (filters.status && f.status !== filters.status) return false;
    if (filters.curatedOnly && !f.curated) return false;
    if (filters.module && (f.module ?? f.source_tool) !== filters.module) return false;
    if (filters.platform && f.platform !== filters.platform) return false;
    if (filters.category && findingCategory(f) !== filters.category) return false;
    if (!q) return true;
    const haystack = [
      f.platform,
      f.identifier_value,
      f.module ?? "",
      findingTitle(f),
      JSON.stringify(f.extra_metadata.extra ?? {}),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export interface Facet {
  value: string;
  count: number;
}

export function facet(findings: readonly Finding[], key: (f: Finding) => string): Facet[] {
  const counts = new Map<string, number>();
  for (const f of findings) counts.set(key(f), (counts.get(key(f)) ?? 0) + 1);
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export interface CaseStats {
  accountsFound: number;
  platformsChecked: number;
  breaches: number;
  linkedIdentities: number;
  pendingReviews: number;
}

const ACCOUNT_ID_TYPES = new Set(["username", "email", "name", "phone"]);

export function computeStats(
  findings: readonly Finding[],
  allCorrelations: readonly { status: string; type?: string; entities_involved: string[] }[],
): CaseStats {
  // automatic `same_account` merges are not links between accounts
  const correlations = allCorrelations.filter((c) => c.type !== "same_account");
  const found = findings.filter((f) => f.status === "found");
  const breaches = found.filter((f) => f.platform === "breach").length;
  const linked = new Set<string>();
  for (const c of correlations) {
    if (c.status === "approved") c.entities_involved.forEach((id) => linked.add(id));
  }
  return {
    accountsFound: found.filter(
      (f) => f.platform !== "breach" && ACCOUNT_ID_TYPES.has(f.identifier_type),
    ).length,
    platformsChecked: new Set(findings.map((f) => `${f.module ?? f.source_tool}|${f.platform}`))
      .size,
    breaches,
    linkedIdentities: linked.size,
    pendingReviews: correlations.filter((c) => c.status === "pending").length,
  };
}
