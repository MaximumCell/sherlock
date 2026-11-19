import type { Correlation, CorrelationStatus, ReviewDecision } from "./types";

export const DECISION_STATUS: Record<ReviewDecision, CorrelationStatus> = {
  approve: "approved",
  reject: "rejected",
  reset: "pending",
};

export interface ReviewAction {
  id: string;
  decision: ReviewDecision;
  note?: string;
  at?: string;
}

/**
 * Pure optimistic-update reducer for the review queue. Returns a new list with
 * the decision applied; the caller keeps the previous list to roll back on error.
 */
export function applyReview(
  correlations: readonly Correlation[],
  action: ReviewAction,
): Correlation[] {
  const status = DECISION_STATUS[action.decision];
  return correlations.map((c) => {
    if (c.id !== action.id) return c;
    const note = action.note?.trim();
    return {
      ...c,
      status,
      reviewed: status === "approved",
      review_note: action.decision === "reset" ? null : note || c.review_note,
      reviewed_at: action.decision === "reset" ? null : (action.at ?? new Date().toISOString()),
    };
  });
}

export type ReviewFilter = CorrelationStatus | "all";

/** Queue order: highest priority first, then confidence, then oldest. */
export function sortQueue(correlations: readonly Correlation[]): Correlation[] {
  return [...correlations].sort(
    (a, b) =>
      b.priority - a.priority ||
      b.confidence - a.confidence ||
      a.created_at.localeCompare(b.created_at),
  );
}

export function filterQueue(correlations: readonly Correlation[], filter: ReviewFilter) {
  return sortQueue(filter === "all" ? correlations : correlations.filter((c) => c.status === filter));
}

export function countByStatus(correlations: readonly Correlation[]): Record<ReviewFilter, number> {
  const counts: Record<ReviewFilter, number> = {
    all: correlations.length,
    pending: 0,
    approved: 0,
    rejected: 0,
  };
  for (const c of correlations) counts[c.status] += 1;
  return counts;
}

/** Index to select after the item at `index` leaves the visible list. */
export function nextIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, index + delta));
}
