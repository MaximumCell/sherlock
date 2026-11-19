"use client";

import { Ban, ChevronDown, CircleAlert, CircleCheck, Clock, LoaderCircle, RotateCw, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatDateTime, timeAgo } from "@/lib/format";
import type { Job, JobStatus, ModuleInfo } from "@/lib/types";
import { sourceTitle } from "@/lib/sources";
import { cn } from "@/lib/utils";

const STATE: Record<JobStatus, { label: string; icon: LucideIcon; tone: string }> = {
  queued: { label: "Waiting", icon: Clock, tone: "text-muted-foreground" },
  running: { label: "Checking", icon: LoaderCircle, tone: "text-accent" },
  succeeded: { label: "Done", icon: CircleCheck, tone: "text-success" },
  failed: { label: "Did not finish", icon: CircleAlert, tone: "text-warning" },
  cancelled: { label: "Stopped", icon: Ban, tone: "text-muted-foreground" },
};

function outcome(job: Job): string {
  switch (job.status) {
    case "queued":
      return "Waiting for its turn";
    case "running":
      return job.progress_note ?? `${job.progress}% done`;
    case "failed":
      return "This source could not be checked";
    case "cancelled":
      return "Stopped before it finished";
    case "succeeded": {
      const found = job.result?.found;
      const checked = job.result?.findings;
      if (typeof found !== "number") return "Finished";
      if (found === 0) return "Nothing found";
      return `${found} found${typeof checked === "number" && checked !== found ? ` of ${checked} checked` : ""}`;
    }
  }
}

/** One data source in the scan checklist: a spinner that turns into a tick, with details on demand. */
export function SourceRow({
  job,
  modules,
  advanced,
  onCancel,
  onRetry,
  busy,
}: {
  job: Job;
  modules: ModuleInfo[] | undefined;
  advanced: boolean;
  onCancel: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const meta = STATE[job.status];
  const Icon = meta.icon;
  const active = job.status === "queued" || job.status === "running";
  const expandable = job.status === "failed" || advanced || job.attempts > 1;

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Icon
          key={job.status}
          className={cn(
            "h-[18px] w-[18px] shrink-0",
            meta.tone,
            job.status === "running" ? "animate-spin" : "animate-tick-in",
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {sourceTitle(job.module, modules)}
            <span className="sr-only">: {meta.label}</span>
          </p>
          <p className={cn("truncate text-sm", job.status === "failed" ? "text-warning" : "text-muted-foreground")}>
            {outcome(job)}
            <span className="text-muted-foreground"> · </span>
            <span className="font-mono text-xs text-muted-foreground" title={job.target_value}>
              {job.target_value}
            </span>
          </p>
        </div>
        {job.status === "running" ? (
          <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{job.progress}%</span>
        ) : null}
        {active ? (
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy} aria-label={`Stop ${sourceTitle(job.module, modules)}`}>
            {busy ? "Stopping…" : "Stop"}
          </Button>
        ) : null}
        {job.status === "failed" || job.status === "cancelled" ? (
          <Button variant="outline" size="sm" onClick={onRetry} disabled={busy} aria-label={`Retry ${sourceTitle(job.module, modules)}`}>
            <RotateCw aria-hidden />
            Retry
          </Button>
        ) : null}
        {expandable ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-expanded={open}
            aria-controls={panel}
            aria-label={`${open ? "Hide" : "Show"} details for ${sourceTitle(job.module, modules)}`}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden />
          </Button>
        ) : null}
      </div>
      {active ? (
        <div className="ml-[30px] mt-2 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
          {job.status === "queued" ? (
            <div className="h-full w-1/3 animate-indeterminate rounded-full bg-muted-foreground/40" />
          ) : (
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${job.progress}%` }} />
          )}
        </div>
      ) : null}
      {open ? (
        <dl id={panel} className="ml-[30px] mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg bg-muted/50 p-3 text-xs">
          {job.error ? (
            <>
              <dt className="text-muted-foreground">What went wrong</dt>
              <dd className="break-words">{job.error}</dd>
            </>
          ) : null}
          <dt className="text-muted-foreground">Attempts</dt>
          <dd className="tabular-nums">
            {job.attempts} of {job.max_attempts}
          </dd>
          <dt className="text-muted-foreground">{job.finished_at ? "Finished" : "Queued"}</dt>
          <dd title={formatDateTime(job.finished_at ?? job.created_at)}>{timeAgo(job.finished_at ?? job.created_at)}</dd>
          {advanced ? (
            <>
              <dt className="text-muted-foreground">Data source id</dt>
              <dd className="font-mono">{job.module}</dd>
              <dt className="text-muted-foreground">Queue</dt>
              <dd className="font-mono">{job.queue}</dd>
              <dt className="text-muted-foreground">Job</dt>
              <dd className="break-all font-mono">{job.id}</dd>
              {job.progress_note ? (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd>{job.progress_note}</dd>
                </>
              ) : null}
            </>
          ) : null}
          {job.status === "failed" ? (
            <dd className="col-span-2 pt-1 text-muted-foreground">
              Sources sometimes rate-limit or time out. Retry now, or try again later.
            </dd>
          ) : null}
        </dl>
      ) : null}
    </li>
  );
}
