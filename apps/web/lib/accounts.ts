/**
 * Findings presented as ACCOUNTS. The web never decides which rows are one account:
 * it follows the stored `same_account` correlations the engine wrote
 * (approved or pending = merged, rejected = split by the user). A found row that
 * is in no merge is an account (or item) on its own. Pure and framework-free.
 */
import { parseFinding, type FindingView } from "./findings";
import { bestPlatformLabel } from "./platforms";
import type { Correlation, EvidenceItem, Finding } from "./types";

export const SAME_ACCOUNT = "same_account";

export type AccountState = "single" | "merged" | "split";

export interface CaseAccount {
  /** `account_key` of the merge row, or `finding:<id>` for a single row. */
  key: string;
  label: string;
  handle: string | null;
  url: string | null;
  /** Primary (richest) finding first, then the rest by id. */
  findings: Finding[];
  primary: Finding;
  /** Distinct data sources (module ids), sorted. */
  sources: string[];
  /** Profile merged across the account's findings, primary first. */
  view: FindingView;
  state: AccountState;
  /** The `same_account` row behind a merged or split account. */
  merge: Correlation | null;
}

export interface AccountIndex {
  accounts: CaseAccount[];
  byFinding: Map<string, CaseAccount>;
}

export const isSameAccount = (c: Pick<Correlation, "type">): boolean => c.type === SAME_ACCOUNT;

/** Correlations that are real links between accounts (never automatic merges). */
export function linkRows<T extends Pick<Correlation, "type">>(correlations: readonly T[]): T[] {
  return correlations.filter((c) => !isSameAccount(c));
}

/** The plain-English reason stored with a merge (first evidence string). */
export function mergeReason(evidence: readonly EvidenceItem[]): string | null {
  const first = evidence.find((e): e is string => typeof e === "string");
  return first ?? null;
}

/**
 * The merge reason in plain words: the engine's "why" sentences (e.g. "The GitHub
 * profile kit publishes kit@example.net, and kit@example.net is registered on GitHub"),
 * without its bookkeeping sentence that lists module ids.
 */
export function mergeExplanation(
  evidence: readonly EvidenceItem[],
  label: string,
  handle: string | null,
): string {
  const summary = mergeReason(evidence) ?? "";
  const why = summary
    .split(/(?<=\.)\s+/)
    .filter((s) => s && !/^\d+ findings describe one /.test(s))
    .join(" ");
  return why || `Several sources report the same ${label} account${handle ? ` ${handle}` : ""}.`;
}

/** How much profile detail a finding carries (used to pick an account's primary row). */
export function richness(f: Finding): number {
  const v = parseFinding(f);
  return (
    (v.avatarUrl ? 6 : 0) +
    (v.fullname ? 5 : 0) +
    (v.bio ? 5 : 0) +
    (v.location ? 2 : 0) +
    (v.emails.length ? 4 : 0) +
    (v.links.length ? 3 : 0) +
    (v.createdAt ? 1 : 0) +
    (v.followers !== null ? 2 : 0)
  );
}

function mergedView(findings: readonly Finding[]): FindingView {
  const views = findings.map(parseFinding);
  const base = { ...views[0]! };
  for (const v of views.slice(1)) {
    base.url ??= v.url;
    base.fullname ??= v.fullname;
    base.bio ??= v.bio;
    base.location ??= v.location;
    base.avatarUrl ??= v.avatarUrl;
    base.createdAt ??= v.createdAt;
    base.followers ??= v.followers;
    base.following ??= v.following;
  }
  base.emails = [...new Set(views.flatMap((v) => v.emails))];
  base.links = [...new Set(views.flatMap((v) => v.links))];
  return base;
}

const sourceOf = (f: Finding) => f.module ?? f.source_tool;

function handleFromKey(key: string): string | null {
  const parts = key.split(":");
  return parts.length === 2 && parts[1] ? parts[1] : null;
}

function makeAccount(
  key: string,
  members: Finding[],
  state: AccountState,
  merge: Correlation | null,
): CaseAccount {
  const ordered = [...members].sort(
    (a, b) => richness(b) - richness(a) || a.id.localeCompare(b.id),
  );
  const primary = ordered[0]!;
  const view = mergedView(ordered);
  const single = primary.identifier_type === "username" ? primary.identifier_value : null;
  return {
    key,
    label: bestPlatformLabel(ordered.map((f) => f.platform)),
    handle: (state === "merged" ? handleFromKey(key) : null) ?? single,
    url: view.url,
    findings: ordered,
    primary,
    sources: [...new Set(ordered.map(sourceOf))].sort(),
    view,
    state,
    merge,
  };
}

/**
 * Accounts from the found rows and the stored `same_account` rows. Findings in a
 * merge the user split come back one account each (state "split").
 */
export function buildAccounts(
  findings: readonly Finding[],
  correlations: readonly Correlation[],
): AccountIndex {
  const found = new Map(findings.filter((f) => f.status === "found").map((f) => [f.id, f]));
  const byFinding = new Map<string, CaseAccount>();
  const accounts: CaseAccount[] = [];
  const merges = correlations
    .filter(isSameAccount)
    .sort((a, b) => (a.matched_value ?? a.id).localeCompare(b.matched_value ?? b.id));
  const splitOf = new Map<string, Correlation>();

  for (const m of merges) {
    const members = m.entities_involved
      .map((id) => found.get(id))
      .filter((f): f is Finding => f !== undefined && !byFinding.has(f.id));
    if (m.status === "rejected") {
      members.forEach((f) => splitOf.set(f.id, m));
      continue;
    }
    if (members.length === 0) continue;
    const acc = makeAccount(
      m.matched_value ?? m.id,
      members,
      members.length > 1 ? "merged" : "single",
      m,
    );
    accounts.push(acc);
    members.forEach((f) => byFinding.set(f.id, acc));
  }
  for (const f of found.values()) {
    if (byFinding.has(f.id)) continue;
    const split = splitOf.get(f.id) ?? null;
    const acc = makeAccount(`finding:${f.id}`, [f], split ? "split" : "single", split);
    accounts.push(acc);
    byFinding.set(f.id, acc);
  }
  return { accounts, byFinding };
}

/** The distinct accounts a link connects, in the order their findings are listed. */
export function accountsInLink(
  c: Pick<Correlation, "entities_involved">,
  index: AccountIndex,
): CaseAccount[] {
  const out: CaseAccount[] = [];
  for (const id of c.entities_involved) {
    const acc = index.byFinding.get(id);
    if (acc && !out.includes(acc)) out.push(acc);
  }
  return out;
}

/** "Confirmed by 3 sources" */
export function sourcesLine(acc: Pick<CaseAccount, "sources">): string {
  const n = acc.sources.length;
  return n === 1 ? "Found by 1 source" : `Confirmed by ${n} sources`;
}
