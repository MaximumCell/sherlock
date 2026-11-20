/**
 * One identity per platform, whatever spelling a data source stored: "github", "Github",
 * "GitHub (User)" and a github.com profile URL are all the platform `github`, shown as
 * "GitHub". Backed by the gateway's `GET /platforms` registry (`sherlock_core.platforms`);
 * a snapshot of it is bundled so demo mode and a sleeping gateway resolve the same way.
 * The live list replaces the snapshot once `usePlatformRegistry` has fetched it.
 */
import snapshot from "./data/platforms-snapshot.json";

export const PLATFORM_CATEGORIES = [
  "social",
  "dev",
  "video",
  "music",
  "gaming",
  "forum",
  "shopping",
  "professional",
  "other",
] as const;
export type PlatformCategory = (typeof PLATFORM_CATEGORIES)[number];

/** One entry of `GET /platforms`. */
export interface PlatformEntry {
  key: string;
  label: string;
  domain: string;
  category: PlatformCategory;
  aliases: string[];
  hosts: string[];
}

export interface PlatformInfo {
  /** Canonical key ("github"); for unknown platforms the squashed name or the host. */
  key: string;
  label: string;
  domain: string;
  category: PlatformCategory;
  /** False when neither the registry nor the local table knows the platform. */
  known: boolean;
}

// squashed name -> canonical key, on top of the registry's own aliases
// (mirrors the alias table in sherlock_core/correlation/norm.py)
const LOCAL_ALIASES: Record<string, string> = {
  x: "twitter",
  xtwitter: "twitter",
  twitterx: "twitter",
  gh: "github",
  ig: "instagram",
  insta: "instagram",
  yt: "youtube",
  fb: "facebook",
  tg: "telegram",
  bsky: "bluesky",
  hn: "hackernews",
  ycombinator: "hackernews",
  devcommunity: "devto",
  npmjs: "npm",
  docker: "dockerhub",
  steamcommunity: "steam",
};

// Platforms some data sources report that the registry does not list.
const LOCAL_ENTRIES: PlatformEntry[] = [
  {
    key: "gitea",
    label: "Gitea",
    domain: "gitea.com",
    category: "dev",
    aliases: [],
    hosts: ["gitea.com"],
  },
  {
    key: "hudsonrock",
    label: "Hudson Rock",
    domain: "hudsonrock.com",
    category: "other",
    aliases: [],
    hosts: ["hudsonrock.com"],
  },
];

const QUALIFIERS =
  /\s*\([^)]*\)\s*|\b(?:user|users|username|channel|profile|profiles|account|organization|organisation|public|community)\b/gi;

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
const isCategory = (v: unknown): v is PlatformCategory =>
  typeof v === "string" && (PLATFORM_CATEGORIES as readonly string[]).includes(v);

/** Validates rows from `GET /platforms` (or the snapshot); malformed rows are dropped. */
export function toPlatformEntries(rows: unknown): PlatformEntry[] {
  if (!Array.isArray(rows)) return [];
  const strs = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  return rows.flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null) return [];
    const r = row as Record<string, unknown>;
    if (typeof r.key !== "string" || !r.key || typeof r.label !== "string") return [];
    return [
      {
        key: r.key,
        label: r.label || r.key,
        domain: typeof r.domain === "string" ? r.domain : "",
        category: isCategory(r.category) ? r.category : "other",
        aliases: strs(r.aliases),
        hosts: strs(r.hosts),
      },
    ];
  });
}

interface Registry {
  byKey: Map<string, PlatformEntry>;
  names: Map<string, string>;
  hosts: Map<string, string>;
}

