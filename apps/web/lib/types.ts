/**
 * Hand-written mirror of `packages/core/sherlock_core/models.py`.
 * Field names and literal unions must match the Python models exactly.
 */

export const TARGET_TYPES = [
  "username",
  "email",
  "domain",
  "ip",
  "image",
  "phone",
  "wallet",
  "name",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const QUEUES = ["identity", "infra", "media"] as const;
export type Queue = (typeof QUEUES)[number];

export const FINDING_STATUSES = ["found", "not_found", "error"] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const CORRELATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type CorrelationStatus = (typeof CORRELATION_STATUSES)[number];

export type ReviewDecision = "approve" | "reject" | "reset";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface Identifier {
  type: TargetType;
  value: string;
}

/** Optional exposure summary. Not produced by the backend yet; the UI hides it when absent. */
export interface ExposureFactor {
  label: string;
  detail: string;
  weight: number;
}
export interface Exposure {
  score: number; // 0..100
  level: "low" | "moderate" | "high" | "critical";
  factors: ExposureFactor[];
  computed_at?: string | null;
}

export interface Case {
  id: string;
  title: string | null;
  notes: string;
  tags: string[];
  identifiers: Identifier[];
  status: string;
  owner_id: string | null;
  is_demo: boolean;
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
  /** Web-side optional extension, see `Exposure`. */
  exposure?: Exposure | null;
}

/** `extra_metadata = { url, extra: {...source fields}, ...top-level meta }` */
export interface FindingMetadata {
  url?: string | null;
  extra?: JsonObject;
  [key: string]: JsonValue | undefined;
}

export interface Finding {
  id: string;
  case_id: string;
  identifier_type: string;
  identifier_value: string;
  source_tool: string;
  module: string | null;
  platform: string;
  status: FindingStatus;
  finding_key: string;
  extra_metadata: FindingMetadata;
  curated: boolean;
  job_id: string | null;
  collected_at: string;
}

export interface EvidenceRef {
  finding_id: string;
  field: string;
  value: string;
}
export type EvidenceItem = string | EvidenceRef;

export interface Correlation {
  id: string;
  case_id: string;
  type: string; // rule name
  corr_key: string;
  matched_value: string | null;
  entities_involved: string[]; // finding ids
  confidence: number; // 0..1
  evidence: EvidenceItem[];
  priority: number;
  status: CorrelationStatus;
  reviewed: boolean;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface JobResult {
  findings?: number;
  found?: number;
  [key: string]: JsonValue | undefined;
}

export interface Job {
  id: string;
  case_id: string;
  batch_id: string | null;
  queue: Queue;
  module: string;
  target_type: string;
  target_value: string;
  params: JsonObject;
  status: JobStatus;
  progress: number; // 0..100
  progress_note: string | null;
  attempts: number;
  max_attempts: number;
  result: JobResult | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface Entity {
  id: string;
  case_id: string;
  kind: string;
  value: string;
  platform: string | null;
  source_finding_id: string | null;
  is_seed: boolean;
  scanned: boolean;
  first_seen: string;
}

export interface ModuleInfo {
  name: string;
  title: string;
  description: string;
  inputs: string[];
  queue: Queue;
  requires_env: string[];
  available: boolean;
  source_url: string | null;
}

/** `audit_log` row (supabase/schema_v1.sql). */
export interface AuditEntry {
  id: number;
  case_id: string | null;
  action: string;
  actor: string;
  detail: JsonObject;
  created_at: string;
}

// ------------------------------------------------------------------ gateway bodies
export interface CreateCaseBody {
  title?: string;
  tags?: string[];
  identifiers: Identifier[];
  scan?: boolean;
}
export interface CreateCaseResult {
  case: Case;
  jobs: Job[];
}
export interface UpdateCaseBody {
  title?: string;
  notes?: string;
  tags?: string[];
  archived?: boolean;
}
export interface ScanBody {
  type: TargetType;
  value: string;
  modules?: string[];
}
export interface ScanResult {
  batch_id: string;
  jobs: Job[];
}
