/**
 * Groups raw findings into the human categories shown under "What we found".
 * Pure: the UI decides how many highlights to show and how to render them.
 */
import { findingCategory, parseFinding } from "./findings";
import type { Correlation, Finding } from "./types";

export const FINDING_GROUP_IDS = [
  "accounts",
  "breaches",
  "web",
  "images",
  "activity",
  "phone",
  "wallet",
  "names",
  "other",
] as const;
export type FindingGroupId = (typeof FINDING_GROUP_IDS)[number];

export const FINDING_GROUP_META: Record<FindingGroupId, { title: string; description: string }> = {
  accounts: {
    title: "Accounts & profiles",
    description: "Public profiles and sign-ups that use this identifier.",
  },
  breaches: {
    title: "Data breaches",
    description: "Breach listings that mention it. Names and dates only, never the leaked data.",
  },
  web: {
    title: "Websites & servers",
    description: "DNS, certificates, open ports, registration records and archived pages.",
  },
  images: { title: "Images", description: "File details and visual fingerprints of images." },
  activity: {
    title: "Activity patterns",
    description: "When the account tends to post, from public timestamps.",
  },
  phone: { title: "Phone", description: "What the number itself reveals: country, carrier, type." },
  wallet: { title: "Wallet", description: "Public blockchain activity for the address." },
  names: { title: "Name search results", description: "Public pages that mention the name." },
  other: { title: "Other", description: "Results that do not fit the groups above." },
};

const WEB_CATEGORIES = new Set(["dns", "certificate", "network", "registration", "archive"]);

export function isFindingGroupId(value: string | null | undefined): value is FindingGroupId {
  return (FINDING_GROUP_IDS as readonly string[]).includes(value ?? "");
}

/** Which human group one finding belongs to. */
export function groupOf(f: Finding): FindingGroupId {
  const category = findingCategory(f);
  const type = f.identifier_type;
  if (f.platform === "breach" || category === "breach") return "breaches";
  if (category === "activity") return "activity";
  if (type === "wallet" || category === "wallet") return "wallet";
  if (type === "phone" || category === "telephony") return "phone";
  if (type === "image" || category === "media") return "images";
  if (type === "domain" || type === "ip" || WEB_CATEGORIES.has(category)) return "web";
  if (type === "name") return "names";
  if (type === "username" || type === "email") return "accounts";
  return "other";
}

/**
 * How informative a finding is as a highlight card: pinned first, then rows that
 * take part in links, then rows with more profile detail.
 */
export function highlightScore(f: Finding, linked: ReadonlySet<string> = new Set()): number {
  if (f.status !== "found") return -1;
  const v = parseFinding(f);
  let score = 0;
  if (f.curated) score += 100;
  if (linked.has(f.id)) score += 40;
  if (v.avatarUrl) score += 6;
  if (v.fullname) score += 5;
  if (v.bio) score += 5;
  if (v.location) score += 2;
  if (v.emails.length) score += 4;
  if (v.links.length) score += 3;
  if (v.followers !== null) score += 2;
  if (v.breach) score += 8 + v.breach.dataClasses.length;
  if (v.network) score += 6 + v.network.vulns.length * 2;
  if (v.dns || v.wallet || v.image || v.activity) score += 6;
  if (v.image?.gpsPresent) score += 10;
  return score;
}

export interface FindingGroup {
  id: FindingGroupId;
  title: string;
  description: string;
  /** Found rows, most informative first. */
  items: Finding[];
  /** Not-found and error rows that belong here (shown only in the full list). */
  misses: number;
}

/** Non-empty groups in display order. Only `found` rows count; misses are tallied. */
export function groupFindings(
  findings: readonly Finding[],
  correlations: readonly Pick<Correlation, "entities_involved" | "status">[] = [],
): FindingGroup[] {
  const linked = new Set<string>();
  for (const c of correlations) {
    if (c.status !== "rejected") c.entities_involved.forEach((id) => linked.add(id));
  }
  const buckets = new Map<FindingGroupId, { items: Finding[]; misses: number }>();
  for (const f of findings) {
    const id = groupOf(f);
    const bucket = buckets.get(id) ?? { items: [], misses: 0 };
    if (f.status === "found") bucket.items.push(f);
    else bucket.misses += 1;
    buckets.set(id, bucket);
  }
  return FINDING_GROUP_IDS.flatMap((id) => {
    const bucket = buckets.get(id);
    if (!bucket || bucket.items.length === 0) return [];
    const items = [...bucket.items].sort(
      (a, b) =>
        highlightScore(b, linked) - highlightScore(a, linked) ||
        a.platform.localeCompare(b.platform),
    );
    return [{ id, ...FINDING_GROUP_META[id], items, misses: bucket.misses }];
  });
}

/**
 * Accounts and profiles found: the single definition behind the Summary tile, the summary
 * sentence and the "Accounts & profiles" group heading.
 */
export function countAccounts(findings: readonly Finding[]): number {
  return findings.filter((f) => f.status === "found" && groupOf(f) === "accounts").length;
}

/** Label of a group's expander: the heading count, with not-found rows named explicitly. */
export function showAllLabel(group: Pick<FindingGroup, "items" | "misses">): string {
  const found = group.items.length;
  return group.misses > 0
    ? `Show all · ${found} found · ${group.misses} not found`
    : `Show all ${found}`;
}
