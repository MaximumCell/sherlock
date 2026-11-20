import { describe, expect, it } from "vitest";
import { swipeDecision, swipeProgress, swipeThreshold } from "./swipe";

describe("swipe decisions", () => {
  it("scales the threshold with the card, within bounds", () => {
    expect(swipeThreshold(100)).toBe(60);
    expect(swipeThreshold(300)).toBe(90);
    expect(swipeThreshold(1000)).toBe(120);
  });

  it("decides by distance: right is yes, left is no", () => {
    expect(swipeDecision(130, 0, 400)).toBe("approve");
    expect(swipeDecision(-130, 0, 400)).toBe("reject");
    expect(swipeDecision(50, 0, 400)).toBeNull();
  });

  it("accepts a fast flick over a short distance, in the same direction only", () => {
    expect(swipeDecision(45, 900, 400)).toBe("approve");
    expect(swipeDecision(-45, -900, 400)).toBe("reject");
    expect(swipeDecision(45, -900, 400)).toBeNull();
    expect(swipeDecision(20, 2000, 400)).toBeNull();
  });

  it("reports progress towards a decision", () => {
    expect(swipeProgress(0, 400)).toBe(0);
    expect(swipeProgress(60, 400)).toBeCloseTo(0.5);
    expect(swipeProgress(-500, 400)).toBe(1);
  });
});
