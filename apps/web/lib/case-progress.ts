/**
 * Plain-English progress of a case: how far the scan is, what the three steps
 * of the progress rail say, and the one-line status on the start screen.
 */
import { isActiveJob } from "./case-status";
import type { JobDigest } from "./data/types";
import type { ExposureBand, JobStatus } from "./types";

type JobLike = Pick<JobDigest, "status" | "batch_id">;

export interface SourceProgress {
  /** Sources in the current scan (or in all scans once nothing is running). */
  total: number;
  /** Finished in any way: succeeded, failed or cancelled. */
  done: number;
  failed: number;
  active: number;
  scanning: boolean;
}

const FINISHED: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

/**
 * While something runs, count only the batches still in flight, so "12 of 18"
 * describes the current scan, not every scan ever run on the case.
 */
export function sourceProgress(jobs: readonly JobLike[]): SourceProgress {
  const active = jobs.filter(isActiveJob);
  const batches = new Set(active.map((j) => j.batch_id ?? "none"));
  const scope = active.length ? jobs.filter((j) => batches.has(j.batch_id ?? "none")) : jobs;
  return {
    total: scope.length,
    done: scope.filter((j) => FINISHED.includes(j.status)).length,
    failed: scope.filter((j) => j.status === "failed").length,
    active: active.length,
    scanning: active.length > 0,
  };
}

export type StepState = "done" | "current" | "upcoming";
export type StepId = "scan" | "links" | "report";

export interface ProgressStep {
  id: StepId;
  title: string;
  state: StepState;
  /** Short live status, e.g. "14/18 sources", "3 to check", "Ready". */
  detail: string;
}

export interface StepInput {
  jobs: readonly JobLike[];
  pendingLinks: number;
  totalLinks: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The three steps of the case page: 1 Scanning → 2 Check the links → 3 Report ready. */
export function deriveSteps({ jobs, pendingLinks, totalLinks }: StepInput): ProgressStep[] {
  const p = sourceProgress(jobs);
  const scan: ProgressStep = {
    id: "scan",
    title: "Scanning",
    state: p.scanning ? "current" : p.total > 0 ? "done" : "current",
    detail: p.scanning
      ? `${p.done}/${p.total} sources`
      : p.total > 0
        ? `${plural(p.total, "source")} checked`
        : "Not started",
  };
  const links: ProgressStep = {
    id: "links",
    title: "Check the links",
    state:
      pendingLinks > 0
        ? p.scanning
          ? "upcoming"
          : "current"
        : p.scanning || p.total === 0
          ? "upcoming"
          : "done",
    detail:
      pendingLinks > 0
        ? `${pendingLinks} to check`
        : totalLinks > 0
          ? "All checked"
          : p.scanning || p.total === 0
            ? "Waiting for results"
            : "None to check",
  };
  const ready = !p.scanning && p.total > 0 && pendingLinks === 0;
  const report: ProgressStep = {
    id: "report",
    title: "Report ready",
    state: ready ? "done" : "upcoming",
    detail: ready ? "Ready" : pendingLinks > 0 && !p.scanning ? "Draft available" : "Not yet",
  };
  return [scan, links, report];
}

const BAND_LABEL: Record<ExposureBand, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
  severe: "Severe",
};

export interface StatusLineInput {
  archived: boolean;
  jobs: readonly JobLike[];
  pendingLinks: number;
  foundCount: number;
  exposure?: { score: number; band: ExposureBand } | null;
}

/** One plain sentence for an investigation card on the start screen. */
export function caseStatusLine(input: StatusLineInput): string {
  if (input.archived) return "Archived";
  const p = sourceProgress(input.jobs);
  if (p.scanning) return `Scanning · ${p.done} of ${p.total} sources done`;
  if (input.pendingLinks > 0) {
    return `${plural(input.pendingLinks, "link")} ${input.pendingLinks === 1 ? "needs" : "need"} your decision`;
  }
  if (p.total === 0 && input.foundCount === 0) return "Not scanned yet";
  const parts = ["Done", plural(input.foundCount, "result")];
  if (input.exposure) {
    parts.push(`exposure ${input.exposure.score} ${BAND_LABEL[input.exposure.band]}`);
  }
  return parts.join(" · ");
}
