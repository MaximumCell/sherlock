/**
 * In-memory `AdminSource` over the bundled fictional data (`demo-data.ts`). Block, unblock,
 * pause and delete work locally in this tab; the feed gains a new invented search every few
 * seconds so the live refresh has something to show.
 */
import { GatewayError } from "../data/gateway";
import type { TargetType } from "../types";
import { DEMO_SESSIONS, LIVE_POOL, demoCases, demoSearchSeeds } from "./demo-data";
import type {
  AdminSource,
  CaseMeta,
  DayPoint,
  Overview,
  SearchLogRow,
  SessionBrief,
  VisitorSession,
} from "./types";

export interface DemoAdminOptions {
  now?: () => number;
  latencyMs?: number;
  /** Minimum gap between invented live searches (0 disables them). */
  liveEveryMs?: number;
}

const DAY_MS = 86_400_000;
const clone = <T>(value: T): T => structuredClone(value);

export function createDemoAdminSource(options: DemoAdminOptions = {}): AdminSource {
  const now = options.now ?? Date.now;
  const latency = options.latencyMs ?? 150;
  const liveEvery = options.liveEveryMs ?? 7000;
  const start = now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const sessions = new Map<string, VisitorSession>(
    DEMO_SESSIONS.map(({ firstSeenDaysAgo, ...s }) => [
      s.user_id,
      {
        ...s,
        first_seen: iso(start - firstSeenDaysAgo * DAY_MS - 3_600_000),
        last_seen: iso(start - firstSeenDaysAgo * DAY_MS),
        blocked_at: s.blocked ? iso(start - 2 * 3_600_000) : null,
        search_count: 0,
        refused_count: 0,
      },
    ]),
  );
  const cases = demoCases(start);
  let paused = false;
  let nextId = 1;
  let lastLive = start;
  let liveIndex = 0;
  const log: SearchLogRow[] = [];

  function brief(userId: string): SessionBrief | null {
    const s = sessions.get(userId);
    if (!s) return null;
    const { user_id, is_anonymous, email, user_agent, country, origin, origin_sessions, blocked } =
      s;
    return { user_id, is_anonymous, email, user_agent, country, origin, origin_sessions, blocked };
  }

  function append(
    user: string,
    at: number,
    type: TargetType,
    value: string,
    outcome: SearchLogRow["outcome"],
    detail?: string,
  ) {
    const s = sessions.get(user);
    log.push({
      id: nextId++,
      created_at: iso(at),
      user_id: user,
      case_id: null,
      target_type: type,
      target_value: value,
      modules: outcome === "accepted" ? ["demo"] : null,
      outcome,
      detail: detail ?? null,
      country: s?.country ?? null,
      is_anonymous: s?.is_anonymous ?? true,
      session: null,
    });
    if (s) {
      if (outcome === "accepted") s.search_count += 1;
      else s.refused_count += 1;
      if (!s.last_seen || s.last_seen < iso(at)) s.last_seen = iso(at);
    }
  }

  demoSearchSeeds()
    .sort((a, b) => b.minutesAgo - a.minutesAgo)
    .forEach((seed) =>
      append(
        seed.user,
        start - seed.minutesAgo * 60_000,
        seed.type,
        seed.value,
        seed.outcome,
        seed.detail,
      ),
    );

  /** Invent the next "live" search when enough time has passed. */
  function live() {
    if (liveEvery <= 0 || now() - lastLive < liveEvery) return;
    lastLive = now();
    const pick = LIVE_POOL[liveIndex++ % LIVE_POOL.length];
    if (!pick) return;
    const s = sessions.get(pick.user);
    const outcome = s?.blocked ? "blocked" : paused ? "paused" : "accepted";
    const detail =
      outcome === "blocked"
        ? "This session has been blocked from running searches."
        : outcome === "paused"
          ? "Searches are paused by the operator. Try again later."
          : undefined;
    append(pick.user, now(), pick.type, pick.value, outcome, detail);
  }

  const wait = <T>(value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(clone(value)), latency));
  const withSession = (r: SearchLogRow): SearchLogRow => ({ ...r, session: brief(r.user_id) });
  const visitor = (id: string): VisitorSession => {
    const s = sessions.get(id);
    if (!s) throw new GatewayError(404, "visitor not found");
    return s;
  };

  return {
    demo: true,

    me: () => wait({ is_admin: true as const, email: "operator@example.com" }),

    overview(days) {
      live();
      const end = new Date(now());
      const first =
        Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - (days - 1) * DAY_MS;
      const rows = log.filter((r) => Date.parse(r.created_at) >= first);
      const series: DayPoint[] = Array.from({ length: days }, (_, i) => {
        const day = iso(first + i * DAY_MS).slice(0, 10);
        const point: DayPoint = {
          day,
          accepted: 0,
          rate_limited: 0,
          blocked: 0,
          paused: 0,
          forbidden: 0,
          invalid: 0,
        };
        for (const r of rows) if (r.created_at.startsWith(day)) point[r.outcome] += 1;
        return point;
      });
      const byType = new Map<string, number>();
      const targets = new Map<
        string,
        { target_type: string; target_value: string; count: number; users: Set<string> }
      >();
      for (const r of rows) {
        byType.set(r.target_type, (byType.get(r.target_type) ?? 0) + 1);
        const key = `${r.target_type}|${r.target_value}`;
        const t = targets.get(key) ?? {
          target_type: r.target_type,
          target_value: r.target_value,
          count: 0,
          users: new Set(),
        };
        t.count += 1;
        t.users.add(r.user_id);
        targets.set(key, t);
      }
      const accepted = rows.filter((r) => r.outcome === "accepted").length;
      const today = iso(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
      const overview: Overview = {
        days,
        since: iso(first),
        totals: {
          searches: rows.length,
          accepted,
          refused: rows.length - accepted,
          sessions: new Set(rows.map((r) => r.user_id)).size,
          flagged_sessions: [...sessions.values()].filter((s) => s.flags.length > 0).length,
          cases: Object.values(cases).flat().length,
          active_jobs: paused ? 0 : 3,
        },
        series,
        by_type: [...byType]
          .map(([target_type, count]) => ({ target_type, count }))
          .sort((a, b) => b.count - a.count),
        top_targets: [...targets.values()]
          .filter((t) => t.count >= 2)
          .sort((a, b) => b.count - a.count)
          .slice(0, 10)
          .map(({ users, ...t }) => ({ ...t, sessions: users.size })),
        quota: {
          global_used_today: log.filter((r) => r.outcome === "accepted" && r.created_at >= today)
            .length,
          global_limit: 300,
          per_session_limit: 20,
          name_per_user_limit: 5,
        },
        scans_paused: paused,
        retention_days: 90,
        truncated: false,
      };
      return wait(overview);
    },

    searches(f) {
      live();
      const q = f.q?.trim().toLowerCase();
      const before = f.cursor ? Number(f.cursor) : Infinity;
      const rows = log
        .filter(
          (r) =>
            r.id < before &&
            (!f.outcome || r.outcome === f.outcome) &&
            (!f.type || r.target_type === f.type) &&
            (!q || r.target_value.toLowerCase().includes(q)) &&
            (!f.session || r.user_id === f.session) &&
            (!f.since || r.created_at >= f.since),
        )
        .reverse();
      const limit = f.limit ?? 50;
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return wait({
        items: page.map(withSession),
        next_cursor: rows.length > limit && last ? String(last.id) : null,
      });
    },

    sessions(f) {
      const q = f.q?.trim().toLowerCase();
      let rows = [...sessions.values()]
        .filter(
          (s) =>
            (f.blocked === undefined || s.blocked === f.blocked) &&
            (f.flagged === undefined || s.flags.length > 0 === f.flagged) &&
            (!q ||
              (s.email ?? "").toLowerCase().includes(q) ||
              s.origin === q ||
              s.user_id.startsWith(q)),
        )
        .sort((a, b) => (b.last_seen ?? "").localeCompare(a.last_seen ?? ""));
      if (f.flagged) {
        const rank = { high: 0, medium: 1, low: 2 } as const;
        const worst = (s: VisitorSession) => Math.min(...s.flags.map((x) => rank[x.severity]));
        rows = rows.sort((a, b) => worst(a) - worst(b) || b.flags.length - a.flags.length);
      }
      const offset = Number(f.cursor ?? 0) || 0;
      const limit = f.limit ?? 50;
      return wait({
        items: rows.slice(offset, offset + limit),
        next_cursor: rows.length > offset + limit ? String(offset + limit) : null,
      });
    },

    session(userId) {
      try {
        const s = visitor(userId);
        const searches = log
          .filter((r) => r.user_id === userId)
          .reverse()
          .slice(0, 200)
          .map(withSession);
        return wait({ session: s, searches, cases: cases[userId] ?? [] });
      } catch (err) {
        return Promise.reject(err);
      }
    },

    block(userId, reason) {
      const s = sessions.get(userId);
      if (!s) return Promise.reject(new GatewayError(404, "visitor not found"));
      Object.assign(s, { blocked: true, blocked_at: iso(now()), blocked_reason: reason.trim() });
      return wait(s);
    },

    unblock(userId) {
      const s = sessions.get(userId);
      if (!s) return Promise.reject(new GatewayError(404, "visitor not found"));
      Object.assign(s, { blocked: false, blocked_at: null, blocked_reason: null });
      return wait(s);
    },

    setPaused(next) {
      paused = next;
      return wait(paused);
    },

    deleteCase(caseId) {
      for (const [user, list] of Object.entries(cases)) {
        const kept: CaseMeta[] = list.filter((c) => c.id !== caseId);
        if (kept.length !== list.length) {
          cases[user] = kept;
          for (const r of log) if (r.case_id === caseId) r.case_id = null;
          return wait(undefined);
        }
      }
      return Promise.reject(new GatewayError(404, "case not found"));
    },
  };
}
