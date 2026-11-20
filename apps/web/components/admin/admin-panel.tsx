"use client";

import { FlaskConical } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ErrorState, PageHeader } from "@/components/common/states";
import { useData } from "@/components/providers/data-provider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAdminOverview } from "@/lib/admin/hooks";
import { ActivityFeed } from "./activity-feed";
import { SensitiveTarget, useHideTargets } from "./admin-bits";
import { AdminSkeleton } from "./admin-skeleton";
import { NeedsAttention } from "./needs-attention";
import { PauseControl, PausedBanner } from "./pause-control";
import { SearchesChart } from "./searches-chart";
import { StatTiles } from "./stat-tiles";
import { VisitorSheet } from "./visitor-sheet";
import { VisitorsTable } from "./visitors-table";

const RANGES = [7, 14, 30] as const;

function Panel({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3">
      <div className="space-y-0.5">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function DemoBanner() {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/5 p-3 text-sm"
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p>
        <strong className="font-semibold">Demo data.</strong> Every visitor, address and search here
        is invented. Blocking, pausing and deleting only change this tab.
      </p>
    </div>
  );
}

export function AdminPanel({ email }: { email: string }) {
  const { ds } = useData();
  const [days, setDays] = useState<number>(14);
  const [hide, setHide] = useHideTargets();
  const [open, setOpen] = useState<string | null>(null);
  const overview = useAdminOverview(days);

  if (overview.isPending) return <AdminSkeleton />;
  if (overview.isError) {
    return (
      <ErrorState
        title="Could not load the operator panel"
        error={overview.error}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  const o = overview.data;

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <PageHeader
          title="Operator panel"
          description={
            <>
              What visitors search and where from, so you can spot misuse and stop it. Signed in as{" "}
              <span className="font-medium text-foreground">{email}</span>. Search records are kept
              for {o.retention_days} days; origins are stored as an anonymous hash, never an IP
              address.
            </>
          }
          actions={<PauseControl paused={o.scans_paused} />}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <ToggleGroup
            type="single"
            value={String(days)}
            onValueChange={(v) => v && setDays(Number(v))}
            aria-label="Date range"
          >
            {RANGES.map((r) => (
              <ToggleGroupItem key={r} value={String(r)}>
                {r} days
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <Switch id="hide-targets" checked={hide} onCheckedChange={setHide} />
            <Label htmlFor="hide-targets" className="cursor-pointer text-sm">
              Hide targets
            </Label>
          </div>
        </div>
        {ds.admin.demo ? <DemoBanner /> : null}
        {o.scans_paused ? <PausedBanner /> : null}
      </div>

      <StatTiles overview={o} />

      <Panel
        id="chart-title"
        title="Searches per day"
        description={`Last ${o.days} days (UTC), every attempt by outcome.`}
      >
        <div className="rounded-lg border border-border bg-card p-4 shadow-soft">
          <SearchesChart series={o.series} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel
          id="attention-title"
          title="Needs attention"
          description="Visitors with warning signs in the last 7 days. Hints for you, never automatic."
        >
          <NeedsAttention onOpen={setOpen} />
        </Panel>
        <Panel
          id="repeated-title"
          title="Searched more than once"
          description="The same target, possibly from several visitors."
        >
          {o.top_targets.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              No repeated targets in this period.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border bg-card">
              {o.top_targets.map((t) => (
                <li
                  key={`${t.target_type}:${t.target_value}`}
                  className="flex items-center gap-3 p-3"
                >
                  <SensitiveTarget
                    type={t.target_type}
                    value={t.target_value}
                    className="min-w-0 flex-1"
                  />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {t.count}× · {t.sessions} {t.sessions === 1 ? "visitor" : "visitors"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        id="feed-title"
        title="Live activity"
        description="Every search attempt, newest first, including refused ones."
      >
        <ActivityFeed onOpen={setOpen} />
      </Panel>

      <Panel
        id="visitors-title"
        title="Visitors"
        description="One row per browser session (anonymous or signed in)."
      >
        <VisitorsTable onOpen={setOpen} />
      </Panel>

      <VisitorSheet userId={open} onClose={() => setOpen(null)} />
    </div>
  );
}
