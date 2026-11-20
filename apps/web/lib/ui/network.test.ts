import { describe, expect, it } from "vitest";
import {
  createNetwork,
  networkEdges,
  nodeCountFor,
  parallaxOffset,
  seededRandom,
  stepNetwork,
} from "./network";

describe("hero network", () => {
  it("is deterministic for a seed", () => {
    const a = createNetwork(10, 800, 600, 3);
    const b = createNetwork(10, 800, 600, 3);
    expect(a).toEqual(b);
    expect(createNetwork(10, 800, 600, 4)).not.toEqual(a);
    const r = seededRandom(1);
    const v = r();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it("caps the node count, fewer on phones and low-power devices", () => {
    expect(nodeCountFor(1440, false)).toBe(60);
    expect(nodeCountFor(375, false)).toBeLessThan(30);
    expect(nodeCountFor(1440, true)).toBeLessThan(60);
  });

  it("keeps nodes inside the canvas and pulses now and then", () => {
    const nodes = createNetwork(30, 400, 300, 9);
    const rand = seededRandom(2);
    let pulsed = false;
    for (let i = 0; i < 600; i++) {
      stepNetwork(nodes, 0.05, 400, 300, rand);
      if (nodes.some((n) => n.pulse >= 0)) pulsed = true;
    }
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(400);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeLessThanOrEqual(300);
    }
    expect(pulsed).toBe(true);
  });

  it("pulls nodes together towards the search box on launch", () => {
    const nodes = createNetwork(20, 1000, 600, 5);
    const target = { x: 300, y: 300 };
    const dist = () =>
      nodes.reduce((s, n) => s + Math.hypot(n.x - target.x, n.y - target.y), 0) / nodes.length;
    const before = dist();
    const rand = seededRandom(1);
    for (let i = 0; i < 40; i++) stepNetwork(nodes, 0.033, 1000, 600, rand, target);
    expect(dist()).toBeLessThan(before / 2);
  });

  it("links only close nodes, strongest when closest", () => {
    const nodes = createNetwork(3, 10, 10, 1);
    nodes[0]!.x = 0;
    nodes[0]!.y = 0;
    nodes[1]!.x = 10;
    nodes[1]!.y = 0;
    nodes[2]!.x = 500;
    nodes[2]!.y = 500;
    const edges = networkEdges(nodes, 100);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ a: 0, b: 1 });
    expect(edges[0]!.alpha).toBeCloseTo(0.9);
  });

  it("moves near nodes more than far ones with the pointer", () => {
    const near = parallaxOffset(1, { x: 1, y: -1 });
    const far = parallaxOffset(0.4, { x: 1, y: -1 });
    expect(Math.abs(near.dx)).toBeGreaterThan(Math.abs(far.dx));
    expect(near.dy).toBeLessThan(0);
  });
});
