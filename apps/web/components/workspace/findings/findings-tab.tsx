"use client";

import { SearchX, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { facet, filterFindings, findingCategory, type FindingFilters } from "@/lib/findings";
import { useFindings } from "@/lib/query/hooks";
import { useCurate } from "@/lib/query/mutations";
import { useUrlState } from "@/lib/use-url-state";
import { FindingsFilters } from "./findings-filters";
import { FindingsTable } from "./findings-table";

export const PAGE_SIZE = 25;

export function parseFindingFilters(params: { get(name: string): string | null }): FindingFilters {
  return {
    query: params.get("q") ?? "",
    module: params.get("module") || null,
    platform: params.get("platform") || null,
    category: params.get("category") || null,
    curatedOnly: params.get("curated") === "1",
    includeMisses: params.get("misses") === "1",
    status: null,
  };
}

const CLEAR = { q: null, module: null, platform: null, category: null, curated: null, misses: null, page: null };

export function FindingsTab({ caseId }: { caseId: string }) {
  const { params, set } = useUrlState();
  const findings = useFindings(caseId);
  const curate = useCurate(caseId);
  const filters = useMemo(() => parseFindingFilters(params), [params]);
  const [resetKey, setResetKey] = useState(0);
  const clear = () => {
    setResetKey((k) => k + 1);
    set(CLEAR);
  };
  const all = findings.data;

  const facets = useMemo(() => {
    const scope = (all ?? []).filter((f) => filters.includeMisses || f.status === "found");
    return {
      modules: facet(scope, (f) => f.module ?? f.source_tool),
      platforms: facet(scope, (f) => f.platform),
      categories: facet(scope, findingCategory),
    };
  }, [all, filters.includeMisses]);

  const rows = useMemo(
    () =>
      filterFindings(all ?? [], filters).sort(
        (a, b) =>
          Number(b.curated) - Number(a.curated) ||
          a.status.localeCompare(b.status) ||
          a.platform.localeCompare(b.platform),
      ),
    [all, filters],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number(params.get("page")) || 1));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (findings.isError) {
    return <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />;
  }
  if (findings.isPending) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if ((all ?? []).length === 0) {
    return (
      <EmptyState icon={Table2} title="No findings yet">
        Findings appear here live as each module finishes. Start a scan from the Overview tab.
      </EmptyState>
    );
  }

  const hiddenMisses = (all ?? []).filter((f) => f.status !== "found").length;

  return (
    <div className="space-y-3">
      <FindingsFilters
        key={resetKey}
        filters={filters}
        facets={facets}
        hiddenMisses={hiddenMisses}
        onChange={(patch) => set({ ...patch, page: null })}
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No findings match these filters"
          action={
            <Button variant="outline" onClick={clear}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <FindingsTable
          rows={pageRows}
          onOpen={(id) => set({ finding: id })}
          onCurate={(id, curated) => curate.mutate({ findingId: id, curated })}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p aria-live="polite">
          {rows.length} of {(all ?? []).length} findings
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
