"use client";

import { AlertTriangle, Ban, Check } from "lucide-react";
import { memo, useMemo } from "react";
import { PlatformIcon } from "@/components/common/platform-icon";
import { TargetIcon } from "@/components/common/bits";
import { orbitLayout, type ScanTile, type TileState } from "@/lib/ui/scanner";
import { cn } from "@/lib/utils";

const RING: Record<TileState, string> = {
  waiting: "border-border opacity-45",
  checking: "border-accent/30",
  found: "border-accent shadow-glow",
  empty: "border-success/40",
  failed: "border-warning/60",
  stopped: "border-border opacity-60",
};

/** One data source: its icon in a ring that spins while checking and lights up when done. */
export const SourceTile = memo(function SourceTile({
  tile,
  size = "md",
}: {
  tile: ScanTile;
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  return (
    <span className={cn("relative flex items-center justify-center", box)}>
      <span
        className={cn(
          "absolute inset-0 rounded-lg border bg-card transition-[border-color,box-shadow,opacity] duration-3 ease-out",
          RING[tile.state],
        )}
      />
      {tile.state === "checking" ? (
        <span className="absolute -inset-px rounded-lg border-2 border-transparent border-t-accent motion-safe:animate-spin" />
      ) : null}
      {tile.state === "found" ? (
        <span
          key="burst"
          className="absolute inset-0 animate-burst rounded-lg border border-accent"
        />
      ) : null}
      <PlatformIcon platform={tile.module} size="sm" className="relative border-0 bg-transparent" />
      {tile.state === "found" ? (
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 animate-tick-in items-center justify-center rounded-full bg-accent px-1 font-mono text-[9px] font-medium text-accent-foreground">
          {tile.found}
        </span>
      ) : tile.state === "empty" ? (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 animate-tick-in items-center justify-center rounded-full bg-success text-background">
          <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
        </span>
      ) : tile.state === "failed" ? (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 animate-tick-in items-center justify-center rounded-full bg-warning text-background">
          <AlertTriangle className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
        </span>
      ) : tile.state === "stopped" ? (
        <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-muted-foreground text-background">
          <Ban className="h-2.5 w-2.5" strokeWidth={3} aria-hidden />
        </span>
      ) : null}
    </span>
  );
});

/**
 * Sources in orbit around what was searched. Lines run from the target to each source and
 * light up when that source found something. Purely visual: the source list below the
 * scanner says the same in words.
 */
export function ScannerOrbit({
  tiles,
  targetType,
  targetValue,
}: {
  tiles: ScanTile[];
  targetType: string;
  targetValue: string;
}) {
  const layout = useMemo(() => orbitLayout(tiles.length), [tiles.length]);
  return (
    <div aria-hidden className="relative mx-auto aspect-square w-full max-w-[340px]">
      <svg viewBox="-100 -100 200 200" className="absolute inset-0 h-full w-full overflow-visible">
        <circle r="62" className="fill-none stroke-border" strokeDasharray="1 3" />
        <circle r="96" className="fill-none stroke-border/60" strokeDasharray="1 3" />
        {tiles.map((t, i) => {
          const p = layout[i];
          if (!p) return null;
          const lit = t.state === "found";
          return (
            <line
              key={t.id}
              x1={p.x * 26}
              y1={p.y * 26}
              x2={p.x * 88}
              y2={p.y * 88}
              className={cn(
                "transition-[stroke,stroke-opacity] duration-4 ease-out",
                lit
                  ? "stroke-accent"
                  : t.state === "checking"
                    ? "stroke-accent/25"
                    : "stroke-border",
              )}
              strokeWidth={lit ? 1 : 0.6}
            />
          );
        })}
      </svg>
      <span className="absolute left-1/2 top-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-accent/50 bg-background shadow-glow">
        <TargetIcon type={targetType} className="h-5 w-5 text-accent" />
      </span>
      <span className="absolute -bottom-6 left-1/2 max-w-full -translate-x-1/2 truncate font-mono text-2xs text-muted-foreground">
        {targetValue}
      </span>
      {tiles.map((t, i) => {
        const p = layout[i];
        if (!p) return null;
        return (
          <span
            key={t.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${50 + p.x * 44}%`, top: `${50 + p.y * 44}%` }}
          >
            <SourceTile tile={t} size={p.ring === 1 ? "sm" : "md"} />
          </span>
        );
      })}
    </div>
  );
}
