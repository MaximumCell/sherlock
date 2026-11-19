import { describe, expect, it } from "vitest";
import {
  toAuditEntry,
  toCandidate,
  toCase,
  toCorrelation,
  toEntity,
  toExposure,
  toFinding,
  toJob,
  toList,
  toModuleInfo,
} from "./mappers";

describe("toCase", () => {
  it("fills defaults for a legacy v1 row", () => {
    const c = toCase({
      id: "c1",
      identifiers: [{ type: "username", value: " ada " }, { type: "bogus", value: "x" }, null],
      status: "open",
      created_at: "2026-01-01T00:00:00Z",
      tags: null,
    });
    expect(c).toMatchObject({
      id: "c1",
      title: null,
      notes: "",
      tags: [],
      owner_id: null,
      is_demo: false,
      archived_at: null,
    });
    expect(c.identifiers).toEqual([
      { type: "username", value: "ada" },
      { type: "username", value: "x" },
    ]);
  });

  it("never throws on junk", () => {
    expect(toCase(null).id).toBe("");
    expect(toCase("nope").identifiers).toEqual([]);
  });
});

describe("toFinding", () => {
  it("normalises metadata and falls back to source_tool for module", () => {
    const f = toFinding({
      id: "f1",
      case_id: "c1",
      identifier_type: "username",
      identifier_value: "ada",
      source_tool: "user_scanner",
      platform: "GitHub",
      status: "found",
      finding_key: "k",
      extra_metadata: { url: "https://x.example", extra: "not-an-object", category: "dev" },
      collected_at: "2026-01-01T00:00:00Z",
    });
    expect(f.module).toBe("user_scanner");
    expect(f.extra_metadata.extra).toEqual({});
    expect(f.extra_metadata.category).toBe("dev");
    expect(f.curated).toBe(false);
    expect(f.job_id).toBeNull();
  });

  it("reads the v1 curated flag from the metadata blob", () => {
    expect(toFinding({ extra_metadata: { curated: true } }).curated).toBe(true);
    expect(toFinding({ curated: true }).curated).toBe(true);
  });

  it("treats an unknown status as an error row", () => {
    expect(toFinding({ status: "weird" }).status).toBe("error");
  });
});

describe("toCorrelation", () => {
  it("normalises evidence items and clamps confidence", () => {
    const c = toCorrelation({
      id: "x",
      type: "shared_email",
      entities_involved: ["a", 3, "b"],
      confidence: 1.4,
      evidence: ["plain", "  ", { finding_id: "a", field: "email", value: "e@example.com" }, { odd: 1 }],
      status: "approved",
    });
    expect(c.entities_involved).toEqual(["a", "b"]);
    expect(c.confidence).toBe(1);
    expect(c.evidence).toEqual([
      "plain",
      { finding_id: "a", field: "email", value: "e@example.com" },
      '{"odd":1}',
    ]);
    expect(c.reviewed).toBe(true);
  });

  it("derives status from the v1 reviewed boolean", () => {
    expect(toCorrelation({ reviewed: true }).status).toBe("approved");
    expect(toCorrelation({}).status).toBe("pending");
    expect(toCorrelation({ status: "rejected", reviewed: true }).reviewed).toBe(false);
  });
});

describe("toJob", () => {
  it("clamps progress and defaults the queue", () => {
    const j = toJob({ id: "j", progress: 140, queue: "nope", status: "running", result: { found: 2 } });
    expect(j.progress).toBe(100);
    expect(j.queue).toBe("identity");
    expect(j.max_attempts).toBe(3);
    expect(j.result).toEqual({ found: 2 });
  });
});

describe("other mappers", () => {
  it("maps entities, audit entries and modules", () => {
    expect(toEntity({ id: "e", kind: "email", value: "a@example.com", scanned: "true" })).toMatchObject({
      scanned: true,
      is_seed: false,
      platform: null,
    });
    expect(toAuditEntry({ id: "7", action: "review", detail: null })).toMatchObject({ id: 7, detail: {} });
    expect(toModuleInfo({ name: "crtsh", inputs: ["domain"], queue: "infra" })).toMatchObject({
      title: "crtsh",
      available: true,
      requires_env: [],
      source_url: null,
    });
    expect(toModuleInfo({ name: "x", available: false }).available).toBe(false);
  });

  it("toList tolerates non-arrays", () => {
    expect(toList(null, toJob)).toEqual([]);
    expect(toList([{ id: "a" }], toJob)).toHaveLength(1);
  });
});

describe("toExposure", () => {
  it("clamps the score, derives a missing band and sorts factors", () => {
    const e = toExposure({
      score: 71.6,
      factors: [
        { key: "a", label: "A", points: 2, max_points: 10, detail: "d", remediation: ["x"] },
        { key: "b", label: "B", points: 9.5, max_points: 30, evidence_finding_ids: ["f1"] },
      ],
      computed_from: { findings: 4, approved_correlations: 1 },
      method: "m",
    });
    expect(e.score).toBe(72);
    expect(e.band).toBe("severe");
    expect(e.factors.map((f) => f.key)).toEqual(["b", "a"]);
    expect(e.factors[0]?.evidence_finding_ids).toEqual(["f1"]);
    expect(e.factors[1]?.remediation).toEqual(["x"]);
    expect(e.computed_from).toEqual({ findings: 4, approved_correlations: 1 });
  });

  it("keeps a valid band and survives junk", () => {
    expect(toExposure({ score: 10, band: "high" }).band).toBe("high");
    expect(toExposure(null)).toMatchObject({ score: 0, band: "low", factors: [] });
  });
});

describe("toCandidate", () => {
  it("tolerates missing attributes and string handles", () => {
    const c = toCandidate({
      candidate_id: "k1",
      label: "M. Quince",
      score: 1.4,
      evidence: "same city",
      attributes: { handles: ["mquince", { platform: "GitHub", handle: "mq" }, 3] },
    });
    expect(c).toMatchObject({ candidate_id: "k1", score: 1, evidence: ["same city"], finding_ids: [] });
    expect(c?.attributes.handles).toEqual([
      { platform: null, handle: "mquince", url: null },
      { platform: "GitHub", handle: "mq", url: null },
    ]);
    expect(c?.attributes.employers).toEqual([]);
    expect(toCandidate({ label: "no id" })).toBeNull();
  });
});
