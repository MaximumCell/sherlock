/**
 * Row mappers: turn untyped PostgREST / gateway JSON into the strict types in `lib/types.ts`.
 * They are defensive on purpose (legacy rows, nullable columns) and never throw on odd shapes.
 */
import {
  CORRELATION_STATUSES,
  FINDING_STATUSES,
  JOB_STATUSES,
  QUEUES,
  TARGET_TYPES,
  type AuditEntry,
  type Case,
  type Correlation,
  type CorrelationStatus,
  type Entity,
  type EvidenceItem,
  type Candidate,
  type CandidateHandle,
  EXPOSURE_BANDS,
  type Exposure,
  type ExposureBand,
  type ExposureFactor,
  type Finding,
  type FindingMetadata,
  type FindingStatus,
  type Identifier,
  type Job,
  type JobStatus,
  type JsonObject,
  type JsonValue,
  type ModuleInfo,
  type Queue,
  type TargetType,
} from "../types";

type Row = Record<string, unknown>;

export function isRecord(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : fallback;
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: unknown): boolean => v === true || v === "true";
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

function oneOf<T extends string>(allowed: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function toJson(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(toJson);
  if (isRecord(value)) return toJsonObject(value);
  return null;
}

export function toJsonObject(value: unknown): JsonObject {
  if (!isRecord(value)) return {};
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== undefined) out[k] = toJson(v);
  }
  return out;
}

export function toIdentifier(value: unknown): Identifier | null {
  if (!isRecord(value)) return null;
  const v = str(value.value).trim();
  if (!v) return null;
  return { type: oneOf<TargetType>(TARGET_TYPES, value.type, "username"), value: v };
}

export function toExposure(value: unknown): Exposure {
  const r = isRecord(value) ? value : {};
  const score = Math.max(0, Math.min(100, Math.round(num(r.score))));
  const factors = Array.isArray(r.factors)
    ? r.factors.filter(isRecord).map<ExposureFactor>((f) => ({
        key: str(f.key, str(f.label)),
        label: str(f.label, str(f.key)),
        points: Math.max(0, num(f.points)),
        max_points: Math.max(0, num(f.max_points)),
        detail: str(f.detail),
        evidence_finding_ids: strArray(f.evidence_finding_ids),
        remediation: strArray(f.remediation),
      }))
    : [];
  factors.sort((x, y) => y.points - x.points);
  const from = isRecord(r.computed_from) ? r.computed_from : {};
  return {
    score,
    band: oneOf(EXPOSURE_BANDS, r.band, bandFor(score)),
    factors,
    computed_from: {
      findings: num(from.findings),
      approved_correlations: num(from.approved_correlations),
    },
    method: str(r.method),
  };
}

/** Mirrors `sherlock_core.scoring.BANDS`. */
export function bandFor(score: number): ExposureBand {
  if (score < 20) return "low";
  if (score < 45) return "moderate";
  if (score < 70) return "high";
  return "severe";
}

function toCandidateHandle(value: unknown): CandidateHandle | null {
  if (typeof value === "string") return value.trim() ? { platform: null, handle: value.trim(), url: null } : null;
  if (!isRecord(value)) return null;
  const handle = str(value.handle, str(value.username, str(value.value))).trim();
  if (!handle) return null;
  return { platform: strOrNull(value.platform), handle, url: strOrNull(value.url) };
}

export function toCandidate(row: unknown): Candidate | null {
  if (!isRecord(row)) return null;
  const id = str(row.candidate_id, str(row.id));
  if (!id) return null;
  const attrs = isRecord(row.attributes) ? row.attributes : {};
  const list = (v: unknown) => (typeof v === "string" ? [v] : strArray(v)).filter(Boolean);
  return {
    candidate_id: id,
    label: str(row.label, "Unnamed candidate"),
    score: Math.max(0, Math.min(1, num(row.score))),
    evidence: list(row.evidence),
    finding_ids: strArray(row.finding_ids),
    confirmed: bool(row.confirmed),
    attributes: {
      employers: list(attrs.employers),
      locations: list(attrs.locations),
      handles: Array.isArray(attrs.handles)
        ? attrs.handles.map(toCandidateHandle).filter((h): h is CandidateHandle => h !== null)
        : [],
      links: list(attrs.links),
      sources: list(attrs.sources),
    },
  };
}

export function toCase(row: unknown): Case {
  const r = isRecord(row) ? row : {};
  const identifiers = Array.isArray(r.identifiers)
    ? r.identifiers.map(toIdentifier).filter((i): i is Identifier => i !== null)
    : [];
  return {
    id: str(r.id),
    title: strOrNull(r.title),
    notes: str(r.notes),
    tags: strArray(r.tags),
    identifiers,
    status: str(r.status, "open"),
    owner_id: strOrNull(r.owner_id),
    is_demo: bool(r.is_demo),
    created_at: str(r.created_at),
    updated_at: strOrNull(r.updated_at),
    archived_at: strOrNull(r.archived_at),
  };
}

