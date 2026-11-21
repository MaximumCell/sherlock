import { describe, expect, it } from "vitest";
import { GatewayError } from "../gateway";
import { createFixtureDataSource } from "./index";

const body = (value: string) => ({ identifiers: [{ type: "username" as const, value }] });

describe("fixture search limits", () => {
  it("needs no account by default", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    expect(ds.searchNeedsAccount).toBe(false);
    await expect(ds.createCase(body("octocat"))).resolves.toMatchObject({ case: { title: null } });
  });

  it("asks for sign-in when switched on, and searches once signed in", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0, requireSignIn: true });
    const err = await ds.createCase(body("octocat")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBe(401);
    await ds.signInWithEmail("kit@example.com", "/");
    await expect(ds.createCase(body("octocat"))).resolves.toBeTruthy();
  });

  it("shows busy, limit and active-search refusals for the trigger values", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    const busy = (await ds.createCase(body("demo-busy")).catch((e: unknown) => e)) as GatewayError;
    expect(busy.status).toBe(503);
    expect(busy.retryAfterS).toBe(180);
    const limit = (await ds
      .createCase(body("demo-limit"))
      .catch((e: unknown) => e)) as GatewayError;
    expect(limit.status).toBe(429);
    expect(limit.retryAfterS).toBe(240);
    const { case: running, jobs } = await ds.createCase(body("octocat"));
    const active = (await ds
      .createCase(body("demo-running"))
      .catch((e: unknown) => e)) as GatewayError;
    expect(active.activeSearch?.caseId).toBe(running.id);
    expect(active.activeSearch?.batchIds).toEqual([jobs[0]?.batch_id]);
  });

  it("holds a demo-queued search behind invented searches, then runs it", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    const { case: c } = await ds.createCase(body("demo-queued"));
    expect(await ds.queueStatus(c.id)).toMatchObject({ waiting: true, ahead: 2 });
    for (let i = 0; i < 10; i++) ds.tick();
    expect(await ds.queueStatus(c.id)).toMatchObject({ waiting: false, ahead: 0 });
  });

  it("stops a whole search with cancelBatch", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    const { case: c, jobs } = await ds.createCase(body("octocat"));
    const out = await ds.cancelBatch(c.id, jobs[0]?.batch_id ?? "");
    expect(out.cancelled).toBe(jobs.length);
    expect(new Set(out.jobs.map((j) => j.status))).toEqual(new Set(["cancelled"]));
  });
});
