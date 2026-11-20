import { describe, expect, it, vi } from "vitest";
import { createGateway, GatewayError, isGatewayRefusal } from "./gateway";
import { createGatewayStatus } from "./gateway-status";

function respond(status: number, body: string) {
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
}

describe("gateway refusals", () => {
  it("recognises a 503 answered by the gateway itself", () => {
    expect(isGatewayRefusal(503, '{"detail":"Searches are paused by the operator. Try again later."}')).toBe(true);
    expect(isGatewayRefusal(503, "<html>Service waking up</html>")).toBe(false);
    expect(isGatewayRefusal(502, '{"detail":"x"}')).toBe(false);
  });

  it("does not retry a paused answer, but still retries a cold start", async () => {
    const sleep = vi.fn(async () => {});
    const paused = vi.fn(async () => respond(503, '{"detail":"Searches are paused by the operator. Try again later."}'));
    const request = createGateway({ baseUrl: "http://gw", fetchImpl: paused, sleep, status: createGatewayStatus() });
    await expect(request("/cases", { method: "POST", body: {} })).rejects.toMatchObject({
      status: 503,
      detail: "Searches are paused by the operator. Try again later.",
    });
    expect(paused).toHaveBeenCalledTimes(1);

    const cold = vi
      .fn()
      .mockResolvedValueOnce(new Response("waking", { status: 503 }))
      .mockResolvedValueOnce(respond(200, '{"ok":true}'));
    const retrying = createGateway({ baseUrl: "http://gw", fetchImpl: cold, sleep, status: createGatewayStatus() });
    await expect(retrying("/health")).resolves.toEqual({ ok: true });
    expect(cold).toHaveBeenCalledTimes(2);
  });

  it("keeps 4xx errors final", async () => {
    const notFound = vi.fn(async () => respond(404, '{"detail":"Not Found"}'));
    const request = createGateway({ baseUrl: "http://gw", fetchImpl: notFound, status: createGatewayStatus() });
    const err = await request("/admin/me").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
