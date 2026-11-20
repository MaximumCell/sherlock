/**
 * Pure helpers for numbers that count up and for the house easing curve. Framework-free so
 * they can be tested and shared by CSS-free canvas code and React components alike.
 */

/** The house "out" curve, cubic-bezier(0.22, 1, 0.36, 1), as motion's tuple. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Ease-out cubic on 0..1 (clamped). */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

/**
 * The value shown at progress `t` (0..1) of a count from `from` to `to`, rounded to
 * `decimals`. Ends exactly on `to`.
 */
export function countUpValue(from: number, to: number, t: number, decimals = 0): number {
  if (t >= 1) return to;
  const raw = from + (to - from) * easeOutCubic(t);
  const f = Math.pow(10, decimals);
  return Math.round(raw * f) / f;
}

/** How long a count should run: longer for bigger jumps, within 150-900 ms. Zero for no change. */
export function countUpDuration(from: number, to: number): number {
  const delta = Math.abs(to - from);
  if (delta === 0) return 0;
  return Math.round(Math.min(900, Math.max(150, 250 + Math.log10(delta + 1) * 260)));
}

/** "1,234" style grouping for counters (en-GB grouping, no locale surprises in tests). */
export function formatCount(n: number, decimals = 0): string {
  const fixed = Math.abs(n).toFixed(decimals);
  const [int = "0", frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${n < 0 ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** Share of an arc to fill for a 0..max score (clamped to 0..1). */
export function arcShare(score: number, max = 100): number {
  if (max <= 0 || !Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score / max));
}
