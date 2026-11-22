import { findingTitle } from "./findings";
import { sourceTitle } from "./sources";
import type { AuditEntry, Case, Finding, Job } from "./types";
import { displayTargetValue } from "./uploads";

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
  /** Technical identifiers, shown only with Advanced on. */
  raw?: string;
}

/** Plain-language titles; `{source}` is replaced by the data source's name. */
const AUDIT_TITLES: Record<string, string> = {
  case_created: "Investigation started",
  scan_requested: "You started a search",
  collector_run: "Finished checking {source}",
  collector_failed: "{source} could not finish",
  correlation: "Looked for possible links",
  review: "You decided on a possible link",
  report: "Report created",
  agent_call: "Assistant used",
  candidate_confirmed: "You chose a person",
  batch_cancelled: "You stopped a search",
  admin_case_viewed: "The operator reviewed this investigation to prevent misuse",
};

const DETAIL_KEYS: Record<string, string> = {
  findings: "results",
  jobs: "sources",
  identifiers: "targets",
  rule: "reason",
};

const DECISION_WORDS: Record<string, string> = {
  approve: "yes, same",
  reject: "no",
  reset: "undone",
};

function detailText(detail: AuditEntry["detail"]): string | null {
  const parts = Object.entries(detail)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .map(([k, v]) => {
      const value = k === "decision" ? (DECISION_WORDS[String(v)] ?? String(v)) : String(v);
      return `${DETAIL_KEYS[k] ?? k.replace(/_/g, " ")}: ${value}`;
    });
  return parts.length ? parts.join(" · ") : null;
}

/** Audit actors are either the investigator or a data-source id. */
const actorIsSource = (actor: string) =>
  actor !== "investigator" &&
  actor !== "system" &&
  actor !== "operator" &&
  actor !== "user" &&
  !actor.includes("@");

/** Plain title and detail line for one activity-log entry. */
export function describeAudit(a: AuditEntry): { title: string; detail: string | null; by: string } {
  return {
    by:
      a.actor === "investigator" || a.actor === "user"
        ? "You"
        : a.actor === "operator"
          ? "Operator"
          : actorIsSource(a.actor)
            ? sourceTitle(a.actor)
            : a.actor,
    title: (AUDIT_TITLES[a.action] ?? a.action.replace(/_/g, " ")).replace(
      "{source}",
      actorIsSource(a.actor) ? sourceTitle(a.actor) : "a data source",
    ),
    detail: detailText(a.detail),
  };
}

function auditEvent(a: AuditEntry): TimelineEvent {
  const kind: TimelineKind =
    a.action === "admin_case_viewed"
      ? "audit"
      : a.action === "review"
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
    title: describeAudit(a).title,
    detail: describeAudit(a).detail,
    raw: `${a.action} · actor ${a.actor}`,
  };
}

function jobEvents(job: Job): TimelineEvent[] {
  const source = sourceTitle(job.module);
  const raw = `job ${job.id} · ${job.module} · queue ${job.queue} · attempt ${job.attempts}/${job.max_attempts}`;
  const events: TimelineEvent[] = [];
  if (job.started_at) {
    events.push({
      id: `job-start-${job.id}`,
      at: job.started_at,
      kind: "job",
      tone: "neutral",
      title: `Started checking ${source} for ${displayTargetValue(job.target_value)}`,
      detail: job.attempts > 1 ? `try ${job.attempts} of ${job.max_attempts}` : null,
      raw,
    });
  }
  if (job.finished_at) {
    const found = job.result?.found;
    events.push({
      id: `job-end-${job.id}`,
      at: job.finished_at,
      kind: "job",
      tone: job.status === "failed" ? "danger" : job.status === "succeeded" ? "success" : "neutral",
      title:
        job.status === "failed"
          ? `${source} could not finish for ${displayTargetValue(job.target_value)}`
          : job.status === "cancelled"
            ? `Stopped checking ${source} for ${displayTargetValue(job.target_value)}`
            : `Finished checking ${source} for ${displayTargetValue(job.target_value)}`,
      detail:
        job.status === "failed"
          ? job.error
          : typeof found === "number"
            ? `${found} found of ${job.result?.findings ?? found} checked`
            : null,
      raw,
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
      title: "Investigation started",
      detail: null,
    });
  }
  return events
    .filter((e) => !Number.isNaN(Date.parse(e.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

export function groupByDay(
  events: readonly TimelineEvent[],
): [day: string, items: TimelineEvent[]][] {
  const groups = new Map<string, TimelineEvent[]>();
  for (const e of events) {
    const day = e.at.slice(0, 10);
    const list = groups.get(day) ?? [];
    list.push(e);
    groups.set(day, list);
  }
  return [...groups.entries()];
}
