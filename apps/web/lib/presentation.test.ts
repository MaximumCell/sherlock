import { describe, expect, it } from "vitest";
import { caseStatusLine, deriveSteps, sourceProgress } from "./case-progress";
import { buildSummarySentence, joinList } from "./case-summary";
import { DEMO_CASE_ID } from "./data/fixtures/demo-case";
import { createFixtureState } from "./data/fixtures/state";
import type { JobDigest } from "./data/types";
import { FINDING_GROUP_IDS, groupFindings, groupOf, highlightScore } from "./finding-groups";
import { prioritisedSteps } from "./remediation";
import { sectionFromUrl, visibleSections } from "./sections";
import type { Finding } from "./types";

const job = (status: JobDigest["status"], batch_id = "b1"): JobDigest => ({
  status,
  progress: 0,
  batch_id,
});

const params = (entries: Record<string, string>) => new URLSearchParams(entries);

describe("sourceProgress", () => {
  it("counts only the batches still running", () => {
    const jobs = [job("succeeded", "old"), job("failed", "old"), job("succeeded"), job("running"), job("queued")];
    expect(sourceProgress(jobs)).toEqual({ total: 3, done: 1, failed: 0, active: 2, scanning: true });
  });

  it("counts every job once nothing runs", () => {
    expect(sourceProgress([job("succeeded"), job("failed", "x"), job("cancelled")])).toEqual({
      total: 3,
      done: 3,
      failed: 1,
      active: 0,
      scanning: false,
    });
  });
});

