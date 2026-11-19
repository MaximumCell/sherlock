"use client";

import { SearchX } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { groupOf, isFindingGroupId } from "@/lib/finding-groups";
import { facet, filterFindings, findingCategory, type FindingFilters } from "@/lib/findings";
import { useAdvanced } from "@/lib/preferences";
import { useModules } from "@/lib/query/hooks";
import { useCurate } from "@/lib/query/mutations";
import { sourceTitle } from "@/lib/sources";
import type { Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { ResultsFilters, type ResultFilterState, type ResultStatusFilter } from "./results-filters";
import { ResultsTable } from "./results-table";

export const PAGE_SIZE = 25;
const SHOWS: ResultStatusFilter[] = ["found", "all", "not_found", "error"];

/** Filter state from the URL. `misses=1` (old links) means "everything checked". */
export function parseResultFilters(params: {
  get(name: string): string | null;
}): ResultFilterState {
  const show = params.get("show");
  const group = params.get("group");
  return {
    query: params.get("q") ?? "",
    group: isFindingGroupId(group) ? group : null,
    module: params.get("module") || null,
    platform: params.get("platform") || null,
    category: params.get("category") || null,
    pinnedOnly: params.get("curated") === "1",
    show: SHOWS.includes(show as ResultStatusFilter)
      ? (show as ResultStatusFilter)
      : params.get("misses") === "1"
        ? "all"
        : "found",
  };
}

export const CLEAR_RESULT_FILTERS = {
  q: null,
  group: null,
  module: null,
  platform: null,
  category: null,
  curated: null,
  misses: null,
  show: null,
  page: null,
};

function toFindingFilters(f: ResultFilterState): FindingFilters {
  return {
    query: f.query,
    module: f.module,
    platform: f.platform,
    category: f.category,
    curatedOnly: f.pinnedOnly,
    includeMisses: f.show !== "found",
    status: f.show === "not_found" || f.show === "error" ? f.show : null,
  };
}

/** The complete, searchable list of everything checked, with the detail sheet one click away. */
export function ResultsExplorer({ caseId, findings }: { caseId: string; findings: Finding[] }) {
  const { params, set } = useUrlState();
  const curate = useCurate(caseId);
  const catalogue = useModules();
  const [advanced] = useAdvanced();
  const filters = useMemo(() => parseResultFilters(params), [params]);
  const [resetKey, setResetKey] = useState(0);
  const label = (name: string) => sourceTitle(name, catalogue.data?.modules);

  const inGroup = useMemo(
    () => (filters.group ? findings.filter((f) => groupOf(f) === filters.group) : findings),
    [findings, filters.group],
  );
  const facets = useMemo(() => {
    const scope = inGroup.filter((f) => filters.show !== "found" || f.status === "found");
    return {
      modules: facet(scope, (f) => f.module ?? f.source_tool),
      platforms: facet(scope, (f) => f.platform),
      categories: facet(scope, findingCategory),
    };
  }, [inGroup, filters.show]);
  const counts = useMemo<Record<ResultStatusFilter, number>>(
    () => ({
      found: inGroup.filter((f) => f.status === "found").length,
      all: inGroup.length,
      not_found: inGroup.filter((f) => f.status === "not_found").length,
      error: inGroup.filter((f) => f.status === "error").length,
    }),
    [inGroup],
  );
  const rows = useMemo(
    () =>
      filterFindings(inGroup, toFindingFilters(filters)).sort(
        (a, b) =>
          Number(b.curated) - Number(a.curated) ||
          a.status.localeCompare(b.status) ||
          a.platform.localeCompare(b.platform),
      ),
    [inGroup, filters],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number(params.get("page")) || 1));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const clear = () => {
    setResetKey((k) => k + 1);
    set({ ...CLEAR_RESULT_FILTERS, results: "1" });
  };

  return (
    <div id="all-results" className="scroll-mt-36 space-y-3">
      <ResultsFilters
        key={resetKey}
        filters={filters}
        facets={facets}
        counts={counts}
        sourceLabel={label}
        onChange={(patch) => set({ ...patch, page: null, results: "1" })}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="Nothing matches these filters"
          action={
            <Button variant="outline" onClick={clear}>
              Clear filters
            </Button>
          }
        >
          Try fewer filters, or switch to Everything checked to include sources that found nothing.
        </EmptyState>
      ) : (
        <ResultsTable
          rows={pageRows}
          sourceLabel={label}
          advanced={advanced}
          onOpen={(id) => set({ finding: id })}
          onCurate={(id, curated) => curate.mutate({ findingId: id, curated })}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p aria-live="polite">
          {rows.length} of {inGroup.length} {filters.group ? "in this group" : "checked"}
          {rows.length > PAGE_SIZE ? ` · page ${page} of ${pageCount}` : ""}
        </p>
        {pageCount > 1 ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => set({ page: page - 1 <= 1 ? null : String(page - 1) })}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => set({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
