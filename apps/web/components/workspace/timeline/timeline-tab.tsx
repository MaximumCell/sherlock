"use client";

import { Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate, formatTime } from "@/lib/format";
import { useAudit, useCase, useFindings, useJobs } from "@/lib/query/hooks";
import {
  buildTimeline,
  groupByDay,
  type TimelineEvent,
  type TimelineKind,
  type TimelineTone,
} from "@/lib/timeline";
import { useUrlState } from "@/lib/use-url-state";

export const TONE_DOT: Record<TimelineTone, string> = {
  neutral: "bg-muted-foreground/60",
  success: "bg-success",
  danger: "bg-danger",
  accent: "bg-accent",
};

const KIND_LABEL: Record<TimelineKind, string> = {
  case: "Case",
  scan: "Scan",
  job: "Job",
  review: "Review",
  account: "Account created",
  audit: "Audit",
};

type Scope = "all" | "investigation" | "subject";

function EventRow({ event, onOpen }: { event: TimelineEvent; onOpen: (id: string) => void }) {
  return (
    <li className="relative flex gap-3 pb-4 pl-1 last:pb-0">
      <span
        className={`relative z-10 mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-background ${TONE_DOT[event.tone]}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="break-words font-medium">{event.title}</span>
          <span className="text-2xs uppercase tracking-wider text-muted-foreground">
            {KIND_LABEL[event.kind]}
          </span>
        </p>
        {event.detail ? (
          <p className="break-words font-mono text-xs text-muted-foreground">{event.detail}</p>
        ) : null}
        {event.findingId ? (
          <button
            type="button"
            className="mt-0.5 rounded-sm text-xs text-accent underline-offset-4 hover:underline"
            onClick={() => onOpen(event.findingId!)}
          >
            Open finding
          </button>
        ) : null}
      </div>
      <time dateTime={event.at} className="shrink-0 font-mono text-xs text-muted-foreground">
        {formatTime(event.at)}
      </time>
    </li>
  );
}

export function TimelineTab({ caseId }: { caseId: string }) {
  const { set } = useUrlState();
  const c = useCase(caseId);
  const audit = useAudit(caseId);
  const jobs = useJobs(caseId);
  const findings = useFindings(caseId);
  const [scope, setScope] = useState<Scope>("all");

  const events = useMemo(
    () =>
      buildTimeline({
        case: c.data ?? null,
        audit: audit.data ?? [],
        jobs: jobs.data ?? [],
        findings: findings.data ?? [],
      }),
    [c.data, audit.data, jobs.data, findings.data],
  );
  const visible = useMemo(
    () =>
      events.filter((e) =>
        scope === "all" ? true : scope === "subject" ? e.kind === "account" : e.kind !== "account",
      ),
    [events, scope],
  );
  const days = useMemo(() => groupByDay(visible), [visible]);

  if (audit.isError) return <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />;
  if (audit.isPending || jobs.isPending || findings.isPending) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {visible.length} event{visible.length === 1 ? "" : "s"}: what the investigation did, and
          when the subject&apos;s accounts were created.
        </p>
        <ToggleGroup
          type="single"
          size="sm"
          value={scope}
          onValueChange={(v) => v && setScope(v as Scope)}
          aria-label="Timeline scope"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="investigation">Investigation</ToggleGroupItem>
          <ToggleGroupItem value="subject">Subject history</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {days.length === 0 ? (
        <EmptyState icon={Clock} title="Nothing on the timeline yet">
          Events appear as scans run and as findings reveal account creation dates.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          {days.map(([day, items]) => (
            <section key={day} aria-label={formatDate(day)}>
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {formatDate(day)}
              </h3>
              <ol className="relative before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-border">
                {items.map((event) => (
                  <EventRow key={event.id} event={event} onOpen={(id) => set({ finding: id })} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
