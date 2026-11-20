/**
 * Follow-up searches: where a suggestion came from, and what a finished one added.
 * Pure: works on rows already loaded by the page.
 */
import type { AccountIndex } from "./accounts";
import { groupOf } from "./finding-groups";
import { findingTitle } from "./findings";
import type { Entity, Finding, Job } from "./types";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Shown on the GitHub profile kitewright" */
export function suggestionSource(
  entity: Pick<Entity, "source_finding_id" | "platform">,
  findings: ReadonlyMap<string, Finding>,
  index: AccountIndex,
): string | null {
  const source = entity.source_finding_id ? findings.get(entity.source_finding_id) : undefined;
  if (source) {
    const acc = index.byFinding.get(source.id);
    if (acc && groupOf(acc.primary) === "accounts") {
      return `Shown on the ${acc.label} profile${acc.handle ? ` ${acc.handle}` : ""}`;
    }
    return `Shown in your ${findingTitle(source)} result`;
  }
  return entity.platform ? `Shown on ${entity.platform}` : null;
}

export interface FollowUpOutcome {
  state: "running" | "done";
  newResults: number;
  /** Accounts this search added to, that other searches had already found. */
  confirms: number;
  text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Outcome of the search for one identifier: "2 new results · 1 confirms an account you
 * already have". `null` when it was never searched.
 */
export function followUpOutcome(
  target: { kind: string; value: string },
  jobs: readonly Job[],
  findings: readonly Finding[],
  index: AccountIndex,
  /** false for an identifier that was typed in: its results are not "new". */
  followUp = true,
): FollowUpOutcome | null {
  const mine = jobs.filter(
    (j) => j.target_type === target.kind && same(j.target_value, target.value),
  );
  if (mine.length === 0) return null;
  if (mine.some((j) => j.status === "queued" || j.status === "running")) {
    return { state: "running", newResults: 0, confirms: 0, text: "Searching now" };
  }
  const results = findings.filter(
    (f) =>
      f.status === "found" &&
      f.identifier_type === target.kind &&
      same(f.identifier_value, target.value) &&
      f.extra_metadata.summary !== true,
  );
  const confirmed = new Set<string>();
  for (const f of results) {
    const acc = index.byFinding.get(f.id);
    const elsewhere = acc?.findings.some(
      (m) => !(m.identifier_type === target.kind && same(m.identifier_value, target.value)),
    );
    if (acc && elsewhere) confirmed.add(acc.key);
  }
  const confirms = confirmed.size;
  const word = followUp ? "new result" : "result";
  const head = results.length ? plural(results.length, word) : `No ${word}s`;
  const tail = confirms
    ? ` · ${confirms} ${confirms === 1 ? "confirms an account" : "confirm accounts"} you already have`
    : "";
  return { state: "done", newResults: results.length, confirms, text: head + tail };
}
