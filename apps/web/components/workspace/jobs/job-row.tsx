import { Ban, CircleCheck, CircleX, Clock, LoaderCircle, type LucideIcon } from "lucide-react";
import { ProgressBar } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import type { Job, JobStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<JobStatus, { label: string; icon: LucideIcon; className: string }> = {
  queued: { label: "Queued", icon: Clock, className: "text-muted-foreground" },
  running: { label: "Running", icon: LoaderCircle, className: "text-accent" },
  succeeded: { label: "Succeeded", icon: CircleCheck, className: "text-success" },
  failed: { label: "Failed", icon: CircleX, className: "text-danger" },
  cancelled: { label: "Cancelled", icon: Ban, className: "text-muted-foreground" },
};

function summary(job: Job): string | null {
  if (job.status === "failed") return job.error ?? "Failed without an error message";
  if (job.status === "succeeded" && job.result) {
    const { found, findings } = job.result;
    if (typeof found === "number") {
      return `${found} found${typeof findings === "number" ? ` of ${findings} checked` : ""}`;
    }
  }
  if (job.status === "queued") return "Waiting for a worker";
  return job.progress_note;
}

export function JobRow({
  job,
  onCancel,
  cancelling = false,
}: {
  job: Job;
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const meta = STATUS[job.status];
  const Icon = meta.icon;
  const note = summary(job);
  const active = job.status === "queued" || job.status === "running";
  return (
    <li className="space-y-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Icon
          className={cn("h-4 w-4 shrink-0", meta.className, job.status === "running" && "animate-spin")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-baseline gap-2 text-sm">
            <span className="truncate font-mono font-medium">{job.module}</span>
            <span className="shrink-0 text-2xs uppercase tracking-wider text-muted-foreground">
              {job.queue}
            </span>
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground" title={job.target_value}>
            {job.target_value}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs">
          <p className={cn("font-medium", meta.className)}>
            {job.status === "running" ? `${job.progress}%` : meta.label}
          </p>
          <p className="text-muted-foreground">
            {job.attempts > 1 ? `try ${job.attempts}/${job.max_attempts}` : timeAgo(job.finished_at ?? job.created_at)}
          </p>
        </div>
        {active && onCancel ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={onCancel}
            disabled={cancelling}
            aria-label={`Cancel ${job.module} on ${job.target_value}`}
          >
            {cancelling ? "…" : "Cancel"}
          </Button>
        ) : null}
      </div>
      {active ? (
        <ProgressBar
          value={job.progress}
          indeterminate={job.status === "queued"}
          tone={job.status === "queued" ? "muted" : "accent"}
          label={`${job.module} progress`}
        />
      ) : null}
      {note ? (
        <p
          className={cn(
            "break-words text-xs",
            job.status === "failed" ? "text-danger" : "text-muted-foreground",
          )}
        >
          {note}
        </p>
      ) : null}
    </li>
  );
}
