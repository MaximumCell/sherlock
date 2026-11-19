/**
 * Deterministic hub-and-spoke layout. Every seed is the centre of its own
 * cluster with what it leads to on a ring around it; deeper nodes fan outwards
 * from their parent. The biggest cluster sits in the middle, the rest circle it.
 * Same input always gives the same positions (no physics simulation).
 */
import type { GraphEdge, GraphNode } from "./build";

export interface Point {
  x: number;
  y: number;
}

const LEAF_RADIUS = 42; // half the arc a leaf node needs on a ring
const MIN_ROOT_RING = 150;
const MIN_CHILD_RING = 110;
const FAN = (Math.PI * 4) / 3; // non-root nodes spread their children over 240 degrees
const STAGGER = 46; // crowded rings alternate between two radii so wide labels do not collide
const STAGGER_FROM = 7;
const CLUSTER_GAP = 40;
const X_STRETCH = 1.45; // labels are wide, so rings are ellipses

interface Tree {
  roots: string[];
  children: Map<string, string[]>;
}

/** Breadth-first spanning forest: structural edges first, correlations only as a fallback. */
function spanningForest(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): Tree {
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const adjacency = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (!order.has(a) || !order.has(b) || a === b) return;
    adjacency.set(a, [...(adjacency.get(a) ?? []), b]);
    adjacency.set(b, [...(adjacency.get(b) ?? []), a]);
  };
  for (const e of edges) if (e.kind !== "correlation") link(e.source, e.target);
  for (const e of edges) if (e.kind === "correlation") link(e.source, e.target);

  const seen = new Set<string>();
  const children = new Map<string, string[]>();
  const grow = (start: string[]) => {
    const queue = [...start];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of adjacency.get(id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        children.set(id, [...(children.get(id) ?? []), next]);
        queue.push(next);
      }
    }
  };

  // every identifier that findings hang off is the centre of its own cluster
  const hubs = new Set(edges.filter((e) => e.kind === "found_on").map((e) => e.source));
  const roots = nodes.filter((n) => n.kind === "seed" || hubs.has(n.id)).map((n) => n.id);
  roots.forEach((r) => seen.add(r));
  grow(roots);
  for (const n of nodes) {
    if (seen.has(n.id)) continue; // unreachable from any seed: its own small cluster
    seen.add(n.id);
    roots.push(n.id);
    grow([n.id]);
  }
  return { roots, children };
}

export function layoutRadial(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): Map<string, Point> {
  const positions = new Map<string, Point>();
  if (nodes.length === 0) return positions;
  const { roots, children } = spanningForest(nodes, edges);
  const rootSet = new Set(roots);
  const kidsOf = (id: string) => children.get(id) ?? [];

  // radius of the circle that encloses each subtree, and the ring its children sit on
  const extent = new Map<string, number>();
  const ring = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = kidsOf(id);
    if (kids.length === 0) {
      extent.set(id, LEAF_RADIUS);
      return LEAF_RADIUS;
    }
    const radii = kids.map(measure);
    const isRoot = rootSet.has(id);
    const needed = radii.reduce((sum, r) => sum + 2 * r, 0) / (isRoot ? 2 * Math.PI : FAN);
    const ringRadius = Math.max(isRoot ? MIN_ROOT_RING : MIN_CHILD_RING, needed);
    const stagger = kids.length >= STAGGER_FROM ? STAGGER : 0;
    const total = ringRadius + stagger + Math.max(...radii);
    ring.set(id, ringRadius);
    extent.set(id, total);
    return total;
  };
  roots.forEach(measure);

  const place = (id: string, x: number, y: number, outward: number | null) => {
    positions.set(id, { x: Math.round(x), y: Math.round(y) });
    const kids = kidsOf(id);
    if (kids.length === 0) return;
    const arc = outward === null ? 2 * Math.PI : FAN;
    const total = kids.reduce((sum, k) => sum + (extent.get(k) ?? LEAF_RADIUS), 0);
    const base = ring.get(id) ?? MIN_CHILD_RING;
    let cursor = outward === null ? -Math.PI / 2 : outward - FAN / 2;
    kids.forEach((kid, i) => {
      const span = (arc * (extent.get(kid) ?? LEAF_RADIUS)) / total;
      const angle = cursor + span / 2;
      const r = base + (kids.length >= STAGGER_FROM && i % 2 === 1 ? STAGGER : 0);
      place(kid, x + r * Math.cos(angle) * X_STRETCH, y + r * Math.sin(angle), angle);
      cursor += span;
    });
  };

  if (roots.length === 1) {
    place(roots[0]!, 0, 0, null);
    return positions;
  }

  // biggest cluster in the centre, the others on a circle around it,
  // each given an angle share proportional to its size
  const bySize = [...roots].sort(
    (a, b) => (extent.get(b) ?? 0) - (extent.get(a) ?? 0) || roots.indexOf(a) - roots.indexOf(b),
  );
  const [centre, ...outer] = bySize;
  place(centre!, 0, 0, null);
  const centreSize = extent.get(centre!) ?? LEAF_RADIUS;
  const sizes = outer.map((r) => (extent.get(r) ?? LEAF_RADIUS) + CLUSTER_GAP / 2);
  const sum = sizes.reduce((a, b) => a + b, 0);
  const angles: number[] = [];
  let cursor = Math.PI / 2;
  for (const size of sizes) {
    const span = (2 * Math.PI * size) / sum;
    angles.push(cursor + span / 2);
    cursor += span;
  }
  // far enough out that neighbours on the circle cannot touch, then as close as each one fits
  const shared = outer.length > 1 ? sum / Math.PI : 0;
  outer.forEach((root, i) => {
    const angle = angles[i] ?? 0;
    const distance = Math.max(centreSize + (sizes[i] ?? 0) + CLUSTER_GAP / 2, shared);
    place(root, distance * Math.cos(angle) * X_STRETCH, distance * Math.sin(angle), null);
  });
  return positions;
}
