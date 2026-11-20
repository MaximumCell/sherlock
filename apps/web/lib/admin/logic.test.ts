import { describe, expect, it } from "vitest";
import {
  barDescription,
  chartModel,
  countryFlag,
  flagSummary,
  newRowIds,
  niceMax,
  quotaPercent,
  relativeTime,
  sessionName,
  severityTone,
  sharedOriginLabel,
  topFlag,
  userAgentLabel,
} from "./logic";
import type { DayPoint, MisuseFlag } from "./types";

const point = (day: string, counts: Partial<Omit<DayPoint, "day">> = {}): DayPoint => ({
  day,
  accepted: 0,
  rate_limited: 0,
  blocked: 0,
  paused: 0,
  forbidden: 0,
  invalid: 0,
  ...counts,
});

describe("userAgentLabel", () => {
  it.each([
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      "Safari on macOS",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0",
      "Edge on Windows",
    ],
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      "Chrome on Windows",
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Linux"],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
      "Chrome on iOS",
    ],
    [
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
      "Chrome on Android",
    ],
    ["curl/8.6.0", "curl"],
    ["python-requests/2.32.3", "Python script"],
    ["SomethingElse/1.0", "Other client"],
    ["", "Unknown browser"],
    [null, "Unknown browser"],
  ])("%s", (ua, label) => {
    expect(userAgentLabel(ua)).toBe(label);
  });
});

describe("flags", () => {
  const flags: MisuseFlag[] = [
    { key: "shared_origin", label: "Shares an origin with 2 other sessions", severity: "low" },
    { key: "many_targets", label: "Searched 14 different targets", severity: "high" },
    { key: "burst", label: "9 searches within 10 minutes", severity: "medium" },
  ];
  it("puts the most severe first", () => {
    expect(topFlag(flags)?.key).toBe("many_targets");
    expect(topFlag([])).toBeNull();
  });
  it("summarises", () => {
    expect(flagSummary(flags)).toBe("Searched 14 different targets (+2 more)");
    expect(flagSummary(flags.slice(0, 1))).toBe("Shares an origin with 2 other sessions");
    expect(flagSummary([])).toBe("No warning signs");
  });
  it("maps severity to a tone", () => {
    expect([severityTone("high"), severityTone("medium"), severityTone("low")]).toEqual([
      "danger",
      "warning",
      "muted",
    ]);
  });
});

describe("session labels", () => {
  const base = { user_id: "1a2b3c4d-0000-4000-8000-000000000000", is_anonymous: true, email: null };
  it("names a session", () => {
    expect(sessionName(base)).toBe("Anonymous 1a2b3c4d");
    expect(sessionName({ ...base, is_anonymous: false, email: "kit@example.com" })).toBe(
      "kit@example.com",
    );
    expect(sessionName({ ...base, is_anonymous: false })).toBe("Signed in 1a2b3c4d");
  });
  it("describes a shared origin", () => {
    expect(sharedOriginLabel({ origin_sessions: 1 })).toBeNull();
    expect(sharedOriginLabel({ origin_sessions: 0 })).toBeNull();
    expect(sharedOriginLabel({ origin_sessions: 2 })).toBe("Shared origin with 1 other session");
    expect(sharedOriginLabel({ origin_sessions: 4 })).toBe("Shared origin with 3 other sessions");
  });
  it("turns a country code into a flag", () => {
    expect(countryFlag("de")).toBe("🇩🇪");
    expect(countryFlag("XYZ")).toBe("");
    expect(countryFlag(null)).toBe("");
  });
});

describe("chart series", () => {
  it("rounds the axis to a nice maximum", () => {
    expect(niceMax(0)).toBe(4);
    expect(niceMax(3)).toBe(4);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(23)).toBe(25);
    expect(niceMax(120)).toBe(200);
  });

  it("stacks segments from the bottom in outcome order", () => {
    const model = chartModel(
      [point("2026-11-01"), point("2026-11-02", { accepted: 6, rate_limited: 2, forbidden: 2 })],
      100,
    );
    expect(model.max).toBe(10);
    expect(model.total).toBe(10);
    expect(model.ticks).toEqual([0, 3, 5, 8, 10]);
    expect(model.bars[0]).toEqual({ day: "2026-11-01", total: 0, segments: [] });
    const [accepted, limited, forbidden] = model.bars[1]?.segments ?? [];
    expect(accepted).toEqual({ outcome: "accepted", value: 6, y: 40, height: 60 });
    expect(limited).toEqual({ outcome: "rate_limited", value: 2, y: 20, height: 20 });
    expect(forbidden?.y).toBe(0);
  });

  it("describes a bar for screen readers", () => {
    const model = chartModel([point("2026-11-02", { accepted: 1, paused: 2 })], 100);
    const bar = model.bars[0];
    expect(bar && barDescription(bar)).toBe("Mon 2 Nov: 3 searches (1 accepted, 2 paused)");
  });
});

describe("feed helpers", () => {
  it("finds new rows after a refresh", () => {
    expect([...newRowIds(undefined, [{ id: 3 }])]).toEqual([]);
    expect([...newRowIds([{ id: 1 }, { id: 2 }], [{ id: 3 }, { id: 2 }])]).toEqual([3]);
  });
  it("formats quota and relative time", () => {
    expect(quotaPercent(150, 300)).toBe(50);
    expect(quotaPercent(400, 300)).toBe(100);
    expect(quotaPercent(1, 0)).toBe(0);
    const now = Date.parse("2026-11-20T12:00:00Z");
    expect(relativeTime("2026-11-20T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-11-20T11:30:00Z", now)).toBe("30 min ago");
    expect(relativeTime("2026-11-20T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime(null, now)).toBe("never");
  });
});
