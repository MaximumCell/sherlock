/**
 * The person behind an account, for the result cards: how much profile detail it has,
 * which platform to badge it with, where the details came from, and the distinct profile
 * pictures of a case. Pure and framework-free.
 */
import type { CaseAccount } from "./accounts";
import type { FindingView, PreviewInfo } from "./findings";
import { resolvePlatform } from "./platforms";
import type { Finding } from "./types";

/** Rows about an image rather than an account say which platform the picture is from. */
const IMAGE_PLATFORMS = new Set(["avatar", "image"]);

/** Platform name to badge a finding with ("avatar" rows: the platform the picture is from). */
export function findingPlatform(f: Pick<Finding, "platform" | "extra_metadata">): string {
  if (IMAGE_PLATFORMS.has(f.platform.toLowerCase())) {
    const from = f.extra_metadata.extra?.source_platform;
    if (typeof from === "string" && from.trim()) return from.trim();
  }
  return f.platform;
}

export const accountPlatform = (acc: Pick<CaseAccount, "primary">): string =>
  findingPlatform(acc.primary);

/** 2: a picture or a name; 1: some other public detail; 0: only "the account exists". */
export type ProfileLevel = 0 | 1 | 2;

export function profileLevel(view: FindingView): ProfileLevel {
  if (view.avatarUrl || view.fullname) return 2;
  if (
    view.bio ||
    view.headline ||
    view.location ||
    view.createdAt ||
    view.followers !== null ||
    view.links.length ||
    view.emails.length ||
    view.snippet
  )
    return 1;
  return 0;
}

export const isBareAccount = (acc: Pick<CaseAccount, "view">): boolean =>
  profileLevel(acc.view) === 0;

/**
 * Accounts with a picture or name first, then those with some detail, then bare ones;
 * the incoming order (most informative first) is kept inside each level.
 */
export function sortRichFirst<T extends Pick<CaseAccount, "view">>(accounts: readonly T[]): T[] {
  return accounts
    .map((a, i) => ({ a, i, level: profileLevel(a.view) }))
    .sort((x, y) => y.level - x.level || x.i - y.i)
    .map((x) => x.a);
}

export interface ProvenanceLabel {
  label: string;
  tooltip: string;
}

export const LINKEDIN_PROVENANCE = "From search results — LinkedIn does not allow direct lookups";

/** The short label for profile details that did not come from an official API, or null. */
export function provenanceLabel(
  preview: Pick<PreviewInfo, "source"> | null,
  platform?: string | null,
): ProvenanceLabel | null {
  if (!preview) return null;
  if (preview.source === "search-snippet") {
    const linkedin = platform ? resolvePlatform(platform).key === "linkedin" : false;
    return {
      label: linkedin ? LINKEDIN_PROVENANCE : "From search results",
      tooltip:
        "Taken from what a public web search shows for this profile (title, snippet and sometimes a picture). The site itself was not visited, so details can be out of date.",
    };
  }
  return {
    label: "From the public profile page",
    tooltip:
      "Read from the preview the public profile page shows anyone (name, picture, description), the same data a link preview uses. Not from an official API, and nothing behind a login.",
  };
}

export interface Face {
  url: string;
  account: CaseAccount;
  platform: string;
  name: string;
}

/**
 * The distinct profile pictures found, at most `max`: the same image URL, or the same
 * stored image fingerprint, counts once. Accounts are taken in the order given.
 */
export function distinctFaces(accounts: readonly CaseAccount[], max = 12): Face[] {
  const seenUrls = new Set<string>();
  const seenHashes = new Set<string>();
  const out: Face[] = [];
  for (const acc of accounts) {
    const url = acc.view.avatarUrl;
    if (!url || seenUrls.has(url)) continue;
    const hashes = acc.findings
      .map((f) => f.extra_metadata.extra?.avatar_phash)
      .filter((h): h is string => typeof h === "string" && h !== "");
    if (hashes.some((h) => seenHashes.has(h))) continue;
    seenUrls.add(url);
    hashes.forEach((h) => seenHashes.add(h));
    const platform = accountPlatform(acc);
    out.push({
      url,
      account: acc,
      platform,
      name: acc.view.fullname ?? acc.handle ?? resolvePlatform(platform).label,
    });
    if (out.length >= max) break;
  }
  return out;
}

/** Display handle: "@ada" for a username, the value as is otherwise. */
export function displayHandle(acc: Pick<CaseAccount, "handle" | "primary">): string {
  const value = acc.handle ?? acc.primary.identifier_value;
  return acc.primary.identifier_type === "username" && !value.startsWith("@") ? `@${value}` : value;
}
