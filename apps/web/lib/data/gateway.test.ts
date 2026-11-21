import { describe, expect, it, vi } from "vitest";
import { createGateway, GatewayError, isGatewayRefusal, parseActiveSearch, parseRetryAfter } from "./gateway";
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

describe("search refusal details", () => {
  it("reads Retry-After and the running search from a refusal", async () => {
    const res = new Response(
      JSON.stringify({ detail: "Your previous search is still running.", active_search: { case_id: "c1", batch_ids: ["b1", 7] } }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "240" } },
    );
    const request = createGateway({ baseUrl: "http://gw", fetchImpl: vi.fn(async () => res), status: createGatewayStatus() });
    const err = (await request("/cases", { method: "POST", body: {} }).catch((e: unknown) => e)) as GatewayError;
    expect(err.retryAfterS).toBe(240);
    expect(err.activeSearch).toEqual({ caseId: "c1", batchIds: ["b1"] });
  });

  it("shows a busy 503 at once instead of retrying it as a cold start", async () => {
    const busy = vi.fn(async () =>
      new Response('{"detail":"Sherlock is busy right now. Try again in a few minutes."}', {
        status: 503,
        headers: { "Retry-After": "180" },
      }),
    );
    const request = createGateway({ baseUrl: "http://gw", fetchImpl: busy, sleep: vi.fn(async () => {}), status: createGatewayStatus() });
    await expect(request("/cases", { method: "POST", body: {} })).rejects.toMatchObject({ status: 503, retryAfterS: 180 });
    expect(busy).toHaveBeenCalledTimes(1);
  });

  it("parses defensively", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("12.2")).toBe(13);
    expect(parseActiveSearch('{"detail":"x"}')).toBeNull();
    expect(parseActiveSearch("not json")).toBeNull();
  });
});
