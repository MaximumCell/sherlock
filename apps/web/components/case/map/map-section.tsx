"use client";

import { ChevronDown, SlidersHorizontal, Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { buildGraph, GRAPH_KINDS, type GraphNode, type GraphNodeKind } from "@/lib/graph/build";
import type { Case, Correlation, Entity, Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { GraphCanvas } from "./graph-canvas";
import { GraphFilters, GraphLegend } from "./graph-filters";
import { NodeSheet } from "./node-sheet";

export interface GraphFilterState {
  kinds: GraphNodeKind[];
  minConfidence: number;
  showRejected: boolean;
}

/** The connections map: React Flow canvas, a legend, and every filter behind "Filters". */
export function MapView({
  c,
  findings,
  correlations,
  entities,
}: {
  c: Case;
  findings: Finding[];
  correlations: Correlation[];
  entities: Entity[];
}) {
  const { set } = useUrlState();
  const [filters, setFilters] = useState<GraphFilterState>({
    kinds: [...GRAPH_KINDS],
    minConfidence: 0,
    showRejected: false,
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [picked, setPicked] = useState<GraphNode | null>(null);

  const model = useMemo(
    () =>
      buildGraph(
        { case: c, findings, correlations, entities },
        {
          kinds: new Set(filters.kinds),
          minConfidence: filters.minConfidence,
          showRejected: filters.showRejected,
        },
      ),
    [c, findings, correlations, entities, filters],
  );
  // remount the canvas only when the set of nodes or edges actually changes
  const signature = useMemo(
    () => `${model.nodes.map((n) => n.id).join("|")}#${model.edges.map((e) => e.id).join("|")}`,
    [model],
  );

  const onNodeClick = (node: GraphNode) => {
    if (node.findingId) set({ finding: node.findingId });
    else setPicked(node);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GraphLegend model={model} showRejected={filters.showRejected} />
        <Button
          variant={filtersOpen ? "secondary" : "outline"}
          size="sm"
          aria-expanded={filtersOpen}
          aria-controls="map-filters"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <SlidersHorizontal aria-hidden />
          Filters
          <ChevronDown
            className={cn("transition-transform", filtersOpen && "rotate-180")}
            aria-hidden
          />
        </Button>
      </div>
      {filtersOpen ? (
        <div
          id="map-filters"
          className="animate-fade-in rounded-xl border border-border bg-surface/60 p-3"
        >
          <GraphFilters filters={filters} onChange={setFilters} />
        </div>
      ) : null}
      {model.nodes.length === 0 ? (
        <EmptyState icon={Waypoints} title="Nothing to draw yet">
          The map fills in as searches find accounts and links connect them.
        </EmptyState>
      ) : (
        <div className="h-[65dvh] min-h-[420px] overflow-hidden rounded-2xl border border-border bg-surface">
          <GraphCanvas key={signature} model={model} onNodeClick={onNodeClick} />
        </div>
      )}
      <NodeSheet
        node={picked}
        model={model}
        findings={findings}
        onClose={() => setPicked(null)}
        onOpenFinding={(id) => {
          setPicked(null);
          set({ finding: id });
        }}
      />
    </div>
  );
}
