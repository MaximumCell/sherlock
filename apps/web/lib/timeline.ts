import { findingTitle } from "./findings";
import type { AuditEntry, Case, Finding, Job } from "./types";

export type TimelineKind = "case" | "scan" | "job" | "review" | "account" | "audit";
export type TimelineTone = "neutral" | "success" | "danger" | "accent";

export interface TimelineEvent {
  id: string;
  at: string;
  kind: TimelineKind;
  tone: TimelineTone;
  title: string;
  detail: string | null;
  findingId?: string;
}

const AUDIT_TITLES: Record<string, string> = {
  case_created: "Case created",
  scan_requested: "Scan requested",
  collector_run: "Collector finished",
  collector_failed: "Collector failed",
  correlation: "Correlation run",
  review: "Correlation reviewed",
  report: "Report generated",
  agent_call: "Assistant call",
};

function detailText(detail: AuditEntry["detail"]): string | null {
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`);
  return parts.length ? parts.join(" · ") : null;
}

function auditEvent(a: AuditEntry): TimelineEvent {
  const kind: TimelineKind =
    a.action === "review"
      ? "review"
      : a.action.startsWith("scan")
        ? "scan"
        : a.action.startsWith("case")
          ? "case"
          : "audit";
  return {
    id: `audit-${a.id}`,
    at: a.created_at,
    kind,
    tone: a.action.includes("fail") ? "danger" : "neutral",
    title: `${AUDIT_TITLES[a.action] ?? a.action.replace(/_/g, " ")} · ${a.actor}`,
    detail: detailText(a.detail),
  };
}

function jobEvents(job: Job): TimelineEvent[] {
  const subject = `${job.module} on ${job.target_value}`;
  const events: TimelineEvent[] = [];
  if (job.started_at) {
    events.push({
      id: `job-start-${job.id}`,
      at: job.started_at,
      kind: "job",
      tone: "neutral",
      title: `Job started · ${subject}`,
      detail: job.attempts > 1 ? `attempt ${job.attempts} of ${job.max_attempts}` : null,
    });
  }
  if (job.finished_at) {
    const found = job.result?.found;
    events.push({
      id: `job-end-${job.id}`,
      at: job.finished_at,
      kind: "job",
      tone: job.status === "failed" ? "danger" : job.status === "succeeded" ? "success" : "neutral",
      title: `Job ${job.status} · ${subject}`,
      detail:
        job.status === "failed"
          ? job.error
          : typeof found === "number"
            ? `${found} found of ${job.result?.findings ?? found} checked`
            : null,
    });
  }
  return events;
}

function accountEvent(f: Finding): TimelineEvent | null {
  if (f.status !== "found") return null;
  const created = f.extra_metadata.extra?.created_at;
  if (typeof created !== "string" || Number.isNaN(Date.parse(created))) return null;
  return {
    id: `account-${f.id}`,
    at: new Date(created).toISOString(),
    kind: "account",
    tone: "accent",
    title: `${findingTitle(f)} account created`,
    detail: f.identifier_value,
    findingId: f.id,
  };
}

export interface TimelineInput {
  case: Case | null;
  audit: readonly AuditEntry[];
  jobs: readonly Job[];
  findings: readonly Finding[];
}

/** Merge audit entries, job lifecycle events and account creation dates, newest first. */
export function buildTimeline(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [
    ...input.audit.map(auditEvent),
    ...input.jobs.flatMap(jobEvents),
    ...input.findings.map(accountEvent).filter((e): e is TimelineEvent => e !== null),
  ];
  const hasCreated = input.audit.some((a) => a.action === "case_created");
  if (input.case && !hasCreated) {
    events.push({
      id: `case-${input.case.id}`,
      at: input.case.created_at,
      kind: "case",
      tone: "neutral",
      title: "Case created",
      detail: null,
    });
  }
  return events
    .filter((e) => !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

export function groupByDay(events: readonly TimelineEvent[]): [day: string, items: TimelineEvent[]][] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const day = e.at.slice(0, 10);
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  return [...groups.entries()];
}
