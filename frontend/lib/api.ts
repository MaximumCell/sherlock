// Typed fetch client for the FastAPI backend.
// Base URL comes from NEXT_PUBLIC_API_URL (set in frontend/.env.local).
import { apiBegin, apiEnd } from "@/components/api-inflight";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type IdentifierType = "username" | "email" | "domain";

export interface Identifier {
  type: IdentifierType;
  value: string;
}

export interface Case {
  id: string;
  identifiers: Identifier[];
  status: string;
  created_at: string;
}

export interface Finding {
  id: string;
  case_id: string;
  identifier_type: string;
  identifier_value: string;
  source_tool: string;
  platform: string;
  status: string;
  extra_metadata: Record<string, unknown>;
  collected_at: string;
  curated?: boolean;
}

export interface Correlation {
  id: string;
  case_id: string;
  type: string;
  entities_involved: string[];
  confidence: number;
  evidence: string[];
  priority: number;
  reviewed: boolean;
  review_note: string | null;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  case_id: string | null;
  action: string;
  actor: string;
  detail: Record<string, unknown>;
  created_at: string;
}

export interface ChatResult {
  text: string;
  iterations: number;
  tool_calls_made: { name: string; args: Record<string, unknown>; result: unknown }[];
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Long scans (200+ platforms) can run for ~2 minutes. Use a 3-minute
  // client-side cap so we get a clean error instead of an opaque
  // "Failed to fetch" if the backend dies mid-request.
  const TIMEOUT_MS = 180_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  // Tick the global progress bar so the user sees something is happening
  // even for fast calls.
  apiBegin();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
  } catch (e) {
    apiEnd();
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(
        `Request timed out after ${TIMEOUT_MS / 1000}s — the backend at ${API_BASE} is slow or unresponsive.`,
      );
    }
    // The browser's "Failed to fetch" wraps any network failure
    // (server down, connection refused, DNS error, CORS, etc.).
    // Re-raise with a hint so the user knows what to check.
    throw new Error(
      `Couldn't reach backend at ${API_BASE} — is uvicorn running on :8000? (${e instanceof Error ? e.message : String(e)})`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    apiEnd();
    const body = await res.text();
    // FastAPI's default error shape is {"detail": "..."} (or an array of
    // validation errors). Surface the detail so the user sees a useful
    // message instead of raw JSON. Falls back to the raw body if detail
    // isn't present.
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      if (typeof parsed === "object" && parsed !== null) {
        if (typeof parsed.detail === "string") {
          detail = parsed.detail;
        } else if (Array.isArray(parsed.detail)) {
          // Pydantic validation error array — first message is usually enough.
          const first = parsed.detail[0];
          detail = first?.msg
            ? `${first.loc?.join(".") || "field"}: ${first.msg}`
            : JSON.stringify(first);
        }
      }
    } catch {
      // body wasn't JSON — use it as-is
    }
    throw new Error(`API ${res.status} ${path}: ${detail}`);
  }
  // 204 No Content has no body
  if (res.status === 204) {
    apiEnd();
    return undefined as T;
  }
  const parsed = (await res.json()) as T;
  apiEnd();
  return parsed;
}

export const listCases = () => api<Case[]>("/cases");
export const getCase = (id: string) => api<Case>(`/cases/${id}`);
export const createCase = (identifiers: Identifier[]) =>
  api<Case>("/cases", { method: "POST", body: JSON.stringify({ identifiers }) });
export const runCase = (id: string) =>
  api<Case>(`/cases/${id}/run`, { method: "POST" });
export const runWithVariations = (id: string, count: number = 5) =>
  api<{ case: Case; variations: Record<string, string[]>; variations_scanned: number }>(
    `/cases/${id}/run-with-variations?count=${count}`,
    { method: "POST" },
  );
export const getVariations = (
  id: string,
  count: number = 5,
  exclude: string[] = [],
) =>
  api<{
    case_id: string;
    identifiers: { type: string; value: string }[];
    variations: Record<string, string[]>;
  }>(
    `/cases/${id}/variations?count=${count}${
      exclude.length ? `&exclude=${encodeURIComponent(exclude.join(","))}` : ""
    }`,
  );
export const scanUsername = (id: string, username: string) =>
  api<{ job_id: string; status: string; scanned: string; type: "username" }>(
    `/cases/${id}/scan-username?username=${encodeURIComponent(username)}`,
    { method: "POST" },
  );
export const scanEmail = (id: string, email: string) =>
  api<{ job_id: string; status: string; scanned: string; type: "email" }>(
    `/cases/${id}/scan-email?email=${encodeURIComponent(email)}`,
    { method: "POST" },
  );

export type Job = {
  id: string;
  case_id: string;
  kind: string;
  target: string;
  status: "running" | "completed" | "failed";
  started_at: number;
  finished_at: number | null;
  elapsed_s: number;
  result: { scanned: string; type: string; findings_added: number; correlations_total: number } | null;
  error: string | null;
};

export const getJob = (caseId: string, jobId: string) =>
  api<Job>(`/cases/${caseId}/jobs/${jobId}`);
export const listJobs = (caseId: string) =>
  api<Job[]>(`/cases/${caseId}/jobs`);
export const enrichFinding = (id: string, findingId: string) =>
  api<{ scraped_url: string; platform: string; finding_id: string | null; correlations_total: number }>(
    `/cases/${id}/enrich?finding_id=${encodeURIComponent(findingId)}`,
    { method: "POST" },
  );
export const deleteCase = (id: string) =>
  api<void>(`/cases/${id}`, { method: "DELETE" });

export const listFindings = (id: string, curated?: boolean) =>
  api<Finding[]>(`/cases/${id}/findings${curated !== undefined ? `?curated=${curated}` : ""}`);

export const curateFinding = (caseId: string, findingId: string, curated: boolean) =>
  api<{ id: string; curated: boolean; platform: string; identifier_value: string }>(
    `/cases/${caseId}/findings/${findingId}/curate`,
    { method: "POST", body: JSON.stringify({ curated }) },
  );
export const createManualLink = (caseId: string, findingA: string, findingB: string, note?: string) =>
  api<unknown>(
    `/cases/${caseId}/correlations`,
    { method: "POST", body: JSON.stringify({ finding_a: findingA, finding_b: findingB, note }) },
  );

export const enrichCurated = (caseId: string) =>
  api<{ job_id: string; status: string; scanned: string; type: string }>(
    `/cases/${caseId}/enrich-curated`,
    { method: "POST" },
  );
export const listCorrelations = (id: string, reviewed?: boolean) => {
  const q = reviewed === undefined ? "" : `?reviewed=${reviewed}`;
  return api<Correlation[]>(`/cases/${id}/correlations${q}`);
};
export const reviewCorrelation = (id: string, decision: "approve" | "reject", note?: string) =>
  api<{ id: string; decision: string; note: string | null }>(
    `/correlations/${id}/review`,
    { method: "POST", body: JSON.stringify({ decision, note }) },
  );

export async function getReport(id: string): Promise<string> {
  const res = await fetch(`${API_BASE}/cases/${id}/report`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.text();
}

export const chat = (id: string, message: string) =>
  api<ChatResult>(`/cases/${id}/chat`, { method: "POST", body: JSON.stringify({ message }) });

export const listAudit = (caseId?: string) => {
  const q = caseId ? `?case_id=${encodeURIComponent(caseId)}` : "";
  return api<AuditEntry[]>(`/audit${q}`);
};
