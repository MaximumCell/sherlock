"use client";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GRAPH_KINDS, type GraphModel, type GraphNodeKind } from "@/lib/graph/build";
import { KIND_META } from "./entity-node";
import type { GraphFilterState } from "./graph-tab";

const FILTERABLE = GRAPH_KINDS.filter((k) => k !== "seed");

function LegendLine({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="26" height="6" aria-hidden className="react-flow__edge">
        <path d="M0 3 H26" className={`react-flow__edge-path ${className}`} />
      </svg>
      {label}
    </span>
  );
}

export function GraphFilters({
  filters,
  onChange,
  model,
}: {
  filters: GraphFilterState;
  onChange: (next: GraphFilterState) => void;
  model: GraphModel;
}) {
  const pct = Math.round(filters.minConfidence * 100);
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <ToggleGroup
          type="multiple"
          size="sm"
          value={filters.kinds.filter((k) => k !== "seed")}
          onValueChange={(value) =>
            onChange({ ...filters, kinds: ["seed", ...(value as GraphNodeKind[])] })
          }
          aria-label="Entity kinds to show"
          className="flex-wrap justify-start"
        >
          {FILTERABLE.map((kind) => {
            const Icon = KIND_META[kind].icon;
            return (
              <ToggleGroupItem key={kind} value={kind} className="gap-1.5">
                <Icon aria-hidden />
                {KIND_META[kind].label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <div className="flex items-center gap-2">
          <Label htmlFor="min-confidence" className="whitespace-nowrap text-sm font-normal text-muted-foreground">
            Min confidence
          </Label>
          <input
            id="min-confidence"
            type="range"
            min={0}
            max={100}
            step={5}
            value={pct}
            onChange={(e) => onChange({ ...filters, minConfidence: Number(e.target.value) / 100 })}
            className="h-1.5 w-32 cursor-pointer accent-[hsl(var(--accent))]"
          />
          <output htmlFor="min-confidence" className="w-9 font-mono text-xs tabular-nums">
            {pct}%
          </output>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="show-rejected"
            checked={filters.showRejected}
            onCheckedChange={(checked) => onChange({ ...filters, showRejected: checked })}
          />
          <Label htmlFor="show-rejected" className="text-sm font-normal text-muted-foreground">
            Show rejected links
          </Label>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span aria-live="polite">
          {model.nodes.length} nodes · {model.edges.length} edges
          {model.clustered > 0 ? ` · ${model.clustered} low-signal accounts clustered` : ""}
        </span>
        <LegendLine className="edge-found" label="found on" />
        <LegendLine className="edge-approved" label="approved link" />
        <LegendLine className="edge-pending" label="pending link" />
        {filters.showRejected ? <LegendLine className="edge-rejected" label="rejected" /> : null}
      </div>
    </div>
  );
}
