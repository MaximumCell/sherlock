"use client";

import { ChevronRight, ShieldCheck } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useVisitors } from "@/lib/admin/hooks";
import { relativeTime } from "@/lib/admin/logic";
import { FlagBadge, SessionLabel } from "./admin-bits";

/** Flagged visitors, most severe first, each with its reasons. */
export function NeedsAttention({ onOpen }: { onOpen: (userId: string) => void }) {
  const query = useVisitors({ flagged: true, limit: 8 });
  if (query.isPending) return <Skeleton className="h-32 w-full" />;
  if (query.isError)
    return (
      <ErrorState
        title="Could not load flagged visitors"
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  const items = query.data.items;
  if (items.length === 0) {
    return (
      <EmptyState icon={ShieldCheck} title="Nothing needs attention">
        No visitor shows warning signs in the last 7 days.
      </EmptyState>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((v) => (
        <li key={v.user_id}>
          <button
            type="button"
            onClick={() => onOpen(v.user_id)}
            className="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
          >
            <span className="min-w-0 flex-1 space-y-1.5">
              <SessionLabel session={v} userId={v.user_id} />
              <span className="flex flex-wrap gap-1.5">
                {v.flags.map((f) => (
                  <FlagBadge key={f.key} flag={f} />
                ))}
              </span>
              <span className="block text-xs text-muted-foreground">
                {v.search_count} accepted, {v.refused_count} refused · last seen{" "}
                {relativeTime(v.last_seen)}
              </span>
            </span>
            <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="sr-only">Open visitor</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
