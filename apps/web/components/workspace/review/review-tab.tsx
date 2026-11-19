"use client";

import { ListChecks, PartyPopper } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/common/bits";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useCorrelations, useFindings } from "@/lib/query/hooks";
import { useReview } from "@/lib/query/mutations";
import { countByStatus, filterQueue, nextIndex, type ReviewFilter } from "@/lib/review";
import { isTypingTarget } from "@/lib/storage";
import type { ReviewDecision } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { ReviewCard } from "./review-card";

const FILTERS: ReviewFilter[] = ["pending", "approved", "rejected", "all"];

function parseFilter(value: string | null): ReviewFilter {
  return FILTERS.includes(value as ReviewFilter) ? (value as ReviewFilter) : "pending";
}

export function ReviewTab({ caseId }: { caseId: string }) {
  const { params, set } = useUrlState();
  const correlations = useCorrelations(caseId);
  const findings = useFindings(caseId);
  const review = useReview(caseId);
  const filter = parseFilter(params.get("status"));
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const all = correlations.data;
  const queue = useMemo(() => filterQueue(all ?? [], filter), [all, filter]);
  const counts = useMemo(() => countByStatus(all ?? []), [all]);
  const byId = useMemo(() => new Map((findings.data ?? []).map((f) => [f.id, f])), [findings.data]);
  const selected = Math.min(index, Math.max(0, queue.length - 1));
  const current = queue[selected];
  const dialogOpen = Boolean(params.get("finding"));

  const decide = (id: string, decision: ReviewDecision, note?: string) =>
    review.mutate({ id, decision, note });

  // Keyboard: J/K move, A approve, R reject. Ignored while typing or when a sheet is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || dialogOpen) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const next = nextIndex(selected, queue.length, key === "j" ? 1 : -1);
        setIndex(next);
        listRef.current
          ?.querySelectorAll("article")
          [next]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else if ((key === "a" || key === "r") && current) {
        const decision: ReviewDecision = key === "a" ? "approve" : "reject";
        const already = current.status === (key === "a" ? "approved" : "rejected");
        if (already) return;
        event.preventDefault();
        review.mutate({ id: current.id, decision });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, queue.length, current, dialogOpen, review]);

  if (correlations.isError) {
    return <ErrorState error={correlations.error} onRetry={() => void correlations.refetch()} />;
  }
  if (correlations.isPending || findings.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-9 w-72 max-w-full" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          size="sm"
          value={filter}
          aria-label="Filter correlations by status"
          onValueChange={(value) => {
            if (!value) return;
            setIndex(0);
            set({ status: value === "pending" ? null : value });
          }}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f} value={f} className="gap-1.5 capitalize">
              {f}
              <span className="font-mono text-2xs text-muted-foreground">{counts[f]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> move <Kbd>A</Kbd> approve <Kbd>R</Kbd> reject
        </p>
      </div>

      {queue.length === 0 ? (
        (all ?? []).length === 0 ? (
          <EmptyState icon={ListChecks} title="No correlations yet">
            The correlation engine runs after each scan and suggests links between findings. They
            stay suggestions until you approve them.
          </EmptyState>
        ) : filter === "pending" ? (
          <EmptyState icon={PartyPopper} title="Review queue is clear">
            Every suggested link has a decision. Switch the filter to revisit them.
          </EmptyState>
        ) : (
          <EmptyState icon={ListChecks} title={`No ${filter} correlations`} />
        )
      ) : (
        <div ref={listRef} className="space-y-3">
          {queue.map((c, i) => (
            <ReviewCard
              key={c.id}
              correlation={c}
              findings={byId}
              selected={i === selected}
              onSelect={() => setIndex(i)}
              onDecide={(decision, note) => decide(c.id, decision, note)}
              onOpenFinding={(id) => set({ finding: id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
