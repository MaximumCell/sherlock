"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/style.css";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { focusNeighbourhood } from "@/lib/graph/focus";
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

/** Edge labels in plain words; on a crowded map the plain "found on" ones are left out. */
const MAX_LABELLED_EDGES = 60;

export function toFlow(model: GraphModel): { nodes: EntityFlowNode[]; edges: Edge[] } {
  const positions = layoutRadial(model.nodes, model.edges);
  const crowded = model.edges.length > MAX_LABELLED_EDGES;
  return {
    nodes: model.nodes.map((node) => ({
      id: node.id,
      type: "entity" as const,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { node },
      ariaLabel: `${node.kind}: ${node.label}. Press Enter for details.`,
    })),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "straight",
      label:
        crowded && edge.kind === "found_on" && edge.label === "found on"
          ? undefined
          : (edge.label ?? undefined),
      className: edgeClass(edge),
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 3,
      focusable: false,
    })),
  };
}

/**
 * The React Flow canvas. Hovering or selecting a node puts the map in focus mode: everything
 * outside that node's neighbourhood steps back. Click or Enter opens the details. The parent
 * remounts it (via `key`) when the model changes, so layout runs once per data change.
 */
export function GraphCanvas({
  model,
  onNodeClick,
}: {
  model: GraphModel;
  onNodeClick: (node: GraphNode) => void;
}) {
  const flow = useMemo(() => toFlow(model), [model]);
  const [nodes, setNodes, onNodesChange] = useNodesState<EntityFlowNode>(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(flow.edges);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const focusId = hovered ?? selected;

  useEffect(() => {
    const focus = focusNeighbourhood(flow.edges, focusId);
    const base = new Map(flow.edges.map((e) => [e.id, e.className ?? ""]));
    setNodes((nds) =>
      nds.map((n) => ({ ...n, className: focus && !focus.nodes.has(n.id) ? "is-dimmed" : "" })),
    );
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        className: `${base.get(e.id) ?? ""}${focus ? (focus.edges.has(e.id) ? " is-lit" : " is-dimmed") : ""}`,
      })),
    );
  }, [focusId, flow.edges, setNodes, setEdges]);

  const open = (id: string) => {
    const node = model.nodes.find((n) => n.id === id);
    if (node) onNodeClick(node);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const id = (document.activeElement as HTMLElement | null)?.dataset.id;
    if (!id) return;
    event.preventDefault();
    setSelected(id);
    open(id);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      nodeOrigin={[0.5, 0.5]}
      onNodeClick={(_event, node) => {
        setSelected(node.id);
        onNodeClick(node.data.node);
      }}
      onNodeMouseEnter={(_e, node) => setHovered(node.id)}
      onNodeMouseLeave={() => setHovered(null)}
      onPaneClick={() => setSelected(null)}
      onKeyDown={onKeyDown}
      fitView
      fitViewOptions={{ padding: 0.06, minZoom: 0.5, maxZoom: 1.1, duration: 400 }}
      minZoom={0.08}
      maxZoom={2}
      nodesConnectable={false}
      edgesFocusable={false}
      onlyRenderVisibleElements={model.nodes.length > 120}
      proOptions={{ hideAttribution: false }}
      aria-label="Connections map. Tab to a node, Enter for its details."
    >
      <Background
        variant={BackgroundVariant.Dots}
        gap={24}
        size={1}
        color="hsl(var(--muted-foreground) / 0.25)"
      />
      <Controls showInteractive={false} fitViewOptions={{ padding: 0.08, duration: 400 }} />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={0}
        nodeBorderRadius={20}
        nodeColor={(node) => MINIMAP_COLOR[(node as EntityFlowNode).data.node.kind]}
        className="!hidden overflow-hidden rounded-lg border border-border sm:!block"
        aria-label="Map overview"
      />
    </ReactFlow>
  );
}
