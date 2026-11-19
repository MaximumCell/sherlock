import { caseDisplayTitle, deriveCaseStatus, type DerivedCaseStatus } from "./case-status";
import type { CaseSummary } from "./data/types";

export const CASE_SORTS = ["updated", "created", "title", "findings"] as const;
export type CaseSort = (typeof CASE_SORTS)[number];

export interface CaseListQuery {
  q: string;
  tag: string | null;
  sort: CaseSort;
  showArchived: boolean;
}

export interface CaseRow extends CaseSummary {
  title: string;
  status: DerivedCaseStatus;
  updatedAt: string;
}

export function parseCaseListQuery(params: { get(name: string): string | null }): CaseListQuery {
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    tag: params.get("tag") || null,
    sort: (CASE_SORTS as readonly string[]).includes(sort ?? "") ? (sort as CaseSort) : "updated",
    showArchived: params.get("archived") === "1",
  };
}

export function toCaseRow(summary: CaseSummary): CaseRow {
  return {
    ...summary,
    title: caseDisplayTitle(summary.case),
    status: deriveCaseStatus(summary.case, summary.jobs, summary.pendingReviews),
    updatedAt: summary.case.updated_at ?? summary.case.created_at,
  };
}

export function allTags(summaries: readonly CaseSummary[]): string[] {
  return [...new Set(summaries.flatMap((s) => s.case.tags))].sort((a, b) => a.localeCompare(b));
}

/** Filter and sort the cases list. Archived cases are hidden unless asked for. */
export function selectCases(summaries: readonly CaseSummary[], query: CaseListQuery): CaseRow[] {
  const q = query.q.trim().toLowerCase();
  const rows = summaries
    .map(toCaseRow)
    .filter((row) => query.showArchived || row.status.kind !== "archived")
    .filter((row) => !query.tag || row.case.tags.includes(query.tag))
    .filter((row) => {
      if (!q) return true;
      const haystack = [
        row.title,
        ...row.case.tags,
        ...row.case.identifiers.map((i) => i.value),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });

  const compare: Record<CaseSort, (a: CaseRow, b: CaseRow) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.case.created_at.localeCompare(a.case.created_at),
    title: (a, b) => a.title.localeCompare(b.title),
    findings: (a, b) => b.foundCount - a.foundCount,
  };
  return rows.sort((a, b) => compare[query.sort](a, b) || a.case.id.localeCompare(b.case.id));
}
