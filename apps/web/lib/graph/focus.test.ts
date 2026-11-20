import { describe, expect, it } from "vitest";
import { focusNeighbourhood, isDimmed } from "./focus";

const edges = [
  { id: "ab", source: "a", target: "b" },
  { id: "bc", source: "b", target: "c" },
  { id: "cd", source: "c", target: "d" },
  { id: "ea", source: "e", target: "a" },
];

describe("map focus mode", () => {
  it("lights nothing special without a focus", () => {
    expect(focusNeighbourhood(edges, null)).toBeNull();
    expect(isDimmed(null, "node", "a")).toBe(false);
  });

  it("keeps the node, its direct neighbours and the edges between them", () => {
    const f = focusNeighbourhood(edges, "b")!;
    expect([...f.nodes].sort()).toEqual(["a", "b", "c"]);
    expect([...f.edges].sort()).toEqual(["ab", "bc"]);
    expect(isDimmed(f, "node", "d")).toBe(true);
    expect(isDimmed(f, "edge", "cd")).toBe(true);
    expect(isDimmed(f, "edge", "ab")).toBe(false);
  });

  it("follows edges in both directions", () => {
    const f = focusNeighbourhood(edges, "a")!;
    expect([...f.nodes].sort()).toEqual(["a", "b", "e"]);
  });

  it("reaches two steps out on request", () => {
    const f = focusNeighbourhood(edges, "a", 2)!;
    expect([...f.nodes].sort()).toEqual(["a", "b", "c", "e"]);
    expect(f.edges.has("bc")).toBe(true);
    expect(f.edges.has("cd")).toBe(false);
  });

  it("copes with a node that has no edges", () => {
    const f = focusNeighbourhood(edges, "z")!;
    expect([...f.nodes]).toEqual(["z"]);
    expect(f.edges.size).toBe(0);
  });
});
