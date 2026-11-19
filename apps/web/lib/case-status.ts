import type { Case, Job, JobStatus } from "./types";

export type CaseStatusKind = "archived" | "scanning" | "needs_review" | "idle";

export interface DerivedCaseStatus {
  kind: CaseStatusKind;
  label: string;
  /** 0..100, only while scanning. */
  progress?: number;
  /** Jobs still queued or running. */
  activeJobs: number;
  pendingReviews: number;
}

type JobLike = Pick<Job, "status" | "progress" | "batch_id">;

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["queued", "running"];

export function isActiveJob(job: Pick<Job, "status">): boolean {
  return job.status === "queued" || job.status === "running";
}

/**
 * Progress of the batches that are still in flight: finished jobs of an active
 * batch count as 100, so the bar never jumps backwards when one job completes.
 */
export function scanProgress(jobs: readonly JobLike[]): number {
  const activeBatches = new Set(jobs.filter(isActiveJob).map((j) => j.batch_id ?? "none"));
  const relevant = jobs.filter((j) => activeBatches.has(j.batch_id ?? "none"));
  if (relevant.length === 0) return 0;
  const total = relevant.reduce((sum, j) => {
    if (j.status === "queued") return sum;
    if (j.status === "running") return sum + Math.max(0, Math.min(100, j.progress));
    return sum + 100;
  }, 0);
  return Math.round(total / relevant.length);
}

/** Status shown on the cases list: archived > scanning > needs review > idle. */
export function deriveCaseStatus(
  c: Pick<Case, "archived_at">,
  jobs: readonly JobLike[],
  pendingReviews: number,
): DerivedCaseStatus {
  const activeJobs = jobs.filter(isActiveJob).length;
  if (c.archived_at) {
    return { kind: "archived", label: "Archived", activeJobs, pendingReviews };
  }
  if (activeJobs > 0) {
    return {
      kind: "scanning",
      label: "Scanning",
      progress: scanProgress(jobs),
      activeJobs,
      pendingReviews,
    };
  }
  if (pendingReviews > 0) {
    return {
      kind: "needs_review",
      label: `${pendingReviews} to review`,
      activeJobs,
      pendingReviews,
    };
  }
  return { kind: "idle", label: "Idle", activeJobs, pendingReviews };
}

export function caseDisplayTitle(c: Pick<Case, "title" | "identifiers">): string {
  const title = c.title?.trim();
  if (title) return title;
  const first = c.identifiers[0];
  if (!first) return "Untitled case";
  const more = c.identifiers.length - 1;
  return more > 0 ? `${first.value} +${more}` : first.value;
}
