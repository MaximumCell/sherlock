/**
 * Swipe decisions for the link question on touch screens: right means "yes, same", left
 * means "no". Pure so the thresholds are tested and the same on every device.
 */

export type SwipeDecision = "approve" | "reject" | null;

/** Distance (px) a card must travel to count, capped by a share of its width. */
export function swipeThreshold(width: number): number {
  return Math.max(60, Math.min(120, width * 0.3));
}

/**
 * A release counts when the card travelled past the threshold, or was flicked fast (>600
 * px/s) at least 40 px in the same direction. Anything else snaps back.
 */
export function swipeDecision(offset: number, velocity: number, width: number): SwipeDecision {
  const far = Math.abs(offset) >= swipeThreshold(width);
  const flick = Math.abs(velocity) > 600 && Math.abs(offset) >= 40 && Math.sign(velocity) === Math.sign(offset);
  if (!far && !flick) return null;
  return offset > 0 ? "approve" : "reject";
}

/** 0..1: how close a drag is to deciding, for the Yes / No hint that fades in. */
export function swipeProgress(offset: number, width: number): number {
  return Math.min(1, Math.abs(offset) / swipeThreshold(width));
}
