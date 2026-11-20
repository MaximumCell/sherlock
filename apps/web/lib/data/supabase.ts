/**
 * Real data source: reads + Realtime straight from Supabase under row-level
 * security, commands through the gateway with the session's access token.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { AppEnv } from "../env";
import { toPlatformEntries } from "../platforms";
import type {
  Candidate,
  Case,
  Correlation,
  CreateCaseResult,
  Finding,
  Job,
  ScanResult,
} from "../types";
import { createGatewayAdminSource } from "../admin/gateway-source";
import { createGateway, GatewayError, type GatewayClient, type GatewayRequest } from "./gateway";
import {
  isRecord,
  toAuditEntry,
  toCandidate,
  toCase,
  toCorrelation,
  toEntity,
  toExposure,
  toFinding,
  toJob,
  toList,
  toModuleInfo,
} from "./mappers";
import type {
  CaseSummary,
  ChangeEvent,
  ChangeType,
  DataSource,
  JobDigest,
  RealtimeTable,
  SessionInfo,
} from "./types";

/**
 * Supabase hands back the SAME channel object for a repeated name, and a channel
 * cannot take new listeners once subscribed. Removing a channel is asynchronous, so
 * a quick unsubscribe/resubscribe (React strict mode, navigating back to a page)
 * would hit the old one. Every subscription therefore gets its own channel name.
 */
let channelSeq = 0;
function uniqueChannel(base: string): string {
  channelSeq += 1;
  return `${base}:${channelSeq}:${Math.random().toString(36).slice(2, 8)}`;
}

const PAGE = 1000; // PostgREST default max rows per request

function toSession(user: User | null | undefined): SessionInfo | null {
  if (!user) return null;
  return { userId: user.id, anonymous: user.is_anonymous === true, email: user.email ?? null };
}

function fail(context: string, message: string): never {
  throw new Error(`${context}: ${message}`);
}

const ROW_MAPPERS = {
  cases: toCase,
  raw_findings: toFinding,
  correlations: toCorrelation,
  jobs: toJob,
  entities: toEntity,
} as const;

function toChangeEvent(table: RealtimeTable, payload: unknown): ChangeEvent | null {
  if (!isRecord(payload)) return null;
  const type = payload.eventType as ChangeType;
  const source = type === "DELETE" ? payload.old : payload.new;
  if (!isRecord(source) || typeof source.id !== "string") return null;
  const row = type === "DELETE" ? null : ROW_MAPPERS[table](source);
  return { table, type, id: source.id, row } as ChangeEvent;
}

