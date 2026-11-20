import { describe, expect, it } from "vitest";
import { caseStatusLine, deriveSteps, sourceProgress, sourceProgressText } from "./case-progress";
import { buildSummarySentence, joinList } from "./case-summary";
import { DEMO_CASE_ID } from "./data/fixtures/demo-case";
import { createFixtureState } from "./data/fixtures/state";
import type { JobDigest } from "./data/types";
import {
  FINDING_GROUP_IDS,
  countAccounts,
  groupFindings,
  groupOf,
  highlightScore,
  showAllLabel,
} from "./finding-groups";
import { DEFAULT_QUESTION, describeRule, evidenceLabel } from "./rules";
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
  it("counts every source of the investigation, not just the latest batch", () => {
    const jobs = [
      job("succeeded", "old"),
      job("failed", "old"),
      job("succeeded"),
      job("running"),
      job("queued"),
    ];
    expect(sourceProgress(jobs)).toEqual({
      total: 5,
      done: 3,
      failed: 1,
      active: 2,
      scanning: true,
    });
    expect(sourceProgressText(sourceProgress(jobs))).toBe(
      "3 of 5 sources done · 1 could not be checked",
    );
  });

  it("failed and cancelled sources are done but could not be checked", () => {
    const p = sourceProgress([job("succeeded"), job("failed", "x"), job("cancelled")]);
    expect(p).toEqual({ total: 3, done: 3, failed: 2, active: 0, scanning: false });
  });

  it("matches the demo checklist: 3 still running out of 15 sources", () => {
    const state = createFixtureState(Date.parse("2026-06-01T12:00:00Z"));
    const jobs = state.jobs.filter((j) => j.case_id === DEMO_CASE_ID);
    const p = sourceProgress(jobs);
    expect(p.total).toBe(jobs.length);
    expect(p.total - p.done).toBe(3);
    expect(sourceProgressText(p)).toBe(
      `${jobs.length - 3} of ${jobs.length} sources done · 2 could not be checked`,
    );
    const steps = deriveSteps({ jobs, pendingLinks: 0, totalLinks: 0 });
    expect(steps[0]?.detail).toBe(`${jobs.length - 3}/${jobs.length} sources`);
  });
});

