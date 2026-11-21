/**
 * In-memory implementation of `DataSource`. It serves the bundled fictional
 * demo data, accepts every command, and simulates job progress with timers,
 * emitting the same change events Supabase Realtime would.
 */
import { createDemoAdminSource } from "../../admin/demo-source";
import type { AdminCaseView, CaseMeta } from "../../admin/types";
import { DEMO_CASE_ID } from "./demo-case";
import type { Case, Correlation, Finding, Job, JsonObject, NameHints } from "../../types";
import { GatewayError } from "../gateway";
import { decisionStatus } from "../../review";
import type {
  CaseSummary,
  ChangeEvent,
  ChangeType,
  DataSource,
  RealtimeTable,
  SessionInfo,
  TableRows,
} from "../types";
import { PLATFORM_SNAPSHOT } from "../../platforms";
import { env } from "../../env";
import { fixtureSignInRequired } from "../../fixture-switches";
import { FIXTURE_MODULES, modulesFor } from "./catalogue";
import { HELD_TICKS, SIGN_IN_DETAIL, fixtureQueueStatus, fixtureRefusal, isHeldTrigger } from "./limits";
import { scoreFixtureCase } from "./exposure";
import { entitiesForCandidate, syntheticCandidates } from "./people";
import { renderFixtureReport } from "./report";
import { FIXTURE_USER_ID, createFixtureState, type FixtureState } from "./state";
import { progressNote, syntheticFindings } from "./synthetic";

export interface FixtureOptions {
  /** Artificial latency per call, to exercise loading states. */
  latencyMs?: number;
  /** Job simulation tick; 0 disables the timer (tests call `tick()` directly). */
  tickMs?: number;
  now?: () => number;
  /** Searches need a signed-in session (default: the fixture switch, off unless asked for). */
  requireSignIn?: boolean;
}

export interface FixtureDataSource extends DataSource {
  /** Advance the job simulation by one step. */
  tick(): void;
  readonly state: FixtureState;
}

const clone = <T>(value: T): T => structuredClone(value);

function toHints(hints: NameHints | undefined): JsonObject | undefined {
  if (!hints) return undefined;
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(hints)) if (typeof v === "string" && v) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

