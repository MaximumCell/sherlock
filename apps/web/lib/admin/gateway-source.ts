/**
 * `AdminSource` over the gateway's `/admin/*` routes. The tables behind them are readable
 * by the service key only; the browser never queries them through Supabase.
 */
import { GatewayError, type GatewayRequest } from "../data/gateway";
import type {
  AdminMe,
  AdminSource,
  Overview,
  Page,
  SearchFilters,
  SearchLogRow,
  SessionDetail,
  SessionFilters,
  VisitorSession,
} from "./types";

export type Command = <T>(path: string, options?: GatewayRequest) => Promise<T>;

/** `?a=1&b=x` from the defined, non-empty values. */
export function queryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    q.set(key, String(value));
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}

export function createGatewayAdminSource(command: Command): AdminSource {
  return {
    demo: false,

    async me(options) {
      try {
        return await command<AdminMe>("/admin/me", { retry: !options?.quiet });
      } catch (err) {
        if (err instanceof GatewayError && (err.status === 404 || err.status === 401)) return null;
        throw err;
      }
    },

    overview(days) {
      return command<Overview>(`/admin/overview${queryString({ days })}`);
    },

    searches(f: SearchFilters) {
      return command<Page<SearchLogRow>>(
        `/admin/searches${queryString({
          outcome: f.outcome,
          type: f.type,
          q: f.q?.trim(),
          session: f.session,
          since: f.since,
          limit: f.limit,
          cursor: f.cursor,
        })}`,
        { retry: false },
      );
    },

    sessions(f: SessionFilters) {
      return command<Page<VisitorSession>>(
        `/admin/sessions${queryString({
          flagged: f.flagged,
          blocked: f.blocked,
          q: f.q?.trim(),
          limit: f.limit,
          cursor: f.cursor,
        })}`,
      );
    },

    session(userId) {
      return command<SessionDetail>(`/admin/sessions/${encodeURIComponent(userId)}`);
    },

    block(userId, reason) {
      return command<VisitorSession>(`/admin/sessions/${encodeURIComponent(userId)}/block`, {
        method: "POST",
        body: { reason },
      });
    },

    unblock(userId) {
      return command<VisitorSession>(`/admin/sessions/${encodeURIComponent(userId)}/unblock`, {
        method: "POST",
      });
    },

    async setPaused(paused) {
      const res = await command<{ scans_paused: boolean }>("/admin/pause", {
        method: "POST",
        body: { paused },
      });
      return res.scans_paused;
    },

    deleteCase(caseId) {
      return command<void>(`/admin/cases/${encodeURIComponent(caseId)}`, {
        method: "DELETE",
        parse: "none",
      });
    },
  };
}
