"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import type { CaseStats } from "@/lib/findings";
import { useCaseHref } from "@/lib/use-case-href";
import { cn } from "@/lib/utils";

interface Tile {
  label: string;
  value: number;
  hint: string;
  tab: string;
  highlight?: boolean;
}

export function StatTiles({
  caseId,
  stats,
  loading,
}: {
  caseId: string;
  stats: CaseStats;
  loading: boolean;
}) {
  const caseHref = useCaseHref();
  const tiles: Tile[] = [
    { label: "Accounts found", value: stats.accountsFound, hint: "profiles and registrations", tab: "findings" },
    { label: "Sources checked", value: stats.platformsChecked, hint: "platforms and lookups", tab: "findings" },
    { label: "Breaches", value: stats.breaches, hint: "exposure metadata only", tab: "findings" },
    { label: "Linked identities", value: stats.linkedIdentities, hint: "findings in approved links", tab: "graph" },
    {
      label: "Pending reviews",
      value: stats.pendingReviews,
      hint: stats.pendingReviews > 0 ? "correlations need a decision" : "queue is clear",
      tab: "review",
      highlight: stats.pendingReviews > 0,
    },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <li key={tile.label} className="last:col-span-2 lg:last:col-span-1">
        <Link
          href={caseHref(caseId, tile.tab)}
          scroll={false}
          className={cn(
            "block h-full rounded-lg border bg-card p-3 transition-colors hover:border-accent/50",
            tile.highlight ? "border-warning/40" : "border-border",
          )}
        >
          <span className="block text-xs text-muted-foreground">{tile.label}</span>
          <span className="mt-1 block">
            {loading ? (
              <Skeleton className="inline-block h-8 w-12" />
            ) : (
              <span
                className={cn(
                  "font-mono text-3xl font-semibold tabular-nums",
                  tile.highlight && "text-warning",
                )}
              >
                {tile.value}
              </span>
            )}
            <span className="mt-0.5 block text-2xs text-muted-foreground">{tile.hint}</span>
          </span>
        </Link>
        </li>
      ))}
    </ul>
  );
}
