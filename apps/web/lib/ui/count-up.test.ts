import { describe, expect, it } from "vitest";
import { arcShare, countUpDuration, countUpValue, easeOutCubic, formatCount } from "./count-up";

describe("count-up helpers", () => {
  it("eases out and clamps", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it("counts from one value to another and lands exactly", () => {
    expect(countUpValue(0, 40, 0)).toBe(0);
    expect(countUpValue(0, 40, 1)).toBe(40);
    expect(countUpValue(0, 40, 5)).toBe(40);
    const mid = countUpValue(0, 40, 0.5);
    expect(mid).toBeGreaterThan(20);
    expect(mid).toBeLessThan(40);
    expect(Number.isInteger(mid)).toBe(true);
    expect(countUpValue(50, 10, 1)).toBe(10);
    expect(countUpValue(0, 1, 0.3, 2)).toBeCloseTo(0.66, 2);
  });

  it("scales duration with the jump, within bounds", () => {
    expect(countUpDuration(5, 5)).toBe(0);
    const small = countUpDuration(0, 3);
    const big = countUpDuration(0, 3000);
    expect(small).toBeGreaterThanOrEqual(150);
    expect(big).toBeLessThanOrEqual(900);
    expect(big).toBeGreaterThan(small);
  });

  it("groups thousands", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(-1200)).toBe("-1,200");
    expect(formatCount(12.345, 1)).toBe("12.3");
  });

  it("clamps the share of an arc", () => {
    expect(arcShare(50)).toBe(0.5);
    expect(arcShare(150)).toBe(1);
    expect(arcShare(-5)).toBe(0);
    expect(arcShare(3, 0)).toBe(0);
    expect(arcShare(Number.NaN)).toBe(0);
  });
});
