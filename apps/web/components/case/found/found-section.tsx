"use client";

import { ChevronDown, ListFilter, Pin, SearchCheck } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { groupFindings, type FindingGroup } from "@/lib/finding-groups";
import { useCurate } from "@/lib/query/mutations";
import type { Correlation, Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { CaseSection } from "../section";
import { ResultCard } from "./result-card";
import { CLEAR_RESULT_FILTERS, ResultsExplorer } from "./results-explorer";

const HIGHLIGHTS = 6;
const FILTER_KEYS = ["results", "q", "group", "module", "platform", "category", "curated", "misses", "show", "page"];

function GroupBlock({
  group,
  onShowAll,
  onOpen,
  onPin,
}: {
  group: FindingGroup;
  onShowAll: () => void;
  onOpen: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}) {
  const shown = group.items.slice(0, HIGHLIGHTS);
  return (
    <section aria-labelledby={`group-${group.id}`} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`group-${group.id}`} className="text-lg font-semibold">
            {group.title}
            <span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{group.items.length}</span>
          </h3>
          <p className="text-sm text-muted-foreground">{group.description}</p>
        </div>
        {group.items.length > HIGHLIGHTS || group.misses > 0 ? (
          <Button variant="ghost" size="sm" onClick={onShowAll}>
            Show all {group.items.length + group.misses}
            <ChevronDown aria-hidden />
          </Button>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((f) => (
          <ResultCard key={f.id} finding={f} onOpen={() => onOpen(f.id)} onPin={(p) => onPin(f.id, p)} />
        ))}
      </ul>
    </section>
  );
}

/** Results grouped into human categories, with the full filterable list one click away. */
export function FoundSection({
  caseId,
  findings,
  correlations,
  loading,
  error,
  onRetry,
  scanning,
}: {
  caseId: string;
  findings: Finding[];
  correlations: Correlation[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  scanning: boolean;
}) {
  const { params, set } = useUrlState();
  const curate = useCurate(caseId);
  const groups = useMemo(() => groupFindings(findings, correlations), [findings, correlations]);
  const explorerOpen = FILTER_KEYS.some((k) => params.get(k));
  const pinned = findings.filter((f) => f.curated).length;
  const found = findings.filter((f) => f.status === "found").length;

  const openExplorer = (patch: Record<string, string | null> = {}) => {
    set({ ...CLEAR_RESULT_FILTERS, results: "1", ...patch });
    requestAnimationFrame(() => document.getElementById("all-results")?.scrollIntoView({ block: "start" }));
  };

  return (
    <CaseSection
      id="found"
      title="What we found"
      description={
        found
          ? `${found} public result${found === 1 ? "" : "s"}, grouped by kind. Open any card for every detail, or pin the ones that matter.`
          : undefined
      }
      actions={
        findings.length ? (
          <>
            {pinned ? (
              <Button variant="outline" size="sm" onClick={() => openExplorer({ curated: "1" })}>
                <Pin aria-hidden />
                {pinned} pinned
              </Button>
            ) : null}
            <Button
              variant={explorerOpen ? "secondary" : "outline"}
              size="sm"
              aria-expanded={explorerOpen}
              onClick={() => (explorerOpen ? set(CLEAR_RESULT_FILTERS) : openExplorer())}
            >
              <ListFilter aria-hidden />
              {explorerOpen ? "Hide full list" : "Browse all results"}
            </Button>
          </>
        ) : null
      }
    >
      {error ? (
        <ErrorState title="Could not load the results" error={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : findings.length === 0 ? (
        <EmptyState icon={SearchCheck} title={scanning ? "Results are on their way" : "No results yet"}>
          {scanning
            ? "Each data source adds its results here as soon as it finishes. Watch Scan progress above."
            : "Results appear here after a search. Use Add another target in the menu above to start one."}
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {explorerOpen ? <ResultsExplorer caseId={caseId} findings={findings} /> : null}
          <div className={cn("space-y-10", explorerOpen && "border-t border-border pt-8")}>
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every source finished without a public result. Browse all results to see what was
                checked.
              </p>
            ) : (
              groups.map((g) => (
                <GroupBlock
                  key={g.id}
                  group={g}
                  onShowAll={() => openExplorer({ group: g.id, show: g.misses && g.items.length <= HIGHLIGHTS ? "all" : null })}
                  onOpen={(id) => set({ finding: id })}
                  onPin={(id, p) => curate.mutate({ findingId: id, curated: p })}
                />
              ))
            )}
          </div>
        </div>
      )}
    </CaseSection>
  );
}