export function toFindingMetadata(value: unknown): FindingMetadata {
  const meta: FindingMetadata = toJsonObject(value);
  const extra = meta.extra;
  meta.extra = isRecord(extra) ? (extra as JsonObject) : {};
  return meta;
}

export function toFinding(row: unknown): Finding {
  const r = isRecord(row) ? row : {};
  const meta = toFindingMetadata(r.extra_metadata);
  const sourceTool = str(r.source_tool);
  return {
    id: str(r.id),
    case_id: str(r.case_id),
    identifier_type: str(r.identifier_type),
    identifier_value: str(r.identifier_value),
    source_tool: sourceTool,
    module: strOrNull(r.module) ?? (sourceTool || null),
    platform: str(r.platform),
    status: oneOf<FindingStatus>(FINDING_STATUSES, r.status, "error"),
    finding_key: str(r.finding_key),
    extra_metadata: meta,
    // v1 rows kept the flag inside the metadata blob
    curated: bool(r.curated) || meta.curated === true,
    job_id: strOrNull(r.job_id),
    collected_at: str(r.collected_at),
  };
}

export function toEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return typeof value === "string" && value ? [value] : [];
  const out: EvidenceItem[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item.trim()) out.push(item);
    } else if (isRecord(item) && typeof item.finding_id === "string") {
      out.push({ finding_id: item.finding_id, field: str(item.field), value: str(item.value) });
    } else if (item !== null && item !== undefined) {
      out.push(JSON.stringify(item));
    }
  }
  return out;
}

export function toCorrelation(row: unknown): Correlation {
  const r = isRecord(row) ? row : {};
  const fallback: CorrelationStatus = bool(r.reviewed) ? "approved" : "pending";
  const status = oneOf<CorrelationStatus>(CORRELATION_STATUSES, r.status, fallback);
  return {
    id: str(r.id),
    case_id: str(r.case_id),
    type: str(r.type, "unknown"),
    corr_key: str(r.corr_key),
    matched_value: strOrNull(r.matched_value),
    entities_involved: strArray(r.entities_involved),
    confidence: Math.max(0, Math.min(1, num(r.confidence))),
    evidence: toEvidence(r.evidence),
    priority: num(r.priority),
    status,
    reviewed: status === "approved",
    review_note: strOrNull(r.review_note),
    reviewed_at: strOrNull(r.reviewed_at),
    created_at: str(r.created_at),
  };
}

export function toJob(row: unknown): Job {
  const r = isRecord(row) ? row : {};
  return {
    id: str(r.id),
    case_id: str(r.case_id),
    batch_id: strOrNull(r.batch_id),
    queue: oneOf<Queue>(QUEUES, r.queue, "identity"),
    module: str(r.module),
    target_type: str(r.target_type),
    target_value: str(r.target_value),
    params: toJsonObject(r.params),
    status: oneOf<JobStatus>(JOB_STATUSES, r.status, "queued"),
    progress: Math.max(0, Math.min(100, Math.round(num(r.progress)))),
    progress_note: strOrNull(r.progress_note),
    attempts: num(r.attempts),
    max_attempts: num(r.max_attempts, 3),
    result: isRecord(r.result) ? toJsonObject(r.result) : null,
    error: strOrNull(r.error),
    created_at: str(r.created_at),
    started_at: strOrNull(r.started_at),
    finished_at: strOrNull(r.finished_at),
  };
}

export function toEntity(row: unknown): Entity {
  const r = isRecord(row) ? row : {};
  return {
    id: str(r.id),
    case_id: str(r.case_id),
    kind: str(r.kind),
    value: str(r.value),
    platform: strOrNull(r.platform),
    source_finding_id: strOrNull(r.source_finding_id),
    is_seed: bool(r.is_seed),
    scanned: bool(r.scanned),
    first_seen: str(r.first_seen),
  };
}

export function toAuditEntry(row: unknown): AuditEntry {
  const r = isRecord(row) ? row : {};
  return {
    id: num(r.id),
    case_id: strOrNull(r.case_id),
    action: str(r.action),
    actor: str(r.actor),
    detail: toJsonObject(r.detail),
    created_at: str(r.created_at),
  };
}

export function toModuleInfo(row: unknown): ModuleInfo {
  const r = isRecord(row) ? row : {};
  return {
    name: str(r.name),
    title: str(r.title) || str(r.name),
    description: str(r.description),
    inputs: strArray(r.inputs),
    queue: oneOf<Queue>(QUEUES, r.queue, "identity"),
    requires_env: strArray(r.requires_env),
    available: r.available === undefined ? true : bool(r.available),
    source_url: strOrNull(r.source_url),
  };
}

export const toList = <T>(rows: unknown, map: (row: unknown) => T): T[] =>
  Array.isArray(rows) ? rows.map(map) : [];
