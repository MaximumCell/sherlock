/**
 * Fixture versions of the gateway's search refusals and queue position, so the demo can show
 * them (see `lib/fixture-switches.ts` for the trigger values). Pure helpers over fixture state.
 */
import { FIXTURE_TRIGGERS } from "../../fixture-switches";
import type { Job, QueueStatus } from "../../types";
import { GatewayError } from "../gateway";

export const SIGN_IN_DETAIL = "Sign in to run a search. It's free and takes a few seconds.";
export const BUSY_DETAIL = "Sherlock is busy right now. Try again in a few minutes.";
export const ACTIVE_DETAIL =
  "Your previous search is still running. You can start another when it finishes, or stop it.";
export const LIMIT_DETAIL =
  "Too many searches in a short time: up to 3 every 10 minutes. You can search again in about 4 minutes.";
/** Ticks a `demo-queued` search waits before its jobs start. */
export const HELD_TICKS = 8;
const HELD_AHEAD = 2;

/** The refusal a fixture search should get for this target value, if any. */
export function fixtureRefusal(value: string, jobs: readonly Job[]): GatewayError | null {
  const v = value.trim().toLowerCase();
  if (v === FIXTURE_TRIGGERS.busy) return new GatewayError(503, BUSY_DETAIL, { retryAfterS: 180 });
  if (v === FIXTURE_TRIGGERS.limit)
    return new GatewayError(429, LIMIT_DETAIL, { retryAfterS: 240 });
  if (v === FIXTURE_TRIGGERS.running) {
    const newestFirst = [...jobs].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const isActive = (j: Job) => j.status === "queued" || j.status === "running";
    const latest = newestFirst.find(isActive) ?? newestFirst[0];
    if (!latest) return null;
    const batchIds = [
      ...new Set(
        jobs
          .filter((j) => j.case_id === latest.case_id && isActive(j))
          .map((j) => j.batch_id)
          .filter((b): b is string => Boolean(b)),
      ),
    ];
    return new GatewayError(429, ACTIVE_DETAIL, {
      activeSearch: { caseId: latest.case_id, batchIds },
    });
  }
  return null;
}

export const isHeldTrigger = (value: string) =>
  value.trim().toLowerCase() === FIXTURE_TRIGGERS.queued;

/** Queue status of a fixture case: a held case waits behind invented searches, others never wait. */
export function fixtureQueueStatus(
  caseId: string,
  jobs: readonly Job[],
  heldTicksLeft: number | undefined,
): QueueStatus {
  const mine = jobs.filter((j) => j.case_id === caseId);
  const queued = mine.filter((j) => j.status === "queued").length;
  const running = mine.filter((j) => j.status === "running").length;
  const waiting = heldTicksLeft !== undefined && heldTicksLeft > 0 && queued > 0 && running === 0;
  return {
    case_id: caseId,
    queued,
    running,
    waiting,
    ahead: waiting ? HELD_AHEAD : 0,
    jobs_ahead: waiting ? 19 * HELD_AHEAD : 0,
    estimated_wait_s: waiting ? Math.max(30, heldTicksLeft * 15) : null,
  };
}
