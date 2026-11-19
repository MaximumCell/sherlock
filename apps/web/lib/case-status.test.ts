import { describe, expect, it } from "vitest";
import { parseCaseListQuery, selectCases } from "./case-list";
import { caseDisplayTitle, deriveCaseStatus, scanProgress } from "./case-status";
import { createFixtureState } from "./data/fixtures/state";
import type { CaseSummary, JobDigest } from "./data/types";

const job = (status: JobDigest["status"], progress = 0, batch_id = "b1"): JobDigest => ({
  status,
  progress,
  batch_id,
});
const open = { archived_at: null };

describe("deriveCaseStatus", () => {
  it("is idle with no jobs and nothing to review", () => {
    expect(deriveCaseStatus(open, [], 0)).toMatchObject({ kind: "idle", activeJobs: 0 });
  });

  it("is scanning while any job is queued or running, with batch progress", () => {
    const status = deriveCaseStatus(open, [job("succeeded", 100), job("running", 50), job("queued")], 4);
    expect(status).toMatchObject({ kind: "scanning", activeJobs: 2, progress: 50, pendingReviews: 4 });
  });

  it("needs review once scans are done and correlations are pending", () => {
    const status = deriveCaseStatus(open, [job("succeeded", 100), job("failed", 40)], 3);
    expect(status).toMatchObject({ kind: "needs_review", label: "3 to review" });
  });

  it("archived wins over everything else", () => {
    const status = deriveCaseStatus({ archived_at: "2026-01-01T00:00:00Z" }, [job("running", 10)], 2);
    expect(status.kind).toBe("archived");
  });
});

describe("scanProgress", () => {
  it("ignores finished batches", () => {
    const jobs = [job("succeeded", 100, "old"), job("failed", 10, "old"), job("running", 30, "new"), job("queued", 0, "new")];
    expect(scanProgress(jobs)).toBe(15);
  });
  it("is 0 when nothing is active", () => {
    expect(scanProgress([job("succeeded", 100)])).toBe(0);
  });
});

describe("caseDisplayTitle", () => {
  it("falls back to the identifiers", () => {
    expect(caseDisplayTitle({ title: "  ", identifiers: [{ type: "email", value: "a@example.com" }] })).toBe(
      "a@example.com",
    );
    expect(
      caseDisplayTitle({
        title: null,
        identifiers: [
          { type: "username", value: "ada" },
          { type: "domain", value: "example.com" },
        ],
      }),
    ).toBe("ada +1");
    expect(caseDisplayTitle({ title: null, identifiers: [] })).toBe("Untitled case");
  });
});

describe("selectCases", () => {
  const state = createFixtureState(Date.parse("2026-06-01T12:00:00Z"));
  const summaries: CaseSummary[] = state.cases.map((c) => ({
    case: c,
    jobs: state.jobs.filter((j) => j.case_id === c.id),
    pendingReviews: state.correlations.filter((x) => x.case_id === c.id && x.status === "pending").length,
    foundCount: state.findings.filter((f) => f.case_id === c.id && f.status === "found").length,
  }));
  const query = (qs: string) => parseCaseListQuery(new URLSearchParams(qs));

  it("hides archived cases by default and shows them on request", () => {
    expect(selectCases(summaries, query(""))).toHaveLength(4);
    expect(selectCases(summaries, query("archived=1"))).toHaveLength(5);
  });

  it("derives one of each status from the fixture cases", () => {
    const kinds = selectCases(summaries, query("archived=1")).map((r) => r.status.kind);
    expect(new Set(kinds)).toEqual(new Set(["scanning", "needs_review", "idle", "archived"]));
  });

  it("filters by text and tag, and sorts", () => {
    expect(selectCases(summaries, query("q=press")).map((r) => r.title)).toEqual(["press@example.net mailbox"]);
    expect(selectCases(summaries, query("tag=client-a"))).toHaveLength(2);
    expect(selectCases(summaries, query("sort=findings"))[0]?.title).toMatch(/Ada Fixture/);
    const titles = selectCases(summaries, query("sort=title")).map((r) => r.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  });

  it("falls back to the default sort for an unknown value", () => {
    expect(query("sort=nope").sort).toBe("updated");
  });
});
