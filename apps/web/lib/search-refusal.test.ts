import { describe, expect, it } from "vitest";
import { GatewayError } from "./data/gateway";
import { classifyRefusal, formatWait, waitingText } from "./search-refusal";
import type { QueueStatus } from "./types";

describe("classifyRefusal", () => {
  it("sends a sign-in refusal to the sign-in flow", () => {
    const r = classifyRefusal(
      new GatewayError(401, "Sign in to run a search. It's free and takes a few seconds."),
    );
    expect(r?.kind).toBe("sign_in");
  });

  it("keeps the running search of an active-search refusal", () => {
    const err = new GatewayError(429, "Your previous search is still running.", {
      activeSearch: { caseId: "c1", batchIds: ["b1"] },
    });
    expect(classifyRefusal(err)).toMatchObject({
      kind: "active_search",
      activeSearch: { caseId: "c1", batchIds: ["b1"] },
    });
  });

  it("keeps the gateway's wait when it says it, and adds Retry-After when it does not", () => {
    const said = classifyRefusal(
      new GatewayError(429, "Too many searches. You can search again in about 4 minutes.", {
        retryAfterS: 240,
      }),
    );
    expect(said).toMatchObject({
      kind: "limit",
      description: "Too many searches. You can search again in about 4 minutes.",
    });
    const bare = classifyRefusal(new GatewayError(429, "Rate limited.", { retryAfterS: 3 * 3600 }));
    expect(bare?.description).toBe("Rate limited. You can try again in about 3 hours.");
  });

  it("maps busy, paused and blocked", () => {
    const busy = classifyRefusal(
      new GatewayError(503, "Sherlock is busy right now. Try again in a few minutes.", {
        retryAfterS: 180,
      }),
    );
    expect(busy).toMatchObject({ kind: "busy", title: "Sherlock is busy" });
    expect(busy?.description).toContain("about 3 minutes");
    expect(
      classifyRefusal(
        new GatewayError(503, "Searches are paused by the operator. Try again later."),
      )?.kind,
    ).toBe("paused");
    expect(
      classifyRefusal(new GatewayError(403, "This session has been blocked from running searches."))
        ?.kind,
    ).toBe("blocked");
  });

  it("ignores errors that are not refusals", () => {
    expect(classifyRefusal(new GatewayError(404, "case not found"))).toBeNull();
    expect(
      classifyRefusal(new GatewayError(0, "The scan service could not be reached.")),
    ).toBeNull();
    expect(classifyRefusal(new Error("boom"))).toBeNull();
  });
});

describe("formatWait", () => {
  it("rounds to plain words", () => {
    expect(formatWait(20)).toBe("about a minute");
    expect(formatWait(250)).toBe("about 5 minutes");
    expect(formatWait(3700)).toBe("about an hour");
    expect(formatWait(8 * 3600)).toBe("about 8 hours");
  });
});

describe("waitingText", () => {
  const status = (over: Partial<QueueStatus>): QueueStatus => ({
    case_id: "c",
    queued: 19,
    running: 0,
    waiting: true,
    ahead: 2,
    jobs_ahead: 30,
    estimated_wait_s: 45,
    ...over,
  });

  it("says how many searches are ahead and roughly how long", () => {
    const t = waitingText(status({}));
    expect(t?.headline).toBe("Waiting for other searches to finish · 2 ahead of you");
    expect(t?.detail).toContain("about a minute");
  });

  it("says nothing unless the search really waits", () => {
    expect(waitingText(status({ waiting: false }))).toBeNull();
    expect(waitingText(status({ ahead: 0 }))).toBeNull();
    expect(waitingText(null)).toBeNull();
  });
});
