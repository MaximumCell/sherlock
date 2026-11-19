"use client";

import { FolderSearch, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { allTags, parseCaseListQuery, selectCases } from "@/lib/case-list";
import { useCaseListRealtime, useCaseSummaries } from "@/lib/query/hooks";
import { useUrlState } from "@/lib/use-url-state";
import { CaseList } from "./case-list";
import { CasesToolbar } from "./cases-toolbar";
import { useNewInvestigation } from "./new-investigation-context";

export function CasesSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading cases">
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full" />
      ))}
    </div>
  );
}

export function CasesView() {
  const { params, set } = useUrlState();
  const { open } = useNewInvestigation();
  const cases = useCaseSummaries();
  useCaseListRealtime();

  const query = useMemo(() => parseCaseListQuery(params), [params]);
  const [resetKey, setResetKey] = useState(0);
  const summaries = cases.data;
  const rows = useMemo(() => selectCases(summaries ?? [], query), [summaries, query]);
  const tags = useMemo(() => allTags(summaries ?? []), [summaries]);
  const total = summaries?.length ?? 0;
  const archived = (summaries ?? []).filter((s) => s.case.archived_at).length;

  const newButton = (
    <Button onClick={() => open()}>
      <Plus aria-hidden />
      New investigation
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Cases"
        description="Each case starts from one identifier and grows as you pivot. Scans only read public sources."
        actions={newButton}
      />

      {cases.isPending ? (
        <CasesSkeleton />
      ) : cases.isError ? (
        <ErrorState title="Could not load your cases" error={cases.error} onRetry={() => void cases.refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={FolderSearch}
          title="No investigations yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {newButton}
              <Button variant="outline" asChild>
                <Link href="/demo">Explore the demo case</Link>
              </Button>
            </div>
          }
        >
          Start from a username, email, domain or another identifier. Results stream in live as
          each data source finishes.
        </EmptyState>
      ) : (
        <>
          <CasesToolbar key={resetKey} query={query} tags={tags} onChange={set} />
          {rows.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="No cases match"
              action={
                <Button
                  variant="outline"
                  onClick={() => {
                    setResetKey((k) => k + 1);
                    set({ q: null, tag: null, archived: null });
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              {archived > 0 && !query.showArchived
                ? `${archived} archived case${archived === 1 ? " is" : "s are"} hidden.`
                : "Try a different search or tag."}
            </EmptyState>
          ) : (
            <CaseList rows={rows} />
          )}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Showing {rows.length} of {total} case{total === 1 ? "" : "s"}
            {archived > 0 && !query.showArchived ? ` · ${archived} archived hidden` : ""}
          </p>
        </>
      )}
    </div>
  );
}