describe("deriveSteps", () => {
  it("scanning: step 1 current with a live count", () => {
    const steps = deriveSteps({ jobs: [job("succeeded"), job("running")], pendingLinks: 2, totalLinks: 2 });
    expect(steps.map((s) => [s.id, s.state, s.detail])).toEqual([
      ["scan", "current", "1/2 sources"],
      ["links", "upcoming", "2 to check"],
      ["report", "upcoming", "Not yet"],
    ]);
  });

  it("links to check once the scan is done", () => {
    const steps = deriveSteps({ jobs: [job("succeeded")], pendingLinks: 3, totalLinks: 5 });
    expect(steps.map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
    expect(steps[1]?.detail).toBe("3 to check");
    expect(steps[2]?.detail).toBe("Draft available");
  });

  it("everything done: report ready", () => {
    const steps = deriveSteps({ jobs: [job("succeeded")], pendingLinks: 0, totalLinks: 4 });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(steps.map((s) => s.detail)).toEqual(["1 source checked", "All checked", "Ready"]);
  });

  it("no scan yet", () => {
    const steps = deriveSteps({ jobs: [], pendingLinks: 0, totalLinks: 0 });
    expect(steps[0]).toMatchObject({ state: "current", detail: "Not started" });
    expect(steps[1]).toMatchObject({ state: "upcoming", detail: "Waiting for results" });
  });

  it("finished scan without any link", () => {
    expect(deriveSteps({ jobs: [job("succeeded")], pendingLinks: 0, totalLinks: 0 })[1]?.detail).toBe(
      "None to check",
    );
  });
});

describe("caseStatusLine", () => {
  const base = { archived: false, jobs: [] as JobDigest[], pendingLinks: 0, foundCount: 0 };
  it.each([
    [{ ...base, archived: true, jobs: [job("running")] }, "Archived"],
    [{ ...base, jobs: [job("succeeded"), job("running"), job("queued")] }, "Scanning · 1 of 3 sources done"],
    [{ ...base, jobs: [job("succeeded")], pendingLinks: 3 }, "3 links need your decision"],
    [{ ...base, jobs: [job("succeeded")], pendingLinks: 1 }, "1 link needs your decision"],
    [{ ...base, jobs: [job("succeeded")], foundCount: 46 }, "Done · 46 results"],
    [
      { ...base, jobs: [job("succeeded")], foundCount: 46, exposure: { score: 63, band: "high" as const } },
      "Done · 46 results · exposure 63 High",
    ],
    [base, "Not scanned yet"],
  ])("%#", (input, expected) => {
    expect(caseStatusLine(input)).toBe(expected);
  });
});

describe("buildSummarySentence", () => {
  const base = { subject: "ada-fixture", accounts: 0, results: 0, sources: 0, breaches: 0, pendingLinks: 0 };

  it("the full sentence", () => {
    expect(
      buildSummarySentence({ ...base, accounts: 32, results: 46, sources: 52, breaches: 3, pendingLinks: 5 }),
    ).toBe(
      "We found 32 accounts for ada-fixture across 52 sites, 3 breach listings and 5 possible links for you to check.",
    );
  });

  it("singulars and no extras", () => {
    expect(buildSummarySentence({ ...base, accounts: 1, results: 1, sources: 1 })).toBe(
      "We found 1 account for ada-fixture across 1 site.",
    );
  });

  it("falls back to results when no accounts", () => {
    expect(buildSummarySentence({ ...base, subject: "example.com", results: 9, sources: 4 })).toBe(
      "We found 9 results for example.com across 4 sites.",
    );
  });

  it("while scanning", () => {
    expect(buildSummarySentence({ ...base, scanning: { done: 0, total: 18 } })).toBe(
      "We are asking 18 data sources about ada-fixture. Results appear here as each one finishes.",
    );
    expect(
      buildSummarySentence({ ...base, accounts: 4, results: 4, sources: 6, scanning: { done: 6, total: 18 } }),
    ).toBe("We found 4 accounts for ada-fixture across 6 sites so far. Still waiting on 12 of 18 data sources.");
  });

  it("nothing found, or nothing run", () => {
    expect(buildSummarySentence({ ...base, sources: 12 })).toBe(
      "We checked 12 sites for ada-fixture and found nothing public.",
    );
    expect(buildSummarySentence(base)).toMatch(/^Nothing has been searched/);
  });

  it("joinList", () => {
    expect(joinList([])).toBe("");
    expect(joinList(["a"])).toBe("a");
    expect(joinList(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("finding groups", () => {
  const state = createFixtureState(Date.parse("2026-06-01T12:00:00Z"));
  const findings = state.findings.filter((f) => f.case_id === DEMO_CASE_ID);
  const make = (over: Partial<Finding>): Finding => ({ ...findings[0]!, ...over });

  it("maps findings onto human groups", () => {
    const meta = (category: string) => ({ category });
    expect(groupOf(make({ platform: "breach", extra_metadata: meta("breach") }))).toBe("breaches");
    expect(groupOf(make({ platform: "GitHub", identifier_type: "username", extra_metadata: meta("development") }))).toBe("accounts");
    expect(groupOf(make({ platform: "dns", identifier_type: "domain", extra_metadata: meta("dns") }))).toBe("web");
    expect(groupOf(make({ platform: "crt.sh", identifier_type: "username", extra_metadata: meta("certificate") }))).toBe("web");
    expect(groupOf(make({ platform: "exif", identifier_type: "image", extra_metadata: meta("media") }))).toBe("images");
    expect(groupOf(make({ platform: "hn", identifier_type: "username", extra_metadata: meta("activity") }))).toBe("activity");
    expect(groupOf(make({ platform: "carrier", identifier_type: "phone", extra_metadata: meta("telephony") }))).toBe("phone");
    expect(groupOf(make({ platform: "eth", identifier_type: "wallet", extra_metadata: meta("wallet") }))).toBe("wallet");
    expect(groupOf(make({ platform: "web", identifier_type: "name", extra_metadata: meta("identity") }))).toBe("names");
    expect(groupOf(make({ platform: "x", identifier_type: "other", extra_metadata: {} }))).toBe("other");
  });

  it("groups the demo case in display order, found rows only", () => {
    const groups = groupFindings(findings, state.correlations);
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual(FINDING_GROUP_IDS.filter((id) => ids.includes(id)));
    expect(ids.slice(0, 3)).toEqual(["accounts", "breaches", "web"]);
    const total = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(findings.filter((f) => f.status === "found").length);
    expect(groups.find((g) => g.id === "accounts")?.misses).toBeGreaterThan(0);
  });

  it("puts pinned, rich results first", () => {
    const accounts = groupFindings(findings).find((g) => g.id === "accounts");
    expect(accounts?.items[0]?.curated).toBe(true);
    const bare = make({ curated: false, status: "found", extra_metadata: { category: "x" } });
    expect(highlightScore(make({ curated: true }))).toBeGreaterThan(highlightScore(bare));
    expect(highlightScore(make({ status: "not_found" }))).toBe(-1);
  });
});

describe("sectionFromUrl", () => {
  it("reads the hash first, then ?section, then a legacy ?tab", () => {
    expect(sectionFromUrl(params({}), "#links", false)).toBe("links");
    expect(sectionFromUrl(params({ section: "map" }), "", false)).toBe("map");
    expect(sectionFromUrl(params({ tab: "review" }), "", false)).toBe("links");
    expect(sectionFromUrl(params({ tab: "findings" }), "", false)).toBe("found");
    expect(sectionFromUrl(params({ tab: "graph" }), "", false)).toBe("map");
    expect(sectionFromUrl(params({ tab: "timeline" }), "", false)).toBe("history");
    expect(sectionFromUrl(params({ tab: "overview" }), "", false)).toBe("summary");
    expect(sectionFromUrl(params({ tab: "report" }), "", false)).toBe("report");
    expect(sectionFromUrl(params({}), "#scan", false)).toBe("summary");
  });

  it("ignores unknown or unavailable sections", () => {
    expect(sectionFromUrl(params({ tab: "nope" }), "#nope", false)).toBeNull();
    expect(sectionFromUrl(params({ tab: "people" }), "", false)).toBeNull();
    expect(sectionFromUrl(params({ tab: "people" }), "", true)).toBe("people");
    expect(visibleSections(false)).not.toContain("people");
  });
});

describe("prioritisedSteps", () => {
  const factor = (key: string, points: number, remediation: string[]) => ({
    key,
    label: key,
    points,
    max_points: 10,
    detail: "",
    evidence_finding_ids: [],
    remediation,
  });

  it("orders by factor points, keeps factor order, drops duplicates and zero factors", () => {
    const steps = prioritisedSteps([
      factor("low", 2, ["Tidy bios", "Use a password manager"]),
      factor("high", 9, ["Change reused passwords", "Use a password manager"]),
      factor("none", 0, ["Never shown"]),
    ]);
    expect(steps.map((s) => s.text)).toEqual(["Change reused passwords", "Use a password manager", "Tidy bios"]);
    expect(steps[0]).toMatchObject({ factorKey: "high", points: 9 });
  });
});