function index(entries: readonly PlatformEntry[]): Registry {
  const byKey = new Map<string, PlatformEntry>();
  const names = new Map<string, string>();
  const hosts = new Map<string, string>();
  for (const e of [...entries, ...LOCAL_ENTRIES]) {
    if (byKey.has(e.key)) continue;
    byKey.set(e.key, e);
    for (const n of [e.key, e.label, ...e.aliases]) {
      const sq = squash(n);
      if (sq && !names.has(sq)) names.set(sq, e.key);
    }
    for (const h of [e.domain, ...e.hosts]) if (h && !hosts.has(h)) hosts.set(h, e.key);
  }
  for (const [alias, key] of Object.entries(LOCAL_ALIASES)) {
    if (byKey.has(key) && !names.has(alias)) names.set(alias, key);
  }
  return { byKey, names, hosts };
}

export const PLATFORM_SNAPSHOT: readonly PlatformEntry[] = toPlatformEntries(snapshot);
let registry = index(PLATFORM_SNAPSHOT);
let version = 0;
const listeners = new Set<() => void>();

/** Swap in the live registry (no-op for an empty list). */
export function installPlatforms(entries: readonly PlatformEntry[]): void {
  if (entries.length === 0) return;
  registry = index(entries);
  version += 1;
  listeners.forEach((l) => l());
}

/** For `useSyncExternalStore`: changes whenever a new registry is installed. */
export const platformRegistryVersion = () => version;
export function subscribePlatformRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function hostOf(value: string): string {
  const raw = value.trim();
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^(?:www|m|mobile)\./, "");
  } catch {
    return "";
  }
}

function byHost(host: string): string | null {
  let h = host;
  while (h.includes(".")) {
    const key = registry.hosts.get(h);
    if (key) return key;
    h = h.slice(h.indexOf(".") + 1);
  }
  return null;
}

const looksLikeHost = (raw: string) =>
  raw.includes("://") || /^(?:[\w-]+\.)+[a-z]{2,}(?:\/.*)?$/i.test(raw);

const info = (e: PlatformEntry): PlatformInfo => ({
  key: e.key,
  label: e.label,
  domain: e.domain,
  category: e.category,
  known: true,
});

/**
 * Platform for a stored name, a host or a profile URL. Unknown names keep the spelling
 * the source used (without "scraped:"); unknown hosts are shown as the host.
 */
export function resolvePlatform(name: string | null | undefined, url?: string | null): PlatformInfo {
  const trimmed = (name ?? "").trim();
  const raw = trimmed.toLowerCase().startsWith("scraped:") ? trimmed.slice(8).trim() : trimmed;
  const hostLike = looksLikeHost(raw);
  if (raw && !hostLike) {
    for (const candidate of [raw, raw.replace(QUALIFIERS, " ")]) {
      const key = registry.names.get(squash(candidate));
      const e = key ? registry.byKey.get(key) : undefined;
      if (e) return info(e);
    }
  }
  for (const value of [hostLike ? raw : "", url ?? ""]) {
    const host = value ? hostOf(value) : "";
    const key = host ? byHost(host) : null;
    const e = key ? registry.byKey.get(key) : undefined;
    if (e) return info(e);
  }
  if (hostLike || (!raw && url)) {
    const host = hostOf(hostLike ? raw : (url ?? "")) || raw;
    return { key: host, label: host, domain: host, category: "other", known: false };
  }
  const label = raw.replace(QUALIFIERS, " ").replace(/\s+/g, " ").trim() || raw;
  return { key: squash(raw), label, domain: "", category: "other", known: false };
}

/** Canonical platform id for comparing names: "GitHub", "github" and "gh" are all "github". */
export function canonicalPlatform(name: string): string {
  return resolvePlatform(name).key;
}

/** The one label shown for a platform. Unknown names keep the spelling the source used. */
export function platformLabel(name: string): string {
  const p = resolvePlatform(name);
  return p.known ? p.label : name.trim() || name;
}

/** Best label among several spellings of one platform: the known label, else the most deliberately capitalised. */
export function bestPlatformLabel(names: readonly string[]): string {
  const known = names.map((n) => resolvePlatform(n)).find((p) => p.known);
  if (known) return known.label;
  const caps = (s: string) => (s.match(/[A-Z]/g) ?? []).length;
  return [...names].sort((a, b) => caps(b) - caps(a) || a.localeCompare(b))[0] ?? "";
}
