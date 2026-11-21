/**
 * Operator panel types: a hand-written mirror of the `/admin/*` response models in
 * `services/gateway/gateway/schemas.py`. Field names must match.
 */
import type { Identifier } from "../types";

export const SEARCH_OUTCOMES = [
  "accepted",
  "rate_limited",
  "blocked",
  "paused",
  "forbidden",
  "invalid",
  "burst_limited",
  "active_search",
  "busy",
  "sign_in_required",
] as const;
export type SearchOutcome = (typeof SEARCH_OUTCOMES)[number];

export type FlagSeverity = "high" | "medium" | "low";

export interface MisuseFlag {
  key: string;
  label: string;
  severity: FlagSeverity;
}

export interface AdminMe {
  is_admin: true;
  email: string;
}

/** Who ran a search. `origin` is a keyed hash of the IP address, never the address. */
export interface SessionBrief {
  user_id: string;
  is_anonymous: boolean;
  email: string | null;
  user_agent: string | null;
  country: string | null;
  origin: string | null;
  origin_sessions: number;
  blocked: boolean;
}

export interface VisitorSession extends SessionBrief {
  first_seen: string | null;
  last_seen: string | null;
  search_count: number;
  refused_count: number;
  blocked_at: string | null;
  blocked_reason: string | null;
  flags: MisuseFlag[];
}

export interface SearchLogRow {
  id: number;
  created_at: string;
  user_id: string;
  case_id: string | null;
  target_type: string;
  target_value: string;
  modules: string[] | null;
  outcome: SearchOutcome;
  detail: string | null;
  country: string | null;
  is_anonymous: boolean;
  session: SessionBrief | null;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface CaseMeta {
  id: string;
  title: string | null;
  identifiers: Identifier[];
  status: string | null;
  created_at: string | null;
  archived_at: string | null;
  job_count: number;
  found_count: number;
}

export interface SessionDetail {
  session: VisitorSession;
  searches: SearchLogRow[];
  cases: CaseMeta[];
}

export type DayPoint = { day: string } & Record<SearchOutcome, number>;

export interface Overview {
  days: number;
  since: string;
  totals: {
    searches: number;
    accepted: number;
    refused: number;
    sessions: number;
    flagged_sessions: number;
    cases: number;
    active_jobs: number;
  };
  series: DayPoint[];
  by_type: { target_type: string; count: number }[];
  top_targets: { target_type: string; target_value: string; count: number; sessions: number }[];
  quota: {
    global_used_today: number;
    global_limit: number;
    per_session_limit: number;
    name_per_user_limit: number;
  };
  scans_paused: boolean;
  retention_days: number;
  truncated: boolean;
}

export interface SearchFilters {
  outcome?: SearchOutcome;
  type?: string;
  q?: string;
  session?: string;
  since?: string;
  limit?: number;
  cursor?: string | null;
}

export interface SessionFilters {
  flagged?: boolean;
  blocked?: boolean;
  q?: string;
  limit?: number;
  cursor?: string | null;
}

/**
 * The operator panel's data access. `gateway-source.ts` calls `/admin/*`; `demo-source.ts`
 * serves bundled fictional data (fixture mode and `/demo/admin`).
 */
export interface AdminSource {
  readonly demo: boolean;
  /** The operator, or null when this session is not one (the gateway answers 404). */
  me(options?: { quiet?: boolean }): Promise<AdminMe | null>;
  overview(days: number): Promise<Overview>;
  searches(filters: SearchFilters): Promise<Page<SearchLogRow>>;
  sessions(filters: SessionFilters): Promise<Page<VisitorSession>>;
  session(userId: string): Promise<SessionDetail>;
  block(userId: string, reason: string): Promise<VisitorSession>;
  unblock(userId: string): Promise<VisitorSession>;
  setPaused(paused: boolean): Promise<boolean>;
  deleteCase(caseId: string): Promise<void>;
}
