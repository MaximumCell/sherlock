import { describe, expect, it } from "vitest";
import type { Finding, Job } from "../types";
import { deriveScanner, orbitLayout, rankTiles, replayTiles, tileCounts, tileState } from "./scanner";

function job(id: string, status: Job["status"], found?: number): Job {
  return {
    id,
    case_id: "c",
    batch_id: null,
    queue: "identity",
    module: `m-${id}`,
    target_type: "username",
    target_value: "ada-fixture",
    params: {},
    status,
    progress: status === "running" ? 40 : 100,
    progress_note: null,
    attempts: 1,
    max_attempts: 3,
    result: found === undefined ? null : { found, findings: found },
    error: null,
    created_at: "2026-01-01T00:00:00Z",
    started_at: null,
    finished_at: null,
  } as Job;
}

function finding(id: string, at: string, status: Finding["status"] = "found"): Finding {
  return {
    id,
    case_id: "c",
    identifier_type: "username",
    identifier_value: "ada-fixture",
    source_tool: "t",
    module: "m",
    platform: "github",
    status,
    finding_key: id,
    extra_metadata: {},
    curated: false,
    job_id: null,
    collected_at: at,
  } as Finding;
}

describe("scanner state", () => {
  it("maps job status to a tile state", () => {
    expect(tileState(job("a", "queued"))).toBe("waiting");
    expect(tileState(job("a", "running"))).toBe("checking");
    expect(tileState(job("a", "succeeded", 2))).toBe("found");
    expect(tileState(job("a", "succeeded", 0))).toBe("empty");
    expect(tileState(job("a", "succeeded"))).toBe("empty");
    expect(tileState(job("a", "failed"))).toBe("failed");
    expect(tileState(job("a", "cancelled"))).toBe("stopped");
  });

  it("counts done, could-not-check and found, and knows when it is scanning", () => {
    const s = deriveScanner(
      [job("a", "succeeded", 3), job("b", "failed"), job("c", "running"), job("d", "cancelled")],
      [],
    );
    expect(s).toMatchObject({ total: 4, done: 3, failed: 2, found: 3, scanning: true });
    expect(deriveScanner([job("a", "succeeded", 1)], []).scanning).toBe(false);
  });

  it("puts the newest found results in the ticker, and only found ones", () => {
    const s = deriveScanner(
      [],
      [
        finding("old", "2026-01-01T00:00:00Z"),
        finding("new", "2026-01-02T00:00:00Z"),
        finding("miss", "2026-01-03T00:00:00Z", "not_found"),
      ],
      5,
    );
    expect(s.ticker.map((t) => t.id)).toEqual(["new", "old"]);
    expect(s.ticker[0]).toMatchObject({ group: "accounts", what: "account found" });
  });

  it("ranks live tiles first for lists", () => {
    const tiles = deriveScanner([job("a", "queued"), job("b", "succeeded", 1), job("c", "running")], []).tiles;
    expect(rankTiles(tiles).map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  it("lays sources out on one ring, or two when there are many", () => {
    const few = orbitLayout(8);
    expect(few).toHaveLength(8);
    expect(new Set(few.map((p) => p.ring))).toEqual(new Set([0]));
    const many = orbitLayout(30);
    expect(many.filter((p) => p.ring === 0)).toHaveLength(12);
    expect(many.filter((p) => p.ring === 1)).toHaveLength(18);
    for (const p of many) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(1);
  });

  it("replays finished tiles in order and ends on the real state", () => {
    const tiles = deriveScanner(
      [job("a", "succeeded", 2), job("b", "succeeded", 0), job("c", "running")],
      [],
    ).tiles;
    const start = replayTiles(tiles, 0);
    expect(start.map((t) => t.state)).toEqual(["checking", "checking", "checking"]);
    expect(tileCounts(start)).toEqual({ done: 0, found: 0, failed: 0 });
    const half = replayTiles(tiles, 0.5);
    expect(half.map((t) => t.state)).toEqual(["found", "checking", "checking"]);
    expect(replayTiles(tiles, 1)).toEqual(tiles);
    expect(tileCounts(replayTiles(tiles, 1))).toEqual({ done: 2, found: 2, failed: 0 });
  });
});
