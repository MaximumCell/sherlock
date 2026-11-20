"use client";

import { ChevronDown, Maximize2, Minimize2, SlidersHorizontal, Waypoints } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  // a large in-page view (not the browser fullscreen API); Esc or the button closes it
  const [expanded, setExpanded] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!expanded) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector('[role="dialog"][data-state="open"]'))
        setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [expanded]);

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
        <div className="flex gap-2">
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
              className={cn("transition-transform duration-2", filtersOpen && "rotate-180")}
              aria-hidden
            />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setExpanded(true)}>
            <Maximize2 aria-hidden />
            Expand
          </Button>
        </div>
      </div>
      {filtersOpen ? (
        <div
          id="map-filters"
          className="animate-fade-in rounded-lg border border-border bg-surface/60 p-3"
        >
          <GraphFilters filters={filters} onChange={setFilters} />
        </div>
      ) : null}
      {model.nodes.length === 0 ? (
        <EmptyState icon={Waypoints} title="Nothing to draw yet">
          The map fills in as searches find accounts and links connect them.
        </EmptyState>
      ) : (
        <div
          role={expanded ? "dialog" : undefined}
          aria-modal={expanded || undefined}
          aria-label={expanded ? "Connections map, large view" : undefined}
          className={cn(
            "overflow-hidden border border-border bg-[radial-gradient(ellipse_at_center,hsl(var(--surface)),hsl(var(--background)))]",
            expanded
              ? "fixed inset-2 z-50 rounded-xl shadow-lift sm:inset-4"
              : "relative h-[65dvh] min-h-[420px] rounded-xl",
          )}
        >
          {expanded ? (
            <div className="glass absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-border px-4 py-2">
              <p className="min-w-0 truncate text-sm">
                <span className="font-display text-lg">Connections map</span>
                <span className="ml-3 hidden text-muted-foreground sm:inline">
                  Hover a node to focus its connections. Esc to close.
                </span>
              </p>
              <Button ref={closeRef} variant="outline" size="sm" onClick={() => setExpanded(false)}>
                <Minimize2 aria-hidden />
                Close large view
              </Button>
            </div>
          ) : null}
          <div className={cn("h-full", expanded && "pt-12")}>
            <GraphCanvas key={`${signature}:${expanded}`} model={model} onNodeClick={onNodeClick} />
          </div>
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
