/**
 * Plain-English progress of a case: how far the scan is, what the three steps
 * of the progress rail say, and the one-line status on the start screen.
 */
import { isActiveJob } from "./case-status";
import type { JobDigest } from "./data/types";
import type { ExposureBand, JobStatus } from "./types";

type JobLike = Pick<JobDigest, "status" | "batch_id">;

export interface SourceProgress {
  /** Every data-source run of the investigation, whatever batch it belongs to. */
  total: number;
  /** Finished in any way: succeeded, failed or cancelled. */
  done: number;
  /** Finished without a result: failed or cancelled ("could not be checked"). */
  failed: number;
  active: number;
  scanning: boolean;
}

const FINISHED: readonly JobStatus[] = ["succeeded", "failed", "cancelled"];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Progress across ALL data sources of the investigation, so "11 of 14" always matches the
 * checklist. Failed and cancelled sources count as done but are tallied in `failed`.
 */
export function sourceProgress(jobs: readonly JobLike[]): SourceProgress {
  const active = jobs.filter(isActiveJob).length;
  return {
    total: jobs.length,
    done: jobs.filter((j) => FINISHED.includes(j.status)).length,
    failed: jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length,
    active,
    scanning: active > 0,
  };
}

/** "11 of 14 sources done · 1 could not be checked" */
export function sourceProgressText(p: SourceProgress): string {
  const base = `${p.done} of ${plural(p.total, "source")} done`;
  return p.failed ? `${base} · ${p.failed} could not be checked` : base;
}

export type StepState = "done" | "current" | "upcoming";
export type StepId = "scan" | "links" | "report";

export interface ProgressStep {
  id: StepId;
  title: string;
  /** One-word title for narrow screens. */
  short: string;
  state: StepState;
  /** Short live status, e.g. "14/18 sources", "3 to check", "Ready". */
  detail: string;
}

export interface StepInput {
  jobs: readonly JobLike[];
  pendingLinks: number;
  totalLinks: number;
  /** Found results; results without any scan job (imported or older cases) count as scanned. */
  results?: number;
}

/** The three steps of the case page: 1 Scanning → 2 Check the links → 3 Report ready. */
export function deriveSteps({
  jobs,
  pendingLinks,
  totalLinks,
  results = 0,
}: StepInput): ProgressStep[] {
  const p = sourceProgress(jobs);
  const scanned = p.total > 0 || results > 0;
  const scan: ProgressStep = {
    id: "scan",
    title: "Scanning",
    short: "Scan",
    state: p.scanning ? "current" : scanned ? "done" : "current",
    detail: p.scanning
      ? `${p.done}/${p.total} sources`
      : p.total > 0
        ? `${plural(p.total, "source")} checked`
        : scanned
          ? "Done"
          : "Not started",
  };
  const links: ProgressStep = {
    id: "links",
    title: "Check the links",
    short: "Links",
    state:
      pendingLinks > 0
        ? p.scanning
          ? "upcoming"
          : "current"
        : p.scanning || !scanned
          ? "upcoming"
          : "done",
    detail:
      pendingLinks > 0
        ? `${pendingLinks} to check`
        : totalLinks > 0
          ? "All checked"
          : p.scanning || !scanned
            ? "Waiting for results"
            : "None to check",
  };
  const ready = !p.scanning && scanned && pendingLinks === 0;
  const report: ProgressStep = {
    id: "report",
    title: "Report ready",
    short: "Report",
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
  if (p.scanning) return `Scanning · ${sourceProgressText(p)}`;
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
