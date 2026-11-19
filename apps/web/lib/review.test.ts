import { describe, expect, it } from "vitest";
import { applyChange } from "./query/cache";
import { applyReview, countByStatus, filterQueue, nextIndex, sortQueue } from "./review";
import type { Correlation } from "./types";

function corr(id: string, over: Partial<Correlation> = {}): Correlation {
  return {
    id,
    case_id: "c",
    type: "shared_email",
    corr_key: id,
    matched_value: null,
    entities_involved: [],
    confidence: 0.5,
    evidence: [],
    priority: 10,
    status: "pending",
    reviewed: false,
    review_note: null,
    reviewed_at: null,
    created_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("applyReview (optimistic reducer)", () => {
  const list = [corr("a"), corr("b", { status: "approved", reviewed: true, review_note: "old" })];

  it("approves with a note and stamps the time, without mutating the input", () => {
    const next = applyReview(list, { id: "a", decision: "approve", note: "  looks right ", at: "T" });
    expect(next[0]).toMatchObject({
      status: "approved",
      reviewed: true,
      review_note: "looks right",
      reviewed_at: "T",
    });
    expect(list[0]?.status).toBe("pending");
    expect(next[1]).toBe(list[1]);
  });

  it("rejects and keeps an existing note when none is given", () => {
    const next = applyReview(list, { id: "b", decision: "reject", at: "T" });
    expect(next[1]).toMatchObject({ status: "rejected", reviewed: false, review_note: "old" });
  });

  it("reset clears the decision, note and timestamp", () => {
    const next = applyReview(list, { id: "b", decision: "reset" });
    expect(next[1]).toMatchObject({
      status: "pending",
      reviewed: false,
      review_note: null,
      reviewed_at: null,
    });
  });

  it("is a no-op for an unknown id, so rollback is just restoring the previous list", () => {
    expect(applyReview(list, { id: "zzz", decision: "approve" })).toEqual(list);
    const optimistic = applyReview(list, { id: "a", decision: "approve", at: "T" });
    const rolledBack = list; // what onError restores
    expect(rolledBack[0]?.status).toBe("pending");
    expect(optimistic).not.toBe(rolledBack);
  });
});

describe("queue helpers", () => {
  const queue = [
    corr("low", { priority: 1 }),
    corr("high", { priority: 9, confidence: 0.4 }),
    corr("high-conf", { priority: 9, confidence: 0.9 }),
    corr("done", { priority: 99, status: "approved" }),
    corr("no", { priority: 5, status: "rejected" }),
  ];

  it("orders by priority, then confidence", () => {
    expect(sortQueue(queue).map((c) => c.id)).toEqual(["done", "high-conf", "high", "no", "low"]);
  });

  it("filters by status and counts", () => {
    expect(filterQueue(queue, "pending").map((c) => c.id)).toEqual(["high-conf", "high", "low"]);
    expect(filterQueue(queue, "all")).toHaveLength(5);
    expect(countByStatus(queue)).toEqual({ all: 5, pending: 3, approved: 1, rejected: 1 });
  });

  it("clamps keyboard navigation", () => {
    expect(nextIndex(0, 3, -1)).toBe(0);
    expect(nextIndex(2, 3, 1)).toBe(2);
    expect(nextIndex(1, 3, 1)).toBe(2);
    expect(nextIndex(4, 0, 1)).toBe(0);
  });
});

describe("applyChange (Realtime cache patch)", () => {
  const list = [corr("a"), corr("b")];
  it("inserts, updates and deletes by id", () => {
    expect(applyChange(list, "INSERT", "c", corr("c"))?.map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(applyChange(list, "UPDATE", "b", corr("b", { status: "approved" }))?.[1]?.status).toBe("approved");
    expect(applyChange(list, "INSERT", "a", corr("a", { priority: 3 }))).toHaveLength(2);
    expect(applyChange(list, "DELETE", "a", null)?.map((c) => c.id)).toEqual(["b"]);
  });
  it("leaves an unloaded list alone", () => {
    expect(applyChange(undefined, "INSERT", "a", corr("a"))).toBeUndefined();
  });
});
