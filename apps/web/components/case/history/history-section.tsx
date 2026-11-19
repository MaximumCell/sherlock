"use client";

import { Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate, formatTime } from "@/lib/format";
import { useAdvanced } from "@/lib/preferences";
import { useAudit } from "@/lib/query/hooks";
import {
  buildTimeline,
  groupByDay,
  type TimelineEvent,
  type TimelineKind,
  type TimelineTone,
} from "@/lib/timeline";
import type { Case, Finding, Job } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { CaseSection } from "../section";

export const TONE_DOT: Record<TimelineTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  danger: "bg-danger",
  accent: "bg-accent",
};

const KIND_LABEL: Record<TimelineKind, string> = {
  case: "Investigation",
  scan: "Search",
  job: "Data source",
  review: "Decision",
  account: "Account created",
  audit: "Activity",
};

type Scope = "all" | "investigation" | "subject";
const DAYS_SHOWN = 3;

function EventRow({
  event,
  advanced,
  onOpen,
}: {
  event: TimelineEvent;
  advanced: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <li className="relative flex gap-3 pb-5 pl-1 last:pb-0">
      <span
        className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-background ${TONE_DOT[event.tone]}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="break-words font-medium">{event.title}</span>
          <span className="ml-2 text-xs text-muted-foreground">{KIND_LABEL[event.kind]}</span>
        </p>
        {event.detail ? (
          <p className="break-words text-sm text-muted-foreground">{event.detail}</p>
        ) : null}
        {advanced && event.raw ? (
          <p className="break-all font-mono text-2xs text-muted-foreground">{event.raw}</p>
        ) : null}
        {event.findingId ? (
          <button
            type="button"
            className="mt-0.5 rounded-sm text-sm text-accent underline-offset-4 hover:underline"
            onClick={() => event.findingId && onOpen(event.findingId)}
          >
            Open this result
          </button>
        ) : null}
      </div>
      <time dateTime={event.at} className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {formatTime(event.at)}
      </time>
    </li>
  );
}

/** Everything that happened, newest first: your actions, each data source, and account ages. */
export function HistorySection({
  c,
  jobs,
  findings,
  loading,
}: {
  c: Case;
  jobs: Job[];
  findings: Finding[];
  loading: boolean;
}) {
  const { set } = useUrlState();
  const audit = useAudit(c.id);
  const [advanced] = useAdvanced();
  const [scope, setScope] = useState<Scope>("all");
  const [allDays, setAllDays] = useState(false);

  const events = useMemo(
    () => buildTimeline({ case: c, audit: audit.data ?? [], jobs, findings }),
    [c, audit.data, jobs, findings],
  );
  const visible = useMemo(
    () =>
      events.filter((e) =>
        scope === "all" ? true : scope === "subject" ? e.kind === "account" : e.kind !== "account",
      ),
    [events, scope],
  );
  const days = useMemo(() => groupByDay(visible), [visible]);
  const shownDays = allDays ? days : days.slice(0, DAYS_SHOWN);

  return (
    <CaseSection
      id="history"
      title="History"
      description="What this investigation did and when, plus when the accounts it found were created."
      actions={
        <ToggleGroup
          type="single"
          size="sm"
          value={scope}
          onValueChange={(v) => v && setScope(v as Scope)}
          aria-label="Which events to show"
        >
          <ToggleGroupItem value="all">Everything</ToggleGroupItem>
          <ToggleGroupItem value="investigation">This investigation</ToggleGroupItem>
          <ToggleGroupItem value="subject">Account ages</ToggleGroupItem>
        </ToggleGroup>
      }
    >
      {audit.isError ? (
        <ErrorState
          title="Could not load the history"
          error={audit.error}
          onRetry={() => void audit.refetch()}
        />
      ) : audit.isPending || loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : days.length === 0 ? (
        <EmptyState icon={Clock} title="Nothing here yet">
          Events appear as searches run, as you decide on links, and as results reveal when accounts
          were created.
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {shownDays.map(([day, items]) => (
            <section key={day} aria-label={formatDate(day)}>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
                {formatDate(day)}
              </h3>
              <ol className="relative before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-border">
                {items.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    advanced={advanced}
                    onOpen={(id) => set({ finding: id })}
                  />
                ))}
              </ol>
            </section>
          ))}
          {days.length > DAYS_SHOWN ? (
            <Button variant="outline" size="sm" onClick={() => setAllDays((v) => !v)}>
              {allDays
                ? "Show recent days only"
                : `Show all ${days.length} days (${visible.length} events)`}
            </Button>
          ) : null}
        </div>
      )}
    </CaseSection>
  );
}
