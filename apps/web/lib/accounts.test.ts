import { describe, expect, it } from "vitest";
import { accountsInLink, buildAccounts, linkRows, mergeExplanation } from "./accounts";
import { DEMO_CASE_ID, EMAIL, HANDLE, fid } from "./data/fixtures/demo-case";
import { createFixtureState } from "./data/fixtures/state";
import { followUpOutcome, suggestionSource } from "./follow-up";
import { bestPlatformLabel, platformLabel } from "./platforms";
import { applyReview, decisionStatus } from "./review";
import type { Correlation, Finding, Job } from "./types";

function finding(id: string, over: Partial<Finding> = {}): Finding {
  return {
    id,
    case_id: "c",
    identifier_type: "username",
    identifier_value: "kit",
    source_tool: "user_scanner",
    module: "user_scanner",
    platform: "GitHub",
    status: "found",
    finding_key: id,
    extra_metadata: { url: null, extra: {} },
    curated: false,
    job_id: null,
    collected_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

function merge(ids: string[], status: Correlation["status"], key = "github:kit"): Correlation {
  return {
    id: `m-${key}`,
    case_id: "c",
    type: "same_account",
    corr_key: key,
    matched_value: key,
    entities_involved: ids,
    confidence: 1,
    evidence: [`${ids.length} findings describe one GitHub account kit.`],
    priority: 0,
    status,
    reviewed: status === "approved",
    review_note: null,
    reviewed_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
}

const rows = [
  finding("a", {
    module: "github",
    platform: "github",
    extra_metadata: {
      url: "https://github.example/kit",
      extra: { fullname: "Kit Wright", bio: "Kites", email: "kit@example.com" },
    },
  }),
  finding("b", { module: "whatsmyname", platform: "GitHub" }),
  finding("c", {
    platform: "Github",
    identifier_type: "email",
    identifier_value: "kit@example.com",
  }),
  finding("d", { platform: "Gravatar", module: "gravatar", identifier_type: "email" }),
  finding("x", { status: "not_found", platform: "Steam" }),
];

describe("buildAccounts follows the stored rows (it never merges on its own)", () => {
  it("merges an approved same_account row into one account with every source", () => {
    const { accounts, byFinding } = buildAccounts(rows, [merge(["a", "b", "c"], "approved")]);
    expect(accounts).toHaveLength(2); // GitHub (3 rows) + Gravatar; not_found rows are not accounts
    const gh = byFinding.get("c")!;
    expect(gh).toBe(byFinding.get("a"));
    expect(gh.state).toBe("merged");
    expect(gh.label).toBe("GitHub");
    expect(gh.handle).toBe("kit");
    expect(gh.primary.id).toBe("a"); // the richest row
    expect(gh.sources).toEqual(["github", "user_scanner", "whatsmyname"]);
    expect(gh.view.fullname).toBe("Kit Wright");
    expect(gh.view.emails).toEqual(["kit@example.com"]);
  });

  it("without a merge row every found row is its own account", () => {
    expect(buildAccounts(rows, []).accounts.map((a) => a.state)).toEqual([
      "single",
      "single",
      "single",
      "single",
    ]);
  });

  it("a split (rejected) merge falls back to one account per finding and remembers the row", () => {
    const m = merge(["a", "b", "c"], "rejected");
    const { accounts } = buildAccounts(rows, [m]);
    expect(accounts).toHaveLength(4);
    expect(accounts.filter((a) => a.state === "split").map((a) => a.merge?.id)).toEqual([
      m.id,
      m.id,
      m.id,
    ]);
  });

  it("is order-independent and puts a finding in one account only", () => {
    const corrs = [
      merge(["a", "b"], "approved", "github:kit"),
      merge(["b", "c"], "approved", "github:zz"),
    ];
    const one = buildAccounts(rows, corrs);
    const two = buildAccounts([...rows].reverse(), [...corrs].reverse());
    expect(one.byFinding.get("b")!.key).toBe("github:kit");
    expect(two.byFinding.get("b")!.key).toBe("github:kit");
    expect(one.accounts.map((a) => a.key).sort()).toEqual(two.accounts.map((a) => a.key).sort());
  });

  it("each side of a link is an account, never a row", () => {
    const index = buildAccounts(rows, [merge(["a", "b", "c"], "approved")]);
    const link = { entities_involved: ["a", "b", "c", "d"] };
    expect(accountsInLink(link, index).map((a) => a.key)).toEqual(["github:kit", "finding:d"]);
    expect(linkRows([merge([], "approved"), { type: "shared_email" }])).toEqual([
      { type: "shared_email" },
    ]);
  });
});

describe("platform labels", () => {
  it("shows one label whatever the source wrote", () => {
    expect(["github", "Github", "GitHub", "gh"].map(platformLabel)).toEqual([
      "GitHub",
      "GitHub",
      "GitHub",
      "GitHub",
    ]);
    expect(platformLabel("x")).toBe("X (Twitter)");
    expect(platformLabel("Pixelfed")).toBe("Pixelfed");
    expect(platformLabel("Fediforum")).toBe("Fediforum");
    expect(bestPlatformLabel(["fediforum", "FediForum"])).toBe("FediForum");
  });
});

describe("split and merge again (optimistic reducer)", () => {
  it("reset on an automatic merge means merged again, never pending", () => {
    const m = merge(["a", "b"], "rejected");
    expect(decisionStatus(m, "reset")).toBe("approved");
    expect(decisionStatus({ type: "shared_email" }, "reset")).toBe("pending");
    const [after] = applyReview([m], { id: m.id, decision: "reset", at: "2026-01-02T00:00:00Z" });
    expect(after!.status).toBe("approved");
    expect(after!.reviewed_at).toBe("2026-01-02T00:00:00Z");
    const [split] = applyReview([after!], { id: m.id, decision: "reject" });
    expect(split!.status).toBe("rejected");
  });
});

describe("follow-up searches", () => {
  const state = createFixtureState(Date.parse("2026-06-01T12:00:00Z"));
  const findings = state.findings.filter((f) => f.case_id === DEMO_CASE_ID);
  const corrs = state.correlations.filter((c) => c.case_id === DEMO_CASE_ID);
  const index = buildAccounts(findings, corrs);
  const byId = new Map(findings.map((f) => [f.id, f]));

  it("says where a suggestion came from", () => {
    expect(suggestionSource({ source_finding_id: fid(1), platform: null }, byId, index)).toBe(
      `Shown on the GitHub profile ${HANDLE}`,
    );
    expect(suggestionSource({ source_finding_id: null, platform: "npm" }, byId, index)).toBe(
      "Shown on npm",
    );
    // a DNS record is a result, not a profile
    expect(suggestionSource({ source_finding_id: fid(70), platform: null }, byId, index)).toBe(
      "Shown in your dns result",
    );
  });

  it("summarises what a finished search added", () => {
    const jobs = state.jobs.filter((j) => j.case_id === DEMO_CASE_ID);
    const outcome = followUpOutcome({ kind: "email", value: EMAIL }, jobs, findings, index);
    // the registration hit joined the GitHub account found by the username search
    expect(outcome?.confirms).toBe(1);
    expect(outcome?.text).toMatch(/^\d+ new results · 1 confirms an account you already have$/);
    const typedIn = followUpOutcome({ kind: "email", value: EMAIL }, jobs, findings, index, false);
    expect(typedIn?.text).toMatch(/^\d+ results · 1 confirms/);
    expect(
      followUpOutcome({ kind: "email", value: "nobody@example.net" }, jobs, findings, index),
    ).toBe(null);
  });

  it("is a pure function of jobs, findings and accounts", () => {
    const job = { target_type: "username", target_value: "kit", status: "succeeded" } as Job;
    const index2 = buildAccounts(rows, [merge(["a", "b", "c"], "approved")]);
    expect(followUpOutcome({ kind: "username", value: "kit" }, [job], rows, index2)?.text).toBe(
      "2 new results · 1 confirms an account you already have",
    );
    const running = { ...job, status: "running" } as Job;
    expect(
      followUpOutcome({ kind: "username", value: "kit" }, [running], rows, index2)?.state,
    ).toBe("running");
    expect(followUpOutcome({ kind: "username", value: "zed" }, [job], rows, index2)).toBe(null);
  });
});

describe("mergeExplanation", () => {
  it("keeps the why, drops the module bookkeeping", () => {
    const ev = [
      "4 findings describe one GitHub account kit, confirmed by github, user_scanner. The GitHub profile kit publishes a@b.net, and a@b.net is registered on GitHub.",
    ];
    expect(mergeExplanation(ev, "GitHub", "kit")).toBe(
      "The GitHub profile kit publishes a@b.net, and a@b.net is registered on GitHub.",
    );
    expect(mergeExplanation([ev[0]!.split(". ")[0]! + "."], "GitHub", "kit")).toBe(
      "Several sources report the same GitHub account kit.",
    );
  });
});
