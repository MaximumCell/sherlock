import { describe, expect, it, vi } from "vitest";
import { GatewayError, type GatewayRequest } from "../data/gateway";
import { createGatewayAdminSource, queryString } from "./gateway-source";

describe("gateway admin source", () => {
  it("builds query strings from defined values only", () => {
    expect(queryString({ a: 1, b: "", c: undefined, d: null, e: false, f: "x y" })).toBe(
      "?a=1&e=false&f=x+y",
    );
    expect(queryString({})).toBe("");
  });

  it("treats 404 and 401 from /admin/me as not an operator", async () => {
    for (const status of [404, 401]) {
      const command = vi.fn(async () => {
        throw new GatewayError(status, "Not Found");
      });
      expect(await createGatewayAdminSource(command).me()).toBeNull();
    }
    const failing = vi.fn(async () => {
      throw new GatewayError(500, "boom");
    });
    await expect(createGatewayAdminSource(failing).me()).rejects.toMatchObject({ status: 500 });
  });

  it("calls the documented routes", async () => {
    const calls: [string, GatewayRequest | undefined][] = [];
    const command = async <T>(path: string, options?: GatewayRequest): Promise<T> => {
      calls.push([path, options]);
      return { scans_paused: true, items: [], next_cursor: null } as T;
    };
    const src = createGatewayAdminSource(command);
    await src.me({ quiet: true });
    await src.searches({ outcome: "blocked", q: " kit ", cursor: "41", limit: 25 });
    await src.sessions({ flagged: true });
    await src.block("u1", "spam");
    expect(await src.setPaused(true)).toBe(true);
    await src.deleteCase("c1");
    expect(calls.map(([p, o]) => [p, o?.method ?? "GET"])).toEqual([
      ["/admin/me", "GET"],
      ["/admin/searches?outcome=blocked&q=kit&limit=25&cursor=41", "GET"],
      ["/admin/sessions?flagged=true", "GET"],
      ["/admin/sessions/u1/block", "POST"],
      ["/admin/pause", "POST"],
      ["/admin/cases/c1", "DELETE"],
    ]);
    expect(calls[0]?.[1]?.retry).toBe(false);
    expect(calls[3]?.[1]?.body).toEqual({ reason: "spam" });
  });
});
