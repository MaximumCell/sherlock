"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, CircleCheck, CircleDot, LoaderCircle, MessageCircleQuestion } from "lucide-react";
import Link from "next/link";
import { ProgressBar, TargetChip } from "@/components/common/bits";
import { useData } from "@/components/providers/data-provider";
import { caseStatusLine, sourceProgress } from "@/lib/case-progress";
import type { CaseRow } from "@/lib/case-list";
import { formatDateTime, timeAgo } from "@/lib/format";
import { keys } from "@/lib/query/cache";
import type { Exposure } from "@/lib/types";
import { useCaseHref } from "@/lib/use-case-href";
import { cn } from "@/lib/utils";

const ICON = {
  scanning: LoaderCircle,
  needs_review: MessageCircleQuestion,
  archived: Archive,
  idle: CircleCheck,
} as const;

const TONE = {
  scanning: "text-accent",
  needs_review: "text-warning",
  archived: "text-muted-foreground",
  idle: "text-success",
} as const;

/** One investigation on the start screen: title, targets and one plain status line. */
export function InvestigationCard({ row }: { row: CaseRow }) {
  const caseHref = useCaseHref();
  const { mode } = useData();
  const client = useQueryClient();
  // Only an exposure score that is already cached; the start screen never calls the gateway.
  const exposure = client.getQueryData<Exposure>(keys.exposure(mode, row.case.id)) ?? null;
  const kind = row.status.kind;
  const Icon =
    kind === "idle" && sourceProgress(row.jobs).total === 0 && row.foundCount === 0
      ? CircleDot
      : ICON[kind];
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
    <li className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft transition-[border-color,box-shadow] hover:border-input hover:shadow-lift">
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
          className="shrink-0 text-xs text-muted-foreground"
        >
          {timeAgo(row.updatedAt)}
        </time>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {shown.map((idf) => (
          <TargetChip key={`${idf.type}:${idf.value}`} type={idf.type} value={idf.value} />
        ))}
        {hidden > 0 ? <span className="text-xs text-muted-foreground">+{hidden} more</span> : null}
      </div>
      <div className="mt-auto space-y-2">
        <p className={cn("flex items-center gap-1.5 text-sm", TONE[kind])}>
          <Icon
            className={cn("h-4 w-4 shrink-0", kind === "scanning" && "animate-spin")}
            aria-hidden
          />
          <span
            className={kind === "idle" || kind === "archived" ? "text-muted-foreground" : undefined}
          >
            {line}
          </span>
        </p>
        {kind === "scanning" ? (
          <ProgressBar value={row.status.progress ?? 0} label="Scan progress" className="h-1" />
        ) : null}
        {row.case.tags.length > 0 || kind !== "idle" ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex flex-wrap gap-1">
              {row.case.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </p>
            {kind !== "idle" ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {row.foundCount} result{row.foundCount === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
