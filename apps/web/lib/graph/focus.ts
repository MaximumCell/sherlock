/**
 * Focus mode for the connections map: which nodes and edges stay lit around a picked node.
 * Pure, so the selection is tested apart from React Flow.
 */

export interface EdgeLike {
  id: string;
  source: string;
  target: string;
}

export interface FocusSet {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * The neighbourhood of `nodeId`: the node, every node one edge away and the edges between
 * them. With `depth` 2, neighbours of neighbours are lit too (edges only along the way).
 * Null when nothing is focused.
 */
export function focusNeighbourhood(
  edges: readonly EdgeLike[],
  nodeId: string | null,
  depth: 1 | 2 = 1,
): FocusSet | null {
  if (!nodeId) return null;
  const nodes = new Set([nodeId]);
  const lit = new Set<string>();
  let frontier = new Set([nodeId]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const e of edges) {
      const fromSource = frontier.has(e.source);
      const fromTarget = frontier.has(e.target);
      if (!fromSource && !fromTarget) continue;
      lit.add(e.id);
      const other = fromSource ? e.target : e.source;
      if (!nodes.has(other)) next.add(other);
      nodes.add(other);
    }
    frontier = next;
  }
  return { nodes, edges: lit };
}

/** Whether a node or edge is dimmed under the current focus. */
export function isDimmed(focus: FocusSet | null, kind: "node" | "edge", id: string): boolean {
  if (!focus) return false;
  return kind === "node" ? !focus.nodes.has(id) : !focus.edges.has(id);
}