export function createFixtureDataSource(options: FixtureOptions = {}): FixtureDataSource {
  const now = options.now ?? Date.now;
  const latency = options.latencyMs ?? 120;
  const tickMs = options.tickMs ?? 1400;
  const state = createFixtureState(now());
  const needsAccount = options.requireSignIn ?? fixtureSignInRequired(env.fixtureRequireSignIn);
  /** Cases whose search waits behind invented searches (`demo-queued`): ticks left. */
  const held = new Map<string, number>();

  /**
   * The operator's read-only view: a sandbox case as it is, or for an invented visitor case of
   * the demo panel, the bundled demo case under that visitor's title and targets.
   */
  function adminCaseContent(caseId: string, meta: CaseMeta | null): AdminCaseView | null {
    const own = state.cases.find((c) => c.id === caseId);
    const sourceId = own ? caseId : meta ? DEMO_CASE_ID : null;
    const source = sourceId ? state.cases.find((c) => c.id === sourceId) : undefined;
    if (!sourceId || !source) return null;
    audit(caseId, "admin_case_viewed", "operator", {});
    const c: Case = own
      ? own
      : { ...source, id: caseId, title: meta?.title ?? source.title, identifiers: meta?.identifiers ?? source.identifiers, is_demo: false };
    return clone({
      case: c,
      findings: byCase(state.findings, sourceId),
      correlations: byCase(state.correlations, sourceId),
      entities: byCase(state.entities, sourceId),
      jobs: byCase(state.jobs, sourceId),
      audit: state.audit
        .filter((a) => a.case_id === caseId || a.case_id === sourceId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    });
  }

  /** The gateway's checks that the demo can show: sign-in, then the refusal triggers. */
  function checkSearch(values: string[]) {
    if (needsAccount && session.anonymous) throw new GatewayError(401, SIGN_IN_DETAIL);
    for (const v of values) {
      const refusal = fixtureRefusal(v, state.jobs);
      if (refusal) throw refusal;
    }
  }

  let session: SessionInfo = { userId: FIXTURE_USER_ID, anonymous: true, email: null };
  const sessionListeners = new Set<(s: SessionInfo | null) => void>();
  const caseListeners = new Map<string, Set<(e: ChangeEvent) => void>>();
  const listListeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let counter = 1;

  const nowIso = () => new Date(now()).toISOString();
  const newId = (prefix: string) =>
    `${prefix}${(counter++).toString(16).padStart(6, "0")}-0000-4000-8000-${now().toString(16).padStart(12, "0").slice(-12)}`;
  const respond = <T>(value: T): Promise<T> =>
    new Promise((resolve) => {
      if (latency <= 0) resolve(clone(value));
      else setTimeout(() => resolve(clone(value)), latency);
    });

  function emit<T extends RealtimeTable>(
    table: T,
    type: ChangeType,
    caseId: string,
    id: string,
    row: TableRows[T] | null,
  ) {
    const event = { table, type, id, row: row ? clone(row) : null } as ChangeEvent;
    caseListeners.get(caseId)?.forEach((l) => l(event));
    if (table !== "raw_findings" && table !== "entities") listListeners.forEach((l) => l());
  }

  function audit(caseId: string, action: string, actor: string, detail: JsonObject) {
    state.audit.push({
      id: state.audit.length + 1000,
      case_id: caseId,
      action,
      actor,
      detail,
      created_at: nowIso(),
    });
  }

  function requireCase(id: string): Case {
    const c = state.cases.find((x) => x.id === id);
    if (!c) throw new GatewayError(404, "Case not found");
    return c;
  }

  function touch(c: Case) {
    c.updated_at = nowIso();
    emit("cases", "UPDATE", c.id, c.id, c);
  }

  function enqueue(
    caseId: string,
    type: string,
    value: string,
    only?: string[],
    hints?: JsonObject,
  ): Job[] {
    const batch = newId("ba");
    const baseParams: JsonObject = { synthetic: true };
    if (hints) baseParams.hints = hints;
    const modules = modulesFor(type).filter((m) => !only || only.includes(m.name));
    const jobs = modules.map<Job>((m) => ({
      id: newId("b2"),
      case_id: caseId,
      batch_id: batch,
      queue: m.queue,
      module: m.name,
      target_type: type,
      target_value: value,
      params: { ...baseParams },
      status: "queued",
      progress: 0,
      progress_note: null,
      attempts: 0,
      max_attempts: 3,
      result: null,
      error: null,
      created_at: nowIso(),
      started_at: null,
      finished_at: null,
    }));
    state.jobs.push(...jobs);
    jobs.forEach((j) => emit("jobs", "INSERT", caseId, j.id, j));
    startTimer();
    return jobs;
  }

  function finish(job: Job) {
    job.status = "succeeded";
    job.progress = 100;
    job.finished_at = nowIso();
    const produced = job.params.synthetic === true ? syntheticFindings(job, now()) : [];
    const fresh = produced.filter((f) => !state.findings.some((x) => x.id === f.id));
    state.findings.push(...fresh);
    fresh.forEach((f) => emit("raw_findings", "INSERT", job.case_id, f.id, f));
    job.result =
      job.params.synthetic === true
        ? { findings: produced.length, found: produced.filter((f) => f.status === "found").length }
        : { findings: 1, found: 1 };
    job.progress_note = null;
    if (job.module === "name_search" && !state.candidates[job.case_id]?.length) {
      const hints =
        typeof job.params.hints === "object" && job.params.hints && !Array.isArray(job.params.hints)
          ? job.params.hints
          : {};
      state.candidates[job.case_id] = syntheticCandidates(
        job.target_value,
        fresh.map((f) => f.id),
        hints,
      );
    }
    for (const entity of state.entities) {
      if (entity.case_id === job.case_id && entity.value === job.target_value && !entity.scanned) {
        entity.scanned = true;
        emit("entities", "UPDATE", job.case_id, entity.id, entity);
      }
    }
    audit(job.case_id, "collector_run", job.module, {
      target: job.target_value,
      findings: job.result.findings ?? 0,
    });
  }

  function tick() {
    const byCase = new Map<string, Job[]>();
    for (const job of state.jobs) {
      if (job.status !== "queued" && job.status !== "running") continue;
      const list = byCase.get(job.case_id) ?? [];
      list.push(job);
      byCase.set(job.case_id, list);
    }
    if (byCase.size === 0) {
      stopTimer();
      return;
    }
    for (const [caseId, jobs] of byCase) {
      const left = held.get(caseId);
      if (left !== undefined) {
        if (left > 1) {
          held.set(caseId, left - 1);
          continue;
        }
        held.delete(caseId);
      }
      const running = jobs.filter((j) => j.status === "running");
      for (const job of running) {
        const step = 9 + ((job.id.charCodeAt(7) + job.progress) % 9);
        job.progress = Math.min(100, job.progress + step);
        if (job.progress >= 100) finish(job);
        else job.progress_note = progressNote(job.module, job.progress);
        emit("jobs", "UPDATE", caseId, job.id, job);
      }
      const stillRunning = running.filter((j) => j.status === "running").length;
      const queued = jobs
        .filter((j) => j.status === "queued")
        .slice(0, Math.max(0, 2 - stillRunning));
      for (const job of queued) {
        job.status = "running";
        job.attempts += 1;
        job.started_at = nowIso();
        job.progress_note = progressNote(job.module, 0);
        emit("jobs", "UPDATE", caseId, job.id, job);
      }
    }
  }

  function startTimer() {
    if (timer || tickMs <= 0 || typeof window === "undefined") return;
    timer = setInterval(tick, tickMs);
  }
  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function summaries(): CaseSummary[] {
    return state.cases.map((c) => ({
      case: c,
      jobs: state.jobs
        .filter((j) => j.case_id === c.id)
        .map((j) => ({ status: j.status, progress: j.progress, batch_id: j.batch_id })),
      pendingReviews: state.correlations.filter(
        (x) => x.case_id === c.id && x.status === "pending" && x.type !== "same_account",
      ).length,
      foundCount: state.findings.filter((f) => f.case_id === c.id && f.status === "found").length,
    }));
  }

  const byCase = <T extends { case_id: string }>(rows: T[], caseId: string) =>
    rows.filter((r) => r.case_id === caseId);

  return {
    mode: "fixtures",
    searchNeedsAccount: needsAccount,
    admin: createDemoAdminSource({ caseContent: adminCaseContent }),
    state,
    tick,

    getSession: () => Promise.resolve(session),
    onSessionChange(cb) {
      sessionListeners.add(cb);
      return () => sessionListeners.delete(cb);
    },
    async signInWithGitHub() {
      session = { ...session, anonymous: false, email: "investigator@example.com" };
      sessionListeners.forEach((l) => l(session));
      return "signed_in";
    },
    async signInWithGoogle() {
      session = { ...session, anonymous: false, email: "investigator@example.com" };
      sessionListeners.forEach((l) => l(session));
      return "signed_in";
    },
    async signInWithEmail(email) {
      session = { ...session, anonymous: false, email };
      sessionListeners.forEach((l) => l(session));
      return "signed_in";
    },
    async signOut() {
      session = { userId: FIXTURE_USER_ID, anonymous: true, email: null };
      sessionListeners.forEach((l) => l(session));
    },

    listCaseSummaries: () =>
      respond(summaries().sort((a, b) => b.case.created_at.localeCompare(a.case.created_at))),
    getCase: (id) => respond(state.cases.find((c) => c.id === id) ?? null),
    listFindings: (caseId) => respond(byCase(state.findings, caseId)),
    listCorrelations: (caseId) =>
      respond(byCase(state.correlations, caseId).sort((a, b) => b.priority - a.priority)),
    listJobs: (caseId) =>
      respond(byCase(state.jobs, caseId).sort((a, b) => b.created_at.localeCompare(a.created_at))),
    listEntities: (caseId) => respond(byCase(state.entities, caseId)),
    listAudit: (caseId) =>
      respond(
        state.audit
          .filter((a) => !caseId || a.case_id === caseId)
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      ),

    subscribeCase(caseId, onEvent) {
      const set = caseListeners.get(caseId) ?? new Set();
      set.add(onEvent);
      caseListeners.set(caseId, set);
      startTimer();
      return () => {
        set.delete(onEvent);
      };
    },
    subscribeCaseList(onChange) {
      listListeners.add(onChange);
      startTimer();
      return () => listListeners.delete(onChange);
    },

    listModules: () => respond(FIXTURE_MODULES),
    listPlatforms: () => respond([...PLATFORM_SNAPSHOT]),

    async createCase(body) {
      if (body.scan !== false) checkSearch(body.identifiers.map((i) => i.value));
      if (body.identifiers.some((i) => i.type === "name") && session.anonymous) {
        throw new GatewayError(403, "Name search requires a signed-in account.");
      }
      const c: Case = {
        id: newId("ca"),
        title: body.title?.trim() || null,
        notes: "",
        tags: body.tags ?? [],
        identifiers: body.identifiers,
        status: "open",
        owner_id: session.userId,
        is_demo: false,
        created_at: nowIso(),
        updated_at: nowIso(),
        archived_at: null,
      };
      state.cases.unshift(c);
      body.identifiers.forEach((idf, i) =>
        state.entities.push({
          id: newId("e2"),
          case_id: c.id,
          kind: idf.type,
          value: idf.value,
          platform: null,
          source_finding_id: null,
          is_seed: true,
          scanned: false,
          first_seen: new Date(now() + i).toISOString(),
        }),
      );
      audit(c.id, "case_created", "investigator", { identifiers: body.identifiers.length });
      if (body.identifiers.some((i) => isHeldTrigger(i.value))) held.set(c.id, HELD_TICKS);
      const jobs =
        body.scan === false
          ? []
          : body.identifiers.flatMap((i) =>
              enqueue(
                c.id,
                i.type,
                i.value,
                undefined,
                i.type === "name" ? toHints(body.hints) : undefined,
              ),
            );
      listListeners.forEach((l) => l());
      return respond({ case: c, jobs });
    },

    async updateCase(id, body) {
      const c = requireCase(id);
      if (body.title !== undefined) c.title = body.title.trim() || null;
      if (body.notes !== undefined) c.notes = body.notes;
      if (body.tags !== undefined) c.tags = body.tags;
      if (body.archived !== undefined) c.archived_at = body.archived ? nowIso() : null;
      touch(c);
      return respond(c);
    },

    async deleteCase(id) {
      requireCase(id);
      state.cases = state.cases.filter((c) => c.id !== id);
      state.findings = state.findings.filter((f) => f.case_id !== id);
      state.correlations = state.correlations.filter((x) => x.case_id !== id);
      state.jobs = state.jobs.filter((j) => j.case_id !== id);
      state.entities = state.entities.filter((e) => e.case_id !== id);
      emit("cases", "DELETE", id, id, null);
      await respond(null);
    },

    async scan(caseId, body) {
      const c = requireCase(caseId);
      checkSearch([body.value]);
      if (isHeldTrigger(body.value)) held.set(caseId, HELD_TICKS);
      if (body.type === "name" && session.anonymous) {
        throw new GatewayError(403, "Name search requires a signed-in account.");
      }
      const jobs = enqueue(caseId, body.type, body.value, body.modules, toHints(body.hints));
      if (jobs.length === 0) {
        throw new GatewayError(422, `No available module accepts a ${body.type} target.`);
      }
      audit(caseId, "scan_requested", "investigator", { target: body.value, jobs: jobs.length });
      touch(c);
      return respond({ batch_id: jobs[0]?.batch_id ?? "", jobs });
    },

    async cancelJob(caseId, jobId) {
      const job = state.jobs.find((j) => j.id === jobId && j.case_id === caseId);
      if (!job) throw new GatewayError(404, "Job not found");
      if (job.status === "queued" || job.status === "running") {
        job.status = "cancelled";
        job.finished_at = nowIso();
        job.progress_note = "Cancelled by the investigator";
        emit("jobs", "UPDATE", caseId, job.id, job);
      }
      return respond(job);
    },

    async cancelBatch(caseId, batchId) {
      requireCase(caseId);
      const jobs = state.jobs.filter((j) => j.case_id === caseId && j.batch_id === batchId);
      if (jobs.length === 0) throw new GatewayError(404, "search not found");
      let cancelled = 0;
      for (const job of jobs) {
        if (job.status !== "queued" && job.status !== "running") continue;
        job.status = "cancelled";
        job.finished_at = nowIso();
        job.progress_note = "Cancelled by the investigator";
        cancelled += 1;
        emit("jobs", "UPDATE", caseId, job.id, job);
      }
      held.delete(caseId);
      return respond({ batch_id: batchId, cancelled, jobs });
    },

    queueStatus: (caseId) => respond(fixtureQueueStatus(caseId, state.jobs, held.get(caseId))),

    wake: () => Promise.resolve(),

    async curateFinding(caseId, findingId, curated) {
      const finding = state.findings.find((f) => f.id === findingId && f.case_id === caseId);
      if (!finding) throw new GatewayError(404, "Finding not found");
      finding.curated = curated;
      emit("raw_findings", "UPDATE", caseId, finding.id, finding as Finding);
      return respond(finding);
    },

    async reviewCorrelation(id, decision, note) {
      const corr: Correlation | undefined = state.correlations.find((x) => x.id === id);
      if (!corr) throw new GatewayError(404, "Correlation not found");
      corr.status = decisionStatus(corr, decision);
      corr.reviewed = corr.status === "approved";
      corr.review_note = decision === "reset" ? null : note?.trim() || corr.review_note;
      corr.reviewed_at = corr.status === "pending" ? null : nowIso();
      audit(corr.case_id, "review", "investigator", { rule: corr.type, decision });
      emit("correlations", "UPDATE", corr.case_id, corr.id, corr);
      return respond(corr);
    },

    async getReport(caseId) {
      const c = requireCase(caseId);
      return respond(
        renderFixtureReport(
          c,
          byCase(state.findings, caseId),
          byCase(state.correlations, caseId),
          now(),
        ),
      );
    },

    async getExposure(caseId) {
      requireCase(caseId);
      return respond(
        scoreFixtureCase(byCase(state.findings, caseId), byCase(state.correlations, caseId)),
      );
    },

    async listCandidates(caseId) {
      const c = requireCase(caseId);
      const named =
        c.identifiers.some((i) => i.type === "name") ||
        state.jobs.some((j) => j.case_id === caseId && j.target_type === "name");
      if (!named) return respond([]);
      return respond([...(state.candidates[caseId] ?? [])].sort((a, b) => b.score - a.score));
    },

    async confirmCandidate(caseId, candidateId) {
      const c = requireCase(caseId);
      const list = state.candidates[caseId] ?? [];
      const chosen = list.find((x) => x.candidate_id === candidateId);
      if (!chosen) throw new GatewayError(404, "Candidate not found");
      list.forEach((x) => (x.confirmed = x.candidate_id === candidateId));
      const known = new Set(byCase(state.entities, caseId).map((e) => `${e.kind}|${e.value}`));
      const added = entitiesForCandidate(chosen, now(), newId).filter(
        (e) => !known.has(`${e.kind}|${e.value}`),
      );
      state.entities.push(...added);
      added.forEach((e) => emit("entities", "INSERT", caseId, e.id, e));
      audit(caseId, "candidate_confirmed", "investigator", { candidate: chosen.label });
      touch(c);
      return respond(added);
    },
  };
}