describe("deriveSteps", () => {
  it("scanning: step 1 current with a live count", () => {
    const steps = deriveSteps({
      jobs: [job("succeeded"), job("running")],
      pendingLinks: 2,
      totalLinks: 2,
    });
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

  it("results without scan jobs count as scanned", () => {
    const steps = deriveSteps({ jobs: [], pendingLinks: 0, totalLinks: 0, results: 7 });
    expect(steps.map((s) => [s.state, s.detail])).toEqual([
      ["done", "Done"],
      ["done", "None to check"],
      ["done", "Ready"],
    ]);
  });

  it("finished scan without any link", () => {
    expect(
      deriveSteps({ jobs: [job("succeeded")], pendingLinks: 0, totalLinks: 0 })[1]?.detail,
    ).toBe("None to check");
  });
});

describe("caseStatusLine", () => {
  const base = { archived: false, jobs: [] as JobDigest[], pendingLinks: 0, foundCount: 0 };
  it.each([
    [{ ...base, archived: true, jobs: [job("running")] }, "Archived"],
    [
      { ...base, jobs: [job("succeeded"), job("running"), job("queued")] },
      "Scanning · 1 of 3 sources done",
    ],
    [{ ...base, jobs: [job("succeeded")], pendingLinks: 3 }, "3 links need your decision"],
    [{ ...base, jobs: [job("succeeded")], pendingLinks: 1 }, "1 link needs your decision"],
    [{ ...base, jobs: [job("succeeded")], foundCount: 46 }, "Done · 46 results"],
    [
      {
        ...base,
        jobs: [job("succeeded")],
        foundCount: 46,
        exposure: { score: 63, band: "high" as const },
      },
      "Done · 46 results · exposure 63 High",
    ],
    [base, "Not scanned yet"],
  ])("%#", (input, expected) => {
    expect(caseStatusLine(input)).toBe(expected);
  });
});

describe("buildSummarySentence", () => {
  const base = {
    subject: "ada-fixture",
    accounts: 0,
    results: 0,
    sources: 0,
    breaches: 0,
    pendingLinks: 0,
  };

  it("the full sentence", () => {
    expect(
      buildSummarySentence({
        ...base,
        accounts: 32,
        results: 46,
        sources: 52,
        breaches: 3,
        pendingLinks: 5,
      }),
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
      buildSummarySentence({
        ...base,
        accounts: 4,
        results: 4,
        sources: 6,
        scanning: { done: 6, total: 18 },
      }),
    ).toBe(
      "We found 4 accounts for ada-fixture across 6 sites so far. Still waiting on 12 of 18 data sources.",
    );
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
    expect(
      groupOf(
        make({
          platform: "GitHub",
          identifier_type: "username",
          extra_metadata: meta("development"),
        }),
      ),
    ).toBe("accounts");
    expect(
      groupOf(make({ platform: "dns", identifier_type: "domain", extra_metadata: meta("dns") })),
    ).toBe("web");
    expect(
      groupOf(
        make({
          platform: "crt.sh",
          identifier_type: "username",
          extra_metadata: meta("certificate"),
        }),
      ),
    ).toBe("web");
    expect(
      groupOf(make({ platform: "exif", identifier_type: "image", extra_metadata: meta("media") })),
    ).toBe("images");
    expect(
      groupOf(
        make({ platform: "hn", identifier_type: "username", extra_metadata: meta("activity") }),
      ),
    ).toBe("activity");
    expect(
      groupOf(
        make({ platform: "carrier", identifier_type: "phone", extra_metadata: meta("telephony") }),
      ),
    ).toBe("phone");
    expect(
      groupOf(make({ platform: "eth", identifier_type: "wallet", extra_metadata: meta("wallet") })),
    ).toBe("wallet");
    expect(
      groupOf(make({ platform: "web", identifier_type: "name", extra_metadata: meta("identity") })),
    ).toBe("names");
    expect(groupOf(make({ platform: "x", identifier_type: "other", extra_metadata: {} }))).toBe(
      "other",
    );
  });

  it("groups the demo case in display order, found rows only", () => {
    const groups = groupFindings(findings, state.correlations);
    const ids = groups.map((g) => g.id);
    expect(ids).toEqual(FINDING_GROUP_IDS.filter((id) => ids.includes(id)));
    expect(ids.slice(0, 3)).toEqual(["accounts", "breaches", "web"]);
    // one item per account: the 4 GitHub rows are one card, the split Steam rows stay two
    const total = groups.reduce((sum, g) => sum + g.items.length, 0);
    expect(total).toBe(findings.filter((f) => f.status === "found").length - 3);
    const github = groups.flatMap((g) => g.items).find((a) => a.key === "github:ada-fixture");
    expect(github?.findings).toHaveLength(4);
    expect(github?.label).toBe("GitHub");
    expect(github?.sources).toEqual(["github", "user_scanner", "whatsmyname"]);
    expect(groups.find((g) => g.id === "accounts")?.misses).toBeGreaterThan(0);
  });

  it("puts pinned, rich results first", () => {
    const accounts = groupFindings(findings).find((g) => g.id === "accounts");
    expect(accounts?.items[0]?.findings.some((f) => f.curated)).toBe(true);
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
    expect(steps.map((s) => s.text)).toEqual([
      "Change reused passwords",
      "Use a password manager",
      "Tidy bios",
    ]);
    expect(steps[0]).toMatchObject({ factorKey: "high", points: 9 });
  });
});

describe("one account count everywhere", () => {
  const state = createFixtureState(Date.parse("2026-06-01T12:00:00Z"));
  const findings = state.findings.filter((f) => f.case_id === DEMO_CASE_ID);

  it("the Summary count equals the Accounts & profiles heading", () => {
    const accounts = groupFindings(findings, state.correlations).find((g) => g.id === "accounts");
    expect(countAccounts(findings, state.correlations)).toBe(accounts?.items.length);
    // without the merge rows every row would be counted
    expect(countAccounts(findings)).toBe((accounts?.items.length ?? 0) + 3);
  });

  it("the expander repeats the heading count and names not-found rows", () => {
    expect(showAllLabel({ items: new Array(29).fill(findings[0]), misses: 10 })).toBe(
      "Show all · 29 found · 10 not found",
    );
    expect(showAllLabel({ items: new Array(8).fill(findings[0]), misses: 0 })).toBe("Show all 8");
  });
});

describe("link questions", () => {
  it("each rule asks its own question", () => {
    expect(describeRule("breach_overlap").question).toBe(
      "Is this the same address appearing in several breaches?",
    );
    expect(describeRule("shared_avatar").question).toBe("Is this the same profile picture?");
    expect(describeRule("shared_email").question).toMatch(/same email address/);
    expect(describeRule("shared_url").question).toMatch(/same website/);
    expect(describeRule("shared_external_handle").question).toMatch(/point to the other account/);
    expect(describeRule("shared_bio").question).toMatch(/same bio/);
    expect(describeRule("shared_name").question).toMatch(/same display name/);
  });

  it("every engine rule has a title, an explanation and a question; none falls back", () => {
    for (const rule of [
      "shared_email",
      "shared_url",
      "shared_external_handle",
      "shared_display_name",
      "shared_bio_text",
      "breach_overlap",
      "avatar_match",
      "manual_link",
      "same_account",
    ]) {
      const d = describeRule(rule);
      expect(d.title).not.toMatch(/_/);
      expect(d.summary).not.toMatch(/correlation rule/i);
      expect(d.question.endsWith("?")).toBe(true);
    }
    expect(describeRule("something_new").summary).not.toMatch(/correlation rule/i);
  });

  it("evidence fields read as plain words", () => {
    expect(evidenceLabel("identifier_value", "email")).toBe("Searched email");
    expect(evidenceLabel("identifier_value", "username")).toBe("Searched username");
    expect(evidenceLabel("extra.email")).toBe("Email shown on profile");
    expect(evidenceLabel("links")).toBe("Links on profile");
    expect(evidenceLabel("extra.bio")).toBe("Bio");
    expect(evidenceLabel("avatar_phash")).toBe("Profile picture");
    expect(evidenceLabel("extra.twitter")).toBe("X account named on profile");
    expect(evidenceLabel("extra.public_repos")).toBe("Public repos");
  });

  it("unknown rules fall back to the default question", () => {
    expect(describeRule("something_new").question).toBe(DEFAULT_QUESTION);
    expect(DEFAULT_QUESTION).toBe("Do these belong to the same person?");
  });
});
