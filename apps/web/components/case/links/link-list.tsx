"use client";

import { ListChecks } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/common/bits";
import { EmptyState } from "@/components/common/states";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { AccountIndex } from "@/lib/accounts";
import { filterQueue, nextIndex, type ReviewFilter } from "@/lib/review";
import type { Correlation, Finding, ReviewDecision } from "@/lib/types";
import { ReviewCard } from "./link-card";
import { MergeCard } from "./merge-card";
import { useLinkKeys } from "./use-link-keys";

export type LinkFilter = ReviewFilter | "merged";

const FILTERS: { value: LinkFilter; label: string }[] = [
  { value: "pending", label: "To check" },
  { value: "approved", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
  { value: "merged", label: "Merged automatically" },
];

const parseFilter = (value: string | null): LinkFilter =>
  FILTERS.some((f) => f.value === value) ? (value as LinkFilter) : "pending";

/** Every link with a status filter; decisions can be changed or undone here. */
export function LinkList({
  correlations,
  merges,
  accounts,
  findings,
  counts,
  filter: rawFilter,
  onFilter,
  onDecide,
  onOpenFinding,
  keysEnabled,
  advanced,
  pendingId,
}: {
  /** Links between accounts (never `same_account` rows). */
  correlations: Correlation[];
  /** Automatic `same_account` merges, merged or split. */
  merges: Correlation[];
  accounts: AccountIndex;
  findings: ReadonlyMap<string, Finding>;
  counts: Record<LinkFilter, number>;
  filter: string | null;
  onFilter: (filter: LinkFilter) => void;
  onDecide: (c: Correlation, decision: ReviewDecision, note?: string) => void;
  onOpenFinding: (id: string) => void;
  keysEnabled: boolean;
  advanced: boolean;
  pendingId: string | undefined;
}) {
  const filter = parseFilter(rawFilter);
  const queue = useMemo(
    () => (filter === "merged" ? [] : filterQueue(correlations, filter)),
    [correlations, filter],
  );
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = Math.min(index, Math.max(0, queue.length - 1));
  const current = queue[selected];

  const select = (next: number) => {
    setIndex(next);
    listRef.current?.querySelectorAll("article")[next]?.scrollIntoView({ block: "nearest" });
  };

  useLinkKeys({
    enabled: keysEnabled && current !== undefined,
    onYes: () => current && current.status !== "approved" && onDecide(current, "approve"),
    onNo: () => current && current.status !== "rejected" && onDecide(current, "reject"),
    onNext: () => select(nextIndex(selected, queue.length, 1)),
    onPrev: () => select(nextIndex(selected, queue.length, -1)),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          size="sm"
          value={filter}
          aria-label="Show links by decision"
          className="flex-wrap justify-start"
          onValueChange={(value) => {
            if (!value) return;
            setIndex(0);
            onFilter(value as LinkFilter);
          }}
        >
          {FILTERS.map((f) => (
            <ToggleGroupItem key={f.value} value={f.value} className="gap-1.5">
              {f.label}
              <span className="text-2xs tabular-nums text-muted-foreground">{counts[f.value]}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="hidden items-center gap-1.5 text-xs text-muted-foreground md:flex">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd> move <Kbd>Y</Kbd> yes <Kbd>N</Kbd> no
        </p>
      </div>
      {filter === "merged" ? (
        merges.length === 0 ? (
          <EmptyState icon={ListChecks} title="Nothing merged automatically">
            When several sources describe the same account, it is shown once and listed here.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Each of these is one account that several searches or data sources reported. They are
              not questions. Split one if it is wrong.
            </p>
            {merges.map((m) => (
              <MergeCard
                key={m.id}
                merge={m}
                findings={findings}
                pending={pendingId === m.id}
                advanced={advanced}
                onDecide={(decision) => onDecide(m, decision)}
                onOpenFinding={onOpenFinding}
              />
            ))}
          </div>
        )
      ) : queue.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={filter === "pending" ? "Nothing left to check" : "No links here"}
        >
          {filter === "pending"
            ? "Every possible link has a decision. Pick another filter to revisit them."
            : "Pick another filter to see the rest."}
        </EmptyState>
      ) : (
        <div ref={listRef} className="space-y-3">
          {queue.map((c, i) => (
            <ReviewCard
              key={c.id}
              correlation={c}
              index={accounts}
              selected={i === selected}
              pending={pendingId === c.id}
              advanced={advanced}
              onSelect={() => setIndex(i)}
              onDecide={(decision, note) => onDecide(c, decision, note)}
              onOpenFinding={onOpenFinding}
            />
          ))}
        </div>
      )}
    </div>
  );
}
