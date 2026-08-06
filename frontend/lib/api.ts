// Typed fetch client for the FastAPI backend.
// Base URL comes from NEXT_PUBLIC_API_URL (set in frontend/.env.local).

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
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status} ${path}: ${body}`);
  }
  // 204 No Content has no body
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const listCases = () => api<Case[]>("/cases");
export const getCase = (id: string) => api<Case>(`/cases/${id}`);
export const createCase = (identifiers: Identifier[]) =>
  api<Case>("/cases", { method: "POST", body: JSON.stringify({ identifiers }) });
export const runCase = (id: string) =>
  api<Case>(`/cases/${id}/run`, { method: "POST" });
export const deleteCase = (id: string) =>
  api<void>(`/cases/${id}`, { method: "DELETE" });

export const listFindings = (id: string) => api<Finding[]>(`/cases/${id}/findings`);
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
