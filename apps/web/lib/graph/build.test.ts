import { describe, expect, it } from "vitest";
import { DEMO_CASE_ID, HANDLE, fid } from "../data/fixtures/demo-case";
import { createFixtureState } from "../data/fixtures/state";
import type { Correlation, Finding } from "../types";
import { buildGraph, findingNodeId, identifierNodeId, type GraphInput } from "./build";
import { layoutRadial } from "./layout";

const state = createFixtureState(Date.parse("2026-06-01T12:00:00Z"));
const demo: GraphInput = {
  case: state.cases.find((c) => c.id === DEMO_CASE_ID)!,
  findings: state.findings.filter((f) => f.case_id === DEMO_CASE_ID),
  correlations: state.correlations.filter((c) => c.case_id === DEMO_CASE_ID),
  entities: state.entities.filter((e) => e.case_id === DEMO_CASE_ID),
};

function account(i: number, over: Partial<Finding> = {}): Finding {
  return {
    id: `acc-${i}`,
    case_id: "c",
    identifier_type: "username",
    identifier_value: "ada",
    source_tool: "user_scanner",
    module: "user_scanner",
    platform: `Platform ${i}`,
    status: "found",
    finding_key: `k${i}`,
    extra_metadata: { url: null, extra: {}, category: ["social", "gaming", "music"][i % 3]! },
    curated: false,
    job_id: null,
    collected_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("buildGraph on the demo case", () => {
  const model = buildGraph(demo);
  const ids = new Set(model.nodes.map((n) => n.id));

  it("creates one seed node per case identifier", () => {
    const seeds = model.nodes.filter((n) => n.kind === "seed");
    expect(seeds.map((n) => n.label).sort()).toEqual(
      demo.case.identifiers.map((i) => i.value).sort(),
    );
  });

  it("never draws not_found or error findings", () => {
    for (const f of demo.findings.filter((x) => x.status !== "found")) {
      expect(ids.has(findingNodeId(f.id))).toBe(false);
    }
  });

  it("uses node kinds for breaches, infrastructure and discovered emails", () => {
    expect(model.nodes.filter((n) => n.kind === "breach")).toHaveLength(3);
    expect(model.nodes.some((n) => n.kind === "infra" && n.label === "dns")).toBe(true);
    expect(model.nodes.some((n) => n.kind === "email" && n.label === "ada@fixture-labs.example")).toBe(true);
  });

  it("links findings to their identifier with found_on edges", () => {
    const edge = model.edges.find(
      (e) => e.source === identifierNodeId("username", HANDLE) && e.target === findingNodeId(fid(1)),
    );
    expect(edge?.kind).toBe("found_on");
  });

  it("hides rejected correlations by default and labels the rest with rule and confidence", () => {
    const corr = model.edges.filter((e) => e.kind === "correlation");
    expect(corr.every((e) => e.status !== "rejected")).toBe(true);
    expect(corr.some((e) => e.label === "shared email 95%" && e.status === "approved")).toBe(true);
    const withRejected = buildGraph(demo, { showRejected: true });
    expect(withRejected.edges.some((e) => e.status === "rejected")).toBe(true);
  });

  it("applies the minimum confidence filter", () => {
    const strict = buildGraph(demo, { minConfidence: 0.9 });
    const corr = strict.edges.filter((e) => e.kind === "correlation");
    expect(corr.length).toBeGreaterThan(0);
    expect(corr.every((e) => (e.confidence ?? 0) >= 0.9)).toBe(true);
  });

  it("filters by kind but always keeps seeds, and drops dangling edges", () => {
    const filtered = buildGraph(demo, { kinds: new Set(["breach"]) });
    expect(new Set(filtered.nodes.map((n) => n.kind))).toEqual(new Set(["seed", "breach"]));
    const visible = new Set(filtered.nodes.map((n) => n.id));
    expect(filtered.edges.every((e) => visible.has(e.source) && visible.has(e.target))).toBe(true);
  });

  it("clusters low-value accounts but keeps curated and correlated ones", () => {
    expect(model.clustered).toBeGreaterThan(0);
    expect(ids.has(findingNodeId(fid(1)))).toBe(true); // GitHub: curated and correlated
    const cluster = model.nodes.find((n) => n.kind === "cluster");
    expect(cluster?.label).toMatch(/^\+\d+ more on /);
    expect(cluster?.memberIds.length).toBeGreaterThanOrEqual(2);
  });
});

describe("clustering at scale", () => {
  const findings = Array.from({ length: 300 }, (_, i) => account(i));
  const correlation: Correlation = {
    id: "x1",
    case_id: "c",
    type: "shared_email",
    corr_key: "k",
    matched_value: null,
    entities_involved: ["acc-0", "acc-1"],
    confidence: 0.9,
    evidence: [],
    priority: 1,
    status: "pending",
    reviewed: false,
    review_note: null,
    reviewed_at: null,
    created_at: "2026-01-01T00:00:00Z",
  };
  const input: GraphInput = {
    case: { identifiers: [{ type: "username", value: "ada" }] },
    findings: [...findings.slice(0, 299), account(299, { curated: true })],
    correlations: [correlation],
    entities: [],
  };

  it("collapses 300 accounts into a handful of nodes", () => {
    const model = buildGraph(input);
    // seed + 2 correlated + 1 curated + 3 category clusters
    expect(model.nodes).toHaveLength(7);
    expect(model.clustered).toBe(297);
    const total = model.nodes
      .filter((n) => n.kind === "cluster")
      .reduce((sum, n) => sum + n.memberIds.length, 0);
    expect(total).toBe(297);
  });

  it("does not cluster below the threshold", () => {
    const small = buildGraph({ ...input, findings: findings.slice(0, 10), correlations: [] });
    expect(small.clustered).toBe(0);
    expect(small.nodes).toHaveLength(11);
  });

  it("lays out 300 unclustered nodes deterministically without stacking them", () => {
    const model = buildGraph(input, { maxAccountsPerIdentifier: 1000 });
    expect(model.nodes).toHaveLength(301);
    const a = layoutRadial(model.nodes, model.edges);
    const b = layoutRadial(model.nodes, model.edges);
    expect([...a.entries()]).toEqual([...b.entries()]);
    expect(a.size).toBe(301);
    expect(new Set([...a.values()].map((p) => `${p.x},${p.y}`)).size).toBe(301);
  });
});

describe("layoutRadial", () => {
  it("returns nothing for an empty graph and centres a single seed", () => {
    expect(layoutRadial([], []).size).toBe(0);
    const model = buildGraph({
      case: { identifiers: [{ type: "username", value: "ada" }] },
      findings: [account(1)],
      correlations: [],
      entities: [],
    });
    const positions = layoutRadial(model.nodes, model.edges);
    expect(positions.get(identifierNodeId("username", "ada"))).toEqual({ x: 0, y: 0 });
  });

  it("positions every node of the demo graph", () => {
    const model = buildGraph(demo);
    const positions = layoutRadial(model.nodes, model.edges);
    expect(positions.size).toBe(model.nodes.length);
    for (const p of positions.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});
