"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/style.css";
import { useMemo } from "react";
import type { GraphEdge, GraphModel, GraphNode, GraphNodeKind } from "@/lib/graph/build";
import { layoutRadial } from "@/lib/graph/layout";
import { EntityNode, type EntityFlowNode } from "./entity-node";

const nodeTypes = { entity: EntityNode };

const MINIMAP_COLOR: Record<GraphNodeKind, string> = {
  seed: "hsl(var(--accent))",
  account: "hsl(var(--muted-foreground) / 0.6)",
  email: "hsl(var(--success))",
  infra: "hsl(var(--warning))",
  breach: "hsl(var(--danger))",
  handle: "hsl(var(--muted-foreground))",
  cluster: "hsl(var(--border))",
};

function edgeClass(edge: GraphEdge): string {
  if (edge.kind === "correlation") return `edge-correlation edge-${edge.status ?? "pending"}`;
  return edge.kind === "mentions" ? "edge-mentions" : "edge-found";
}

export function toFlow(model: GraphModel): { nodes: EntityFlowNode[]; edges: Edge[] } {
  const positions = layoutRadial(model.nodes, model.edges);
  return {
    nodes: model.nodes.map((node) => ({
      id: node.id,
      type: "entity" as const,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node },
      ariaLabel: `${node.kind}: ${node.label}`,
    })),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "straight",
      label: edge.kind === "correlation" ? (edge.label ?? undefined) : undefined,
      className: edgeClass(edge),
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      focusable: false,
    })),
  };
}

/**
 * Uncontrolled React Flow instance. The parent remounts it (via `key`) when the
 * model changes, so layout is recomputed once per data change, not per render.
 */
export function GraphCanvas({
  model,
  onNodeClick,
}: {
  model: GraphModel;
  onNodeClick: (node: GraphNode) => void;
}) {
  const flow = useMemo(() => toFlow(model), [model]);
  return (
    <ReactFlow
      defaultNodes={flow.nodes}
      defaultEdges={flow.edges}
      nodeTypes={nodeTypes}
      nodeOrigin={[0.5, 0.5]}
      onNodeClick={(_event, node) => onNodeClick(node.data.node)}
      fitView
      fitViewOptions={{ padding: 0.06, minZoom: 0.3, maxZoom: 1.1 }}
      minZoom={0.08}
      maxZoom={2}
      nodesConnectable={false}
      edgesFocusable={false}
      onlyRenderVisibleElements={model.nodes.length > 120}
      proOptions={{ hideAttribution: false }}
      aria-label="Entity graph"
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={0}
        nodeBorderRadius={6}
        nodeColor={(node) => MINIMAP_COLOR[(node as EntityFlowNode).data.node.kind]}
        className="!hidden overflow-hidden rounded-md border border-border sm:!block"
        aria-label="Graph minimap"
      />
    </ReactFlow>
  );
}
