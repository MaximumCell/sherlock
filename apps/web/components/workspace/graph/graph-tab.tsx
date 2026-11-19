"use client";

import { Waypoints } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { buildGraph, GRAPH_KINDS, type GraphNode, type GraphNodeKind } from "@/lib/graph/build";
import { useCase, useCorrelations, useEntities, useFindings } from "@/lib/query/hooks";
import { useUrlState } from "@/lib/use-url-state";
import { GraphCanvas } from "./graph-canvas";
import { GraphFilters } from "./graph-filters";
import { NodeSheet } from "./node-sheet";

export interface GraphFilterState {
  kinds: GraphNodeKind[];
  minConfidence: number;
  showRejected: boolean;
}

export function GraphTab({ caseId }: { caseId: string }) {
  const { set } = useUrlState();
  const c = useCase(caseId);
  const findings = useFindings(caseId);
  const correlations = useCorrelations(caseId);
  const entities = useEntities(caseId);
  const [filters, setFilters] = useState<GraphFilterState>({
    kinds: [...GRAPH_KINDS],
    minConfidence: 0,
    showRejected: false,
  });
  const [picked, setPicked] = useState<GraphNode | null>(null);

  const model = useMemo(
    () =>
      buildGraph(
        {
          case: c.data ?? { identifiers: [] },
          findings: findings.data ?? [],
          correlations: correlations.data ?? [],
          entities: entities.data ?? [],
        },
        {
          kinds: new Set(filters.kinds),
          minConfidence: filters.minConfidence,
          showRejected: filters.showRejected,
        },
      ),
    [c.data, findings.data, correlations.data, entities.data, filters],
  );
  // remount the canvas only when the set of nodes or edges actually changes
  const signature = useMemo(
    () => `${model.nodes.map((n) => n.id).join("|")}#${model.edges.map((e) => e.id).join("|")}`,
    [model],
  );

  if (findings.isError) {
    return <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />;
  }
  if (findings.isPending || correlations.isPending || entities.isPending) {
    return <Skeleton className="h-[60dvh] w-full" />;
  }

  const onNodeClick = (node: GraphNode) => {
    if (node.findingId) set({ finding: node.findingId });
    else setPicked(node);
  };

  return (
    <div className="space-y-3">
      <GraphFilters filters={filters} onChange={setFilters} model={model} />
      {model.nodes.length === 0 ? (
        <EmptyState icon={Waypoints} title="Nothing to draw yet">
          The graph fills in as scans find accounts and the correlation engine links them.
        </EmptyState>
      ) : (
        <div className="h-[70dvh] min-h-[420px] overflow-hidden rounded-lg border border-border bg-surface">
          <GraphCanvas key={signature} model={model} onNodeClick={onNodeClick} />
        </div>
      )}
      <NodeSheet
        node={picked}
        model={model}
        findings={findings.data ?? []}
        onClose={() => setPicked(null)}
        onOpenFinding={(id) => {
          setPicked(null);
          set({ finding: id });
        }}
      />
    </div>
  );
}
