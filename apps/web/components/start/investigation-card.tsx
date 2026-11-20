"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, Check, CircleDot } from "lucide-react";
import Link from "next/link";
import { TargetChip } from "@/components/common/bits";
import { MiniRing } from "@/components/common/mini-ring";
import { useData } from "@/components/providers/data-provider";
import { caseStatusLine, sourceProgress } from "@/lib/case-progress";
import type { CaseRow } from "@/lib/case-list";
import { formatDateTime, timeAgo } from "@/lib/format";
import { keys } from "@/lib/query/cache";
import type { Exposure } from "@/lib/types";
import { useCaseHref } from "@/lib/use-case-href";
import { cn } from "@/lib/utils";

const BAND_TONE = {
  low: "success",
  moderate: "warning",
  high: "danger",
  severe: "danger",
} as const;

/** The card's left-hand status: progress ring, exposure mini-dial, pending pip or a tick. */
function StatusVisual({ row, exposure }: { row: CaseRow; exposure: Exposure | null }) {
  const kind = row.status.kind;
  const sp = sourceProgress(row.jobs);
  if (kind === "archived") {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground">
        <Archive className="h-4 w-4" aria-hidden />
      </span>
    );
  }
  if (kind === "scanning") {
    return (
      <MiniRing value={sp.done} max={sp.total || 1} tone="accent">
        {sp.total ? Math.round((sp.done / sp.total) * 100) : 0}
      </MiniRing>
    );
  }
  if (kind === "needs_review") {
    return (
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full border border-warning/40 bg-warning/10 font-mono text-sm text-warning">
        {row.pendingReviews}
        <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-warning ring-2 ring-card" />
      </span>
    );
  }
  if (exposure) {
    return (
      <MiniRing value={exposure.score} gauge tone={BAND_TONE[exposure.band]}>
        {exposure.score}
      </MiniRing>
    );
  }
  const empty = sp.total === 0 && row.foundCount === 0;
  return (
    <span
      className={cn(
        "flex h-10 w-10 items-center justify-center rounded-full border",
        empty
          ? "border-dashed border-input text-muted-foreground"
          : "border-success/40 text-success",
      )}
    >
      {empty ? (
        <CircleDot className="h-4 w-4" aria-hidden />
      ) : (
        <Check className="h-4 w-4" aria-hidden />
      )}
    </span>
  );
}

/** One investigation on the start screen: status at a glance, title, targets, one plain line. */
export function InvestigationCard({ row }: { row: CaseRow }) {
  const caseHref = useCaseHref();
  const { mode } = useData();
  const client = useQueryClient();
  // Only an exposure score that is already cached; the start screen never calls the gateway.
  const exposure = client.getQueryData<Exposure>(keys.exposure(mode, row.case.id)) ?? null;
  const kind = row.status.kind;
  const line = caseStatusLine({
    archived: kind === "archived",
    jobs: row.jobs,
    pendingLinks: row.pendingReviews,
    foundCount: row.foundCount,
    exposure,
  });
  const shown = row.case.identifiers.slice(0, 2);
  const hidden = row.case.identifiers.length - shown.length;

  return (
    <li className="group panel relative flex flex-col gap-4 p-4 transition-[border-color,transform,box-shadow] duration-2 ease-out hover:-translate-y-0.5 hover:border-input hover:shadow-lift">
      <div className="flex items-start gap-3.5">
        <StatusVisual row={row} exposure={exposure} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-3">
            <Link
              href={caseHref(row.case.id)}
              className="min-w-0 break-words font-medium leading-snug after:absolute after:inset-0 after:rounded-xl"
            >
              {row.title}
            </Link>
            <time
              dateTime={row.updatedAt}
              title={formatDateTime(row.updatedAt)}
              className="shrink-0 font-mono text-2xs text-muted-foreground"
            >
              {timeAgo(row.updatedAt)}
            </time>
          </div>
          <p
            className={cn(
              "text-sm",
              kind === "scanning"
                ? "text-accent"
                : kind === "needs_review"
                  ? "text-warning"
                  : "text-muted-foreground",
            )}
          >
            {line}
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {shown.map((idf) => (
          <TargetChip key={`${idf.type}:${idf.value}`} type={idf.type} value={idf.value} />
        ))}
        {hidden > 0 ? <span className="text-xs text-muted-foreground">+{hidden} more</span> : null}
      </div>
      {row.case.tags.length > 0 || kind !== "idle" ? (
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <p className="flex flex-wrap gap-1">
            {row.case.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-[5px] bg-muted px-1.5 py-px text-2xs text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </p>
          {kind !== "idle" ? (
            <span className="font-mono text-2xs tabular-nums text-muted-foreground">
              {row.foundCount} result{row.foundCount === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
