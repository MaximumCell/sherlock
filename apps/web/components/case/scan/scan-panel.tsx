"use client";

import { ChevronDown, CircleCheck, LoaderCircle, Radar } from "lucide-react";
import { useMemo, useState } from "react";
import { ProgressBar } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { sourceProgress, sourceProgressText } from "@/lib/case-progress";
import { isActiveJob } from "@/lib/case-status";
import { useAdvanced } from "@/lib/preferences";
import { useModules } from "@/lib/query/hooks";
import { useCancelJob, useScan } from "@/lib/query/mutations";
import { QUEUE_LABEL } from "@/lib/sources";
import { QUEUES, TARGET_TYPES, type Job, type TargetType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { SCAN_ANCHOR } from "@/lib/sections";
import { SourceRow } from "./source-row";

const isTargetType = (t: string): t is TargetType =>
  (TARGET_TYPES as readonly string[]).includes(t);

/** Active first, then problems, then the most recent finished. */
function order(jobs: readonly Job[]): Job[] {
  const rank = (j: Job) =>
    j.status === "running" ? 0 : j.status === "queued" ? 1 : j.status === "failed" ? 2 : 3;
  return [...jobs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at),
  );
}

/**
 * Live checklist of data sources (replaces the floating jobs panel). Open while a scan runs;
 * once everything is done it folds into one line that can be reopened.
 */
export function ScanPanel({
  caseId,
  jobs,
  loading,
}: {
  caseId: string;
  jobs: Job[];
  loading: boolean;
}) {
  const [advanced] = useAdvanced();
  const catalogue = useModules();
  const cancel = useCancelJob(caseId);
  const scan = useScan(caseId);
  const [openChoice, setOpenChoice] = useState<boolean | null>(null);
  const p = sourceProgress(jobs);
  const open = openChoice ?? p.scanning;
  const groups = useMemo(
    () =>
      QUEUES.map((q) => ({ queue: q, jobs: order(jobs.filter((j) => j.queue === q)) })).filter(
        (g) => g.jobs.length,
      ),
    [jobs],
  );
  const found = jobs.reduce(
    (sum, j) => sum + (typeof j.result?.found === "number" ? j.result.found : 0),
    0,
  );
  const active = jobs.filter(isActiveJob);
  const percent = p.total ? Math.round((p.done / p.total) * 100) : 0;

  const headline = loading
    ? "Loading scan progress…"
    : jobs.length === 0
      ? "No search has run yet"
      : p.scanning
        ? `Scanning · ${sourceProgressText(p)}`
        : `Scan finished · ${jobs.length} source${jobs.length === 1 ? "" : "s"} checked · ${found} found${p.failed ? ` · ${p.failed} could not be checked` : ""}`;

  return (
    <section
      id={SCAN_ANCHOR}
      aria-labelledby="scan-title"
      className="scroll-mt-36 overflow-hidden rounded-2xl border border-border bg-card shadow-soft"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
        {p.scanning ? (
          <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-accent" aria-hidden />
        ) : jobs.length ? (
          <CircleCheck className="h-5 w-5 shrink-0 text-success" aria-hidden />
        ) : (
          <Radar className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <h2 id="scan-title" className="text-base font-semibold">
            Scan progress
          </h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {headline}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 pl-8 sm:w-auto sm:pl-0">
          {active.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => active.forEach((j) => cancel.mutate(j.id))}
            >
              Stop scan
            </Button>
          ) : null}
          {jobs.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={open}
              aria-controls="scan-sources"
              onClick={() => setOpenChoice(!open)}
            >
              {open ? "Hide sources" : "Show sources"}
              <ChevronDown
                className={cn("transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </Button>
          ) : null}
        </div>
      </div>
      {p.scanning ? (
        <ProgressBar value={percent} label="Overall scan progress" className="h-1 rounded-none" />
      ) : null}
      {open && jobs.length > 0 ? (
        <div id="scan-sources" className="animate-fade-in border-t border-border">
          {groups.map((g) => {
            const running = g.jobs.filter(isActiveJob).length;
            return (
              <div key={g.queue}>
                <h3 className="flex items-center justify-between bg-surface px-4 py-2 text-xs font-medium text-muted-foreground sm:px-5">
                  <span>
                    {QUEUE_LABEL[g.queue]}
                    {advanced ? <span className="ml-2 font-mono">queue: {g.queue}</span> : null}
                  </span>
                  <span className="tabular-nums">
                    {g.jobs.length} source{g.jobs.length === 1 ? "" : "s"}
                    {running ? ` · ${running} still running` : ""}
                  </span>
                </h3>
                <ul className="divide-y divide-border">
                  {g.jobs.map((job) => (
                    <SourceRow
                      key={job.id}
                      job={job}
                      modules={catalogue.data?.modules}
                      advanced={advanced}
                      busy={
                        (cancel.isPending && cancel.variables === job.id) ||
                        (scan.isPending && scan.variables?.modules?.[0] === job.module)
                      }
                      onCancel={() => cancel.mutate(job.id)}
                      onRetry={() => {
                        if (!isTargetType(job.target_type)) return;
                        scan.mutate({
                          type: job.target_type,
                          value: job.target_value,
                          modules: [job.module],
                        });
                      }}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
