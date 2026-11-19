"use client";

import { ChevronDown, ChevronUp, LoaderCircle, Radar } from "lucide-react";
import { useMemo, useState } from "react";
import { ProgressBar } from "@/components/common/bits";
import { isActiveJob, scanProgress } from "@/lib/case-status";
import { useJobs } from "@/lib/query/hooks";
import { useCancelJob } from "@/lib/query/mutations";
import type { Job } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JobRow } from "./job-row";

const RECENT_LIMIT = 12;

/** Active jobs first (running before queued), then the most recent finished ones. */
export function orderJobs(jobs: readonly Job[]): { active: Job[]; recent: Job[] } {
  const active = jobs
    .filter(isActiveJob)
    .sort(
      (a, b) =>
        Number(b.status === "running") - Number(a.status === "running") ||
        a.created_at.localeCompare(b.created_at),
    );
  const recent = jobs
    .filter((j) => !isActiveJob(j))
    .sort((a, b) =>
      (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at),
    )
    .slice(0, RECENT_LIMIT);
  return { active, recent };
}

/** Persistent, collapsible panel docked bottom-right in the case workspace. */
export function JobsPanel({ caseId }: { caseId: string }) {
  const jobs = useJobs(caseId);
  const cancel = useCancelJob(caseId);
  const [open, setOpen] = useState(false);
  const { active, recent } = useMemo(() => orderJobs(jobs.data ?? []), [jobs.data]);
  const all = jobs.data ?? [];
  const failed = recent.filter((j) => j.status === "failed").length;
  const progress = scanProgress(all);

  return (
    <aside
      aria-label="Jobs"
      data-print="hide"
      className="fixed bottom-0 right-0 z-40 w-full sm:bottom-4 sm:right-4 sm:w-96"
    >
      <div className="overflow-hidden border border-border bg-card shadow-panel sm:rounded-lg">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="jobs-panel-body"
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm"
        >
          {active.length > 0 ? (
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
          ) : (
            <Radar className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              {active.length > 0
                ? `${active.length} job${active.length === 1 ? "" : "s"} running`
                : "Jobs"}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">
              {active.length > 0
                ? `${progress}%`
                : all.length === 0
                  ? "none yet"
                  : `${all.length} total${failed ? ` · ${failed} failed` : ""}`}
            </span>
          </span>
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
          ) : (
            <ChevronUp className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </button>
        {active.length > 0 && !open ? (
          <ProgressBar value={progress} label="Overall scan progress" className="h-0.5 rounded-none" />
        ) : null}
        <div
          id="jobs-panel-body"
          hidden={!open}
          className={cn("scrollbar-thin max-h-[50dvh] overflow-y-auto border-t border-border")}
        >
          {all.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {jobs.isPending ? "Loading jobs…" : "No jobs yet. Start a scan from the Overview tab."}
            </p>
          ) : (
            <>
              {active.length > 0 ? (
                <ul aria-label="Active jobs" className="divide-y divide-border">
                  {active.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      cancelling={cancel.isPending && cancel.variables === job.id}
                      onCancel={() => cancel.mutate(job.id)}
                    />
                  ))}
                </ul>
              ) : null}
              {recent.length > 0 ? (
                <>
                  <p className="border-y border-border bg-surface px-3 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Recent
                  </p>
                  <ul aria-label="Recent jobs" className="divide-y divide-border">
                    {recent.map((job) => (
                      <JobRow key={job.id} job={job} />
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
