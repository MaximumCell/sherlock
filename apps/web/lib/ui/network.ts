/**
 * The start screen's living network, as pure functions: a seeded set of drifting nodes and
 * the edges that form between close ones. The canvas component only draws what this returns,
 * so the motion is deterministic and testable.
 */

export interface NetNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0.35..1: depth. Far nodes are smaller, dimmer and move less with the pointer. */
  z: number;
  /** Seconds until this node next pulses. */
  pulseIn: number;
  /** 0..1 while a pulse ring expands, otherwise -1. */
  pulse: number;
}

export interface NetEdge {
  a: number;
  b: number;
  /** 0..1 strength: 1 when the nodes touch, 0 at the link distance. */
  alpha: number;
}

/** Small, fast, seedable PRNG (mulberry32). */
export function seededRandom(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many nodes to draw: at most 60 on a wide screen, fewer on phones and low-power devices. */
export function nodeCountFor(width: number, lowPower: boolean): number {
  const base = width < 640 ? 22 : width < 1024 ? 38 : 60;
  return lowPower ? Math.round(base * 0.6) : base;
}

/**
 * Seeded nodes. `bias` (0..1) pulls them towards the right-hand side, where the hero leaves
 * room for the network next to the search box.
 */
export function createNetwork(
  count: number,
  width: number,
  height: number,
  seed = 7,
  bias = 0.35,
): NetNode[] {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const u = rand();
    const skew = Math.pow(u, 1 - bias);
    const speed = 6 + rand() * 10;
    const angle = rand() * Math.PI * 2;
    return {
      x: skew * width,
      y: rand() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      z: 0.35 + rand() * 0.65,
      pulseIn: 2 + rand() * 14,
      pulse: -1,
    };
  });
}

const PULSE_SECONDS = 1.4;

/**
 * Advances every node by `dt` seconds: drift, soft bounce at the edges, and the occasional
 * pulse. With `attract` set, nodes are pulled towards that point (the launch moment).
 */
export function stepNetwork(
  nodes: NetNode[],
  dt: number,
  width: number,
  height: number,
  rand: () => number,
  attract: { x: number; y: number } | null = null,
): void {
  const step = Math.min(dt, 0.1);
  for (const n of nodes) {
    if (attract) {
      n.vx += (attract.x - n.x) * 5 * step;
      n.vy += (attract.y - n.y) * 5 * step;
      n.vx *= 0.86;
      n.vy *= 0.86;
    }
    const pace = attract ? 1 : n.z;
    n.x += n.vx * step * pace;
    n.y += n.vy * step * pace;
    if (n.x < 0 || n.x > width) {
      n.vx = -n.vx;
      n.x = Math.min(width, Math.max(0, n.x));
    }
    if (n.y < 0 || n.y > height) {
      n.vy = -n.vy;
      n.y = Math.min(height, Math.max(0, n.y));
    }
    if (n.pulse >= 0) {
      n.pulse += step / PULSE_SECONDS;
      if (n.pulse >= 1) n.pulse = -1;
    } else {
      n.pulseIn -= step;
      if (n.pulseIn <= 0) {
        n.pulse = 0;
        n.pulseIn = 6 + rand() * 16;
      }
    }
  }
}

/** Edges between nodes closer than `linkDistance`, strongest when closest. */
export function networkEdges(nodes: readonly NetNode[], linkDistance: number): NetEdge[] {
  const edges: NetEdge[] = [];
  const max2 = linkDistance * linkDistance;
  for (let a = 0; a < nodes.length; a++) {
    const na = nodes[a]!;
    for (let b = a + 1; b < nodes.length; b++) {
      const nb = nodes[b]!;
      const dx = na.x - nb.x;
      const dy = na.y - nb.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < max2) edges.push({ a, b, alpha: 1 - Math.sqrt(d2) / linkDistance });
    }
  }
  return edges;
}

/** Pointer parallax for a node: far nodes move least. `pointer` is -1..1 on each axis. */
export function parallaxOffset(
  z: number,
  pointer: { x: number; y: number },
  strength = 18,
): { dx: number; dy: number } {
  return { dx: pointer.x * strength * z, dy: pointer.y * strength * z };
}
