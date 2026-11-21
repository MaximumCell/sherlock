import type { AdminSource } from "../admin/types";
import type { DataMode } from "../env";
import type { PlatformEntry } from "../platforms";
import type {
  AuditEntry,
  BatchCancelled,
  Candidate,
  Case,
  Correlation,
  CreateCaseBody,
  CreateCaseResult,
  Entity,
  Exposure,
  Finding,
  Job,
  ModuleInfo,
  QueueStatus,
  ReviewDecision,
  ScanBody,
  ScanResult,
  UpdateCaseBody,
} from "../types";

export interface SessionInfo {
  userId: string;
  anonymous: boolean;
  email: string | null;
}

export type Unsubscribe = () => void;

export interface TableRows {
  cases: Case;
  raw_findings: Finding;
  correlations: Correlation;
  jobs: Job;
  entities: Entity;
}
export type RealtimeTable = keyof TableRows;
export type ChangeType = "INSERT" | "UPDATE" | "DELETE";

/** One Realtime change. `row` is null for DELETE. */
export type ChangeEvent = {
  [T in RealtimeTable]: { table: T; type: ChangeType; id: string; row: TableRows[T] | null };
}[RealtimeTable];

export type JobDigest = Pick<Job, "status" | "progress" | "batch_id">;

/** A case plus the few numbers the cases list needs. */
export interface CaseSummary {
  case: Case;
  jobs: JobDigest[];
  pendingReviews: number;
  foundCount: number;
}

export type SignInOutcome = "redirect" | "email_sent" | "signed_in";

/**
 * The single data-access interface of the web app.
 * `supabase.ts` implements it against Supabase (reads + Realtime) and the gateway (commands);
 * `fixtures/` implements it fully in memory.
 */
export interface DataSource {
  readonly mode: DataMode;
  /** Searches need a signed-in account here (the app asks for sign-in before calling the gateway). */
  readonly searchNeedsAccount: boolean;
  /** Operator panel (`/admin`): the gateway's `/admin/*` routes, or bundled fictional data. */
  readonly admin: AdminSource;

  // session
  getSession(): Promise<SessionInfo | null>;
  onSessionChange(cb: (session: SessionInfo | null) => void): Unsubscribe;
  signInWithGitHub(redirectTo: string): Promise<SignInOutcome>;
  signInWithGoogle(redirectTo: string): Promise<SignInOutcome>;
  signInWithEmail(email: string, redirectTo: string): Promise<SignInOutcome>;
  signOut(): Promise<void>;

  // reads (Supabase under RLS)
  listCaseSummaries(): Promise<CaseSummary[]>;
  getCase(id: string): Promise<Case | null>;
  listFindings(caseId: string): Promise<Finding[]>;
  listCorrelations(caseId: string): Promise<Correlation[]>;
  listJobs(caseId: string): Promise<Job[]>;
  listEntities(caseId: string): Promise<Entity[]>;
  listAudit(caseId?: string): Promise<AuditEntry[]>;

  // realtime
  subscribeCase(caseId: string, onEvent: (event: ChangeEvent) => void): Unsubscribe;
  subscribeCaseList(onChange: () => void): Unsubscribe;

  // commands (gateway)
  listModules(): Promise<ModuleInfo[]>;
  /** `GET /platforms` (public): the platform registry behind labels and icons. */
  listPlatforms(): Promise<PlatformEntry[]>;
  createCase(body: CreateCaseBody): Promise<CreateCaseResult>;
  updateCase(id: string, body: UpdateCaseBody): Promise<Case>;
  deleteCase(id: string): Promise<void>;
  scan(caseId: string, body: ScanBody): Promise<ScanResult>;
  cancelJob(caseId: string, jobId: string): Promise<Job>;
  /** Stop one search: every queued or running job of the batch. */
  cancelBatch(caseId: string, batchId: string): Promise<BatchCancelled>;
  /** Queue position of the case's search; null when unknown (gateway asleep or too old). */
  queueStatus(caseId: string): Promise<QueueStatus | null>;
  wake(caseId: string): Promise<void>;
  curateFinding(caseId: string, findingId: string, curated: boolean): Promise<Finding>;
  reviewCorrelation(id: string, decision: ReviewDecision, note?: string): Promise<Correlation>;
  getReport(caseId: string): Promise<string>;
  getExposure(caseId: string): Promise<Exposure>;
  /** Ranked people for a name search; `null` when the gateway does not offer it yet (404). */
  listCandidates(caseId: string): Promise<Candidate[] | null>;
  /** Records the choice; returns the entities added as pivot suggestions (no scans start). */
  confirmCandidate(caseId: string, candidateId: string): Promise<Entity[]>;
}
