"use client";

import {
  Clock,
  FileText,
  LayoutDashboard,
  ListChecks,
  Table2,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCorrelations, useFindings } from "@/lib/query/hooks";
import { patchSearch, useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";

export const WORKSPACE_TABS = [
  "overview",
  "findings",
  "graph",
  "timeline",
  "review",
  "report",
] as const;
export type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

export function parseTab(value: string | null): WorkspaceTab {
  return (WORKSPACE_TABS as readonly string[]).includes(value ?? "")
    ? (value as WorkspaceTab)
    : "overview";
}

const META: Record<WorkspaceTab, { label: string; icon: LucideIcon }> = {
  overview: { label: "Overview", icon: LayoutDashboard },
  findings: { label: "Findings", icon: Table2 },
  graph: { label: "Graph", icon: Waypoints },
  timeline: { label: "Timeline", icon: Clock },
  review: { label: "Review", icon: ListChecks },
  report: { label: "Report", icon: FileText },
};

/** Tabs are links: the active tab lives in `?tab=` so it survives reloads and can be shared. */
export function WorkspaceTabs({ caseId, active }: { caseId: string; active: WorkspaceTab }) {
  const { params, pathname } = useUrlState();
  const findings = useFindings(caseId);
  const correlations = useCorrelations(caseId);
  const counts: Partial<Record<WorkspaceTab, number>> = {
    findings: findings.data?.filter((f) => f.status === "found").length,
    review: correlations.data?.filter((c) => c.status === "pending").length,
  };

  // keep only the params that identify the case; filters belong to their own tab
  const base = params.get("case") ? `case=${encodeURIComponent(params.get("case") ?? "")}` : "";

  return (
    <div
      role="tablist"
      aria-label="Case workspace"
      data-print="hide"
      className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 sm:mx-0 sm:px-0"
    >
      {WORKSPACE_TABS.map((tab) => {
        const { label, icon: Icon } = META[tab];
        const selected = tab === active;
        const count = counts[tab];
        const query = patchSearch(base, { tab: tab === "overview" ? null : tab });
        return (
          <Link
            key={tab}
            id={`tab-${tab}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${tab}`}
            href={query ? `${pathname}?${query}` : pathname}
            scroll={false}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              selected
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
            {count !== undefined && count > 0 ? (
              <span
                className={cn(
                  "rounded-full px-1.5 font-mono text-2xs tabular-nums",
                  tab === "review" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
                )}
              >
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
