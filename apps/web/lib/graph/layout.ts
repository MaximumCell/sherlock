/**
 * Deterministic radial tree layout. Seeds sit near the centre; everything they
 * lead to fans out in rings, each subtree owning an angular wedge sized by its
 * leaf count. Same input always gives the same positions (no simulation).
 */
import type { GraphEdge, GraphNode } from "./build";

export interface Point {
  x: number;
  y: number;
}

const RING_GAP = 230;
const ARC_PER_NODE = 78; // minimum arc length per node on a ring
const STAGGER = 64; // crowded rings alternate between two radii

export function layoutRadial(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  if (nodes.length === 0) return positions;

  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!order.has(a) || !order.has(b)) return;
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  };
  // structural edges first so the tree follows "found on", correlations only as a fallback
  for (const e of edges) if (e.kind !== "correlation") link(e.source, e.target);
  for (const e of edges) if (e.kind === "correlation") link(e.source, e.target);

  const seeds = nodes.filter((n) => n.kind === "seed");
  const roots = seeds.length > 0 ? seeds.map((n) => n.id) : [nodes[0]!.id];

  // breadth-first spanning forest
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>();
  const visit = (start: string[]) => {
    const queue = [...start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const next = (adjacency.get(id) ?? [])
        .filter((n) => !depth.has(n))
        .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
      for (const child of next) {
        if (depth.has(child)) continue;
        depth.set(child, (depth.get(id) ?? 0) + 1);
        children.set(id, [...(children.get(id) ?? []), child]);
        queue.push(child);
      }
    }
  };
  roots.forEach((r) => depth.set(r, 1));
  visit(roots);
  for (const n of nodes) {
    if (depth.has(n.id)) continue; // disconnected: becomes an extra root
    depth.set(n.id, 1);
    roots.push(n.id);
    visit([n.id]);
  }

  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? [];
    const total = kids.length === 0 ? 1 : kids.reduce((sum, k) => sum + countLeaves(k), 0);
    leaves.set(id, total);
    return total;
  };
  const totalLeaves = roots.reduce((sum, r) => sum + countLeaves(r), 0);

  // ring radius grows with how crowded the ring is
  const perDepth = new Map<number, number>();
  for (const d of depth.values()) perDepth.set(d, (perDepth.get(d) ?? 0) + 1);
  const maxDepth = Math.max(...perDepth.keys());
  const radius = new Map<number, number>();
  const crowded = new Map<number, boolean>();
  let previous = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const count = perDepth.get(d) ?? 0;
    const single = d === 1 && roots.length === 1;
    const needed = (count * ARC_PER_NODE) / (2 * Math.PI);
    const base = single ? 0 : Math.max(previous + RING_GAP, Math.min(needed, previous + RING_GAP * 2));
    crowded.set(d, needed > base);
    radius.set(d, base);
    previous = base + (needed > base ? STAGGER : 0);
  }

  const indexOnRing = new Map<number, number>();
  const place = (id: string, from: number, to: number) => {
    const d = depth.get(id) ?? 1;
    const i = indexOnRing.get(d) ?? 0;
    indexOnRing.set(d, i + 1);
    const r = (radius.get(d) ?? 0) + (crowded.get(d) && i % 2 === 1 ? STAGGER : 0);
    const angle = (from + to) / 2;
    positions.set(id, {
      x: Math.round(r * Math.cos(angle)),
      y: Math.round(r * Math.sin(angle)),
    });
    let cursor = from;
    for (const child of children.get(id) ?? []) {
      const span = ((to - from) * (leaves.get(child) ?? 1)) / (leaves.get(id) ?? 1);
      place(child, cursor, cursor + span);
      cursor += span;
    }
  };

  let cursor = -Math.PI / 2;
  for (const root of roots) {
    const span = (2 * Math.PI * (leaves.get(root) ?? 1)) / totalLeaves;
    place(root, cursor, cursor + span);
    cursor += span;
  }
  return positions;
}