export function createSupabaseDataSource(env: AppEnv): DataSource {
  const client: SupabaseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const gateway: GatewayClient = createGateway({ baseUrl: env.apiUrl });
  let pendingSession: Promise<SessionInfo | null> | null = null;

  async function ensureSession(): Promise<SessionInfo | null> {
    const { data } = await client.auth.getSession();
    if (data.session) return toSession(data.session.user);
    const anon = await client.auth.signInAnonymously();
    if (anon.error) fail("Could not start a session", anon.error.message);
    return toSession(anon.data.user);
  }

  function getSession(): Promise<SessionInfo | null> {
    pendingSession ??= ensureSession().finally(() => {
      pendingSession = null;
    });
    return pendingSession;
  }

  async function command<T>(path: string, options: GatewayRequest = {}): Promise<T> {
    await getSession();
    const { data } = await client.auth.getSession();
    return gateway<T>(path, { ...options, token: data.session?.access_token ?? null });
  }

  async function selectAll(table: string, caseId: string, orderBy: string): Promise<unknown[]> {
    const rows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from(table)
        .select("*")
        .eq("case_id", caseId)
        .order(orderBy, { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) fail(`Could not load ${table}`, error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return rows;
    }
  }

  async function countFound(caseId: string): Promise<number> {
    const { count } = await client
      .from("raw_findings")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId)
      .eq("status", "found");
    return count ?? 0;
  }

  return {
    mode: "supabase",
    admin: createGatewayAdminSource(command),
    getSession,

    onSessionChange(cb) {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        cb(toSession(session?.user));
      });
      return () => data.subscription.unsubscribe();
    },

    async signInWithGitHub(redirectTo) {
      const session = await getSession();
      if (session?.anonymous) {
        // Upgrade the anonymous user in place so its cases stay attached.
        const linked = await client.auth.linkIdentity({
          provider: "github",
          options: { redirectTo },
        });
        if (!linked.error) return "redirect";
      }
      const { error } = await client.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo },
      });
      if (error) fail("GitHub sign-in failed", error.message);
      return "redirect";
    },

    async signInWithEmail(email, redirectTo) {
      const session = await getSession();
      if (session?.anonymous) {
        const upgraded = await client.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
        if (!upgraded.error) return "email_sent";
      }
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) fail("Could not send the sign-in link", error.message);
      return "email_sent";
    },

    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) fail("Sign-out failed", error.message);
    },

    async listCaseSummaries(): Promise<CaseSummary[]> {
      await getSession();
      const { data, error } = await client
        .from("cases")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) fail("Could not load cases", error.message);
      const cases = toList(data, toCase);
      if (cases.length === 0) return [];
      const ids = cases.map((c) => c.id);

      const [jobsRes, corrRes, counts] = await Promise.all([
        client.from("jobs").select("case_id,status,progress,batch_id").in("case_id", ids),
        client
          .from("correlations")
          .select("case_id")
          .in("case_id", ids)
          .eq("status", "pending")
          .neq("type", "same_account"),
        Promise.all(ids.map(countFound)),
      ]);

      const jobsByCase = new Map<string, JobDigest[]>();
      for (const row of jobsRes.data ?? []) {
        const job = toJob(row);
        const list = jobsByCase.get(job.case_id) ?? [];
        list.push({ status: job.status, progress: job.progress, batch_id: job.batch_id });
        jobsByCase.set(job.case_id, list);
      }
      const pendingByCase = new Map<string, number>();
      for (const row of corrRes.data ?? []) {
        const id = isRecord(row) && typeof row.case_id === "string" ? row.case_id : "";
        pendingByCase.set(id, (pendingByCase.get(id) ?? 0) + 1);
      }
      return cases.map((c, i) => ({
        case: c,
        jobs: jobsByCase.get(c.id) ?? [],
        pendingReviews: pendingByCase.get(c.id) ?? 0,
        foundCount: counts[i] ?? 0,
      }));
    },

    async getCase(id) {
      await getSession();
      const { data, error } = await client.from("cases").select("*").eq("id", id).maybeSingle();
      if (error) fail("Could not load the case", error.message);
      return data ? toCase(data) : null;
    },

    async listFindings(caseId) {
      await getSession();
      return toList(await selectAll("raw_findings", caseId, "collected_at"), toFinding);
    },
    async listCorrelations(caseId) {
      await getSession();
      return toList(await selectAll("correlations", caseId, "priority"), toCorrelation);
    },
    async listJobs(caseId) {
      await getSession();
      return toList(await selectAll("jobs", caseId, "created_at"), toJob);
    },
    async listEntities(caseId) {
      await getSession();
      return toList(await selectAll("entities", caseId, "first_seen"), toEntity);
    },

    async listAudit(caseId) {
      await getSession();
      let query = client
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (caseId) query = query.eq("case_id", caseId);
      const { data, error } = await query;
      if (error) fail("Could not load the audit log", error.message);
      return toList(data, toAuditEntry);
    },

    subscribeCase(caseId, onEvent) {
      const channel = client.channel(uniqueChannel(`case:${caseId}`));
      const listen = (table: RealtimeTable, filter: string) => {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table, filter },
          (payload) => {
            const event = toChangeEvent(table, payload);
            if (event) onEvent(event);
          },
        );
      };
      listen("jobs", `case_id=eq.${caseId}`);
      listen("raw_findings", `case_id=eq.${caseId}`);
      listen("correlations", `case_id=eq.${caseId}`);
      listen("entities", `case_id=eq.${caseId}`);
      listen("cases", `id=eq.${caseId}`);
      channel.subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    },

    subscribeCaseList(onChange) {
      const channel = client.channel(uniqueChannel("case-list"));
      for (const table of ["cases", "jobs", "correlations"] as const) {
        channel.on("postgres_changes", { event: "*", schema: "public", table }, () => onChange());
      }
      channel.subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    },

    async listModules() {
      return toList(await gateway<unknown>("/modules"), toModuleInfo);
    },

    async listPlatforms() {
      // public and cacheable: no session, no retries (the bundled snapshot covers a sleeping gateway)
      return toPlatformEntries(await gateway<unknown>("/platforms", { retry: false }));
    },

    async createCase(body): Promise<CreateCaseResult> {
      const res = await command<unknown>("/cases", { method: "POST", body });
      const r = isRecord(res) ? res : {};
      return { case: toCase(r.case), jobs: toList(r.jobs, toJob) };
    },
    async updateCase(id, body): Promise<Case> {
      return toCase(await command<unknown>(`/cases/${id}`, { method: "PATCH", body }));
    },
    async deleteCase(id) {
      await command<void>(`/cases/${id}`, { method: "DELETE", parse: "none" });
    },
    async scan(caseId, body): Promise<ScanResult> {
      const res = await command<unknown>(`/cases/${caseId}/scan`, { method: "POST", body });
      const r = isRecord(res) ? res : {};
      return {
        batch_id: typeof r.batch_id === "string" ? r.batch_id : "",
        jobs: toList(r.jobs, toJob),
      };
    },
    async cancelJob(caseId, jobId): Promise<Job> {
      return toJob(
        await command<unknown>(`/cases/${caseId}/jobs/${jobId}/cancel`, { method: "POST" }),
      );
    },
    async wake(caseId) {
      await command<void>(`/cases/${caseId}/wake`, { method: "POST", parse: "none", retry: false });
    },
    async curateFinding(caseId, findingId, curated): Promise<Finding> {
      return toFinding(
        await command<unknown>(`/cases/${caseId}/findings/${findingId}/curate`, {
          method: "POST",
          body: { curated },
        }),
      );
    },
    async reviewCorrelation(id, decision, note): Promise<Correlation> {
      return toCorrelation(
        await command<unknown>(`/correlations/${id}/review`, {
          method: "POST",
          body: note ? { decision, note } : { decision },
        }),
      );
    },
    async getReport(caseId) {
      return command<string>(`/cases/${caseId}/report`, { parse: "text" });
    },
    async getExposure(caseId) {
      return toExposure(await command<unknown>(`/cases/${caseId}/exposure`));
    },
    async listCandidates(caseId) {
      try {
        const res = await command<unknown>(`/cases/${caseId}/candidates`);
        const rows = Array.isArray(res) ? res : isRecord(res) ? res.candidates : [];
        return toList(rows, toCandidate)
          .filter((c): c is Candidate => c !== null)
          .sort((a, b) => b.score - a.score);
      } catch (err) {
        if (err instanceof GatewayError && (err.status === 404 || err.status === 405)) {
          // 404 for a missing case is handled by the case query itself
          return null;
        }
        throw err;
      }
    },
    async confirmCandidate(caseId, candidateId) {
      const res = await command<unknown>(
        `/cases/${caseId}/candidates/${encodeURIComponent(candidateId)}/confirm`,
        { method: "POST" },
      );
      const rows = Array.isArray(res) ? res : isRecord(res) ? res.entities : [];
      return toList(rows, toEntity);
    },
  };
}
