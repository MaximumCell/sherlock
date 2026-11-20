import { describe, expect, it } from "vitest";
import { DEMO_IDS } from "./demo-data";
import { createDemoAdminSource } from "./demo-source";
import { SEARCH_OUTCOMES } from "./types";

const make = (clock = { t: Date.parse("2026-11-20T12:00:00Z") }) => ({
  clock,
  src: createDemoAdminSource({ now: () => clock.t, latencyMs: 0, liveEveryMs: 5000 }),
});

describe("demo admin source", () => {
  it("is an operator and is marked as demo", async () => {
    const { src } = make();
    expect(src.demo).toBe(true);
    expect(await src.me()).toEqual({ is_admin: true, email: "operator@example.com" });
  });

  it("builds a zero-filled overview that matches the feed", async () => {
    const { src } = make();
    const o = await src.overview(14);
    expect(o.series).toHaveLength(14);
    const charted = o.series.reduce(
      (sum, p) => sum + SEARCH_OUTCOMES.reduce((s, k) => s + p[k], 0),
      0,
    );
    expect(charted).toBe(o.totals.searches);
    expect(o.totals.flagged_sessions).toBeGreaterThanOrEqual(3);
    expect(o.top_targets[0]?.count).toBeGreaterThanOrEqual(2);
  });

  it("uses only invented, reserved targets", async () => {
    const { src } = make();
    const all = await src.searches({ limit: 500 });
    for (const r of all.items) {
      expect(r.target_value).toMatch(
        /example|^203\.0\.113\.|^198\.51\.100\.|^[A-Za-z -]+$|^[a-z-]+$/,
      );
    }
  });

  it("filters and pages the feed newest first", async () => {
    const { src } = make();
    const page1 = await src.searches({ limit: 5 });
    expect(page1.items).toHaveLength(5);
    expect(page1.items[0]!.id).toBeGreaterThan(page1.items[4]!.id);
    const page2 = await src.searches({ limit: 5, cursor: page1.next_cursor });
    expect(page2.items[0]!.id).toBeLessThan(page1.items[4]!.id);
    const forbidden = await src.searches({ outcome: "forbidden" });
    expect(
      forbidden.items.every((r) => r.outcome === "forbidden" && r.target_type === "name"),
    ).toBe(true);
    expect((await src.searches({ q: "HARBOUR" })).items.length).toBeGreaterThan(0);
  });

  it("adds a live search after the interval, refused while paused", async () => {
    const { src, clock } = make();
    const before = (await src.searches({ limit: 1 })).items[0]!.id;
    clock.t += 6000;
    expect((await src.searches({ limit: 1 })).items[0]!.id).toBe(before + 1);
    await src.setPaused(true);
    clock.t += 6000;
    const [row] = (await src.searches({ limit: 1 })).items;
    expect(row?.outcome).toBe("paused");
    expect((await src.overview(7)).scans_paused).toBe(true);
  });

  it("blocks, unblocks and deletes cases locally", async () => {
    const { src } = make();
    const flagged = await src.sessions({ flagged: true });
    expect(flagged.items[0]?.flags[0]?.severity).toBe("high");
    const blocked = await src.block(DEMO_IDS.kit, "  testing  ");
    expect(blocked.blocked).toBe(true);
    expect(blocked.blocked_reason).toBe("testing");
    expect((await src.sessions({ blocked: true })).items.map((s) => s.user_id)).toContain(
      DEMO_IDS.kit,
    );
    expect((await src.unblock(DEMO_IDS.kit)).blocked).toBe(false);
    const detail = await src.session(DEMO_IDS.kit);
    expect(detail.cases).toHaveLength(2);
    await src.deleteCase(detail.cases[0]!.id);
    expect((await src.session(DEMO_IDS.kit)).cases).toHaveLength(1);
    await expect(src.session("nope")).rejects.toMatchObject({ status: 404 });
  });
});
