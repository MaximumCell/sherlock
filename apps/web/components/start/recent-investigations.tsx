"use client";

import { SearchX, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CasesToolbar } from "@/components/cases/cases-toolbar";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { allTags, parseCaseListQuery, selectCases } from "@/lib/case-list";
import type { CaseSummary } from "@/lib/data/types";
import { useUrlState } from "@/lib/use-url-state";
import { InvestigationCard } from "./investigation-card";

export function RecentSkeleton() {
  return (
    <ul
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      aria-busy="true"
      aria-label="Loading investigations"
    >
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-36 rounded-xl" />
      ))}
    </ul>
  );
}

/** Recent investigations as cards; search, tag, sort and archived sit behind one button. */
export function RecentInvestigations({
  summaries,
  pending,
  error,
  onRetry,
}: {
  summaries: CaseSummary[] | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const { params, set } = useUrlState();
  const query = useMemo(() => parseCaseListQuery(params), [params]);
  const filtering = Boolean(query.q || query.tag || query.showArchived || query.sort !== "updated");
  const [open, setOpen] = useState(filtering);
  const [resetKey, setResetKey] = useState(0);
  const rows = useMemo(() => selectCases(summaries ?? [], query), [summaries, query]);
  const tags = useMemo(() => allTags(summaries ?? []), [summaries]);
  const total = summaries?.length ?? 0;
  const archived = (summaries ?? []).filter((s) => s.case.archived_at).length;

  const clear = () => {
    setResetKey((k) => k + 1);
    set({ q: null, tag: null, archived: null, sort: null });
  };

  if (pending) return <RecentSkeleton />;
  if (error)
    return (
      <ErrorState title="Could not load your investigations" error={error} onRetry={onRetry} />
    );
  if (total === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        Your investigations appear here after your first search. Nothing yet? Open the{" "}
        <Link href="/demo" className="font-medium text-accent hover:underline">
          demo investigation
        </Link>{" "}
        to see a finished one.
      </p>
    );
  }

  return (
    <section aria-labelledby="recent-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="recent-title" className="text-lg font-semibold">
          Recent investigations
          <span className="ml-2 text-sm font-normal text-muted-foreground">{total}</span>
        </h2>
        <Button
          variant={open ? "secondary" : "ghost"}
          size="sm"
          aria-expanded={open}
          aria-controls="recent-filters"
          onClick={() => setOpen((v) => !v)}
        >
          <SlidersHorizontal aria-hidden />
          Search and filter
          {filtering ? (
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="filters active" />
          ) : null}
        </Button>
      </div>
      {open ? (
        <div
          id="recent-filters"
          className="animate-fade-in rounded-xl border border-border bg-surface/60 p-3"
        >
          <CasesToolbar key={resetKey} query={query} tags={tags} onChange={set} />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No investigations match"
          action={
            <Button variant="outline" onClick={clear}>
              Clear filters
            </Button>
          }
        >
          {archived > 0 && !query.showArchived
            ? `${archived} archived investigation${archived === 1 ? " is" : "s are"} hidden. Turn on Show archived to see ${archived === 1 ? "it" : "them"}.`
            : "Try another word or tag."}
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <InvestigationCard key={row.case.id} row={row} />
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing {rows.length} of {total}
        {archived > 0 && !query.showArchived ? ` · ${archived} archived hidden` : ""}
      </p>
    </section>
  );
}
