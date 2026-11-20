import type { ExposureBand, ExposureFactor } from "./types";

export interface RemediationStep {
  text: string;
  /** The factor this step reduces. */
  factor: string;
  factorKey: string;
  points: number;
}

/**
 * Every "what to do" step from the scoring factors, most valuable first: steps of
 * high-scoring factors come first, each factor's own order is kept, duplicates dropped.
 */
export function prioritisedSteps(factors: readonly ExposureFactor[]): RemediationStep[] {
  const seen = new Set<string>();
  const out: RemediationStep[] = [];
  const ordered = [...factors].filter((f) => f.points > 0).sort((a, b) => b.points - a.points);
  for (const f of ordered) {
    for (const text of f.remediation) {
      const key = text.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ text, factor: f.label, factorKey: f.key, points: f.points });
    }
  }
  return out;
}

/** One line saying what an exposure band means for a person. */
export const BAND_MEANING: Record<ExposureBand, string> = {
  low: "Little about this target is public. Keep an eye on it.",
  moderate: "A stranger could piece together a partial picture from public data.",
  high: "A stranger could build a detailed picture from public data alone.",
  severe: "Enough is public to impersonate or target this person. Act on the steps below.",
};
