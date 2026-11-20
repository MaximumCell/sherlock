"use client";

import { useEffect, useState } from "react";
import { CountUp } from "@/components/motion/count-up";
import { arcShare } from "@/lib/ui/count-up";
import type { ExposureBand } from "@/lib/types";
import { cn } from "@/lib/utils";

export const BAND_META: Record<
  ExposureBand,
  {
    label: string;
    text: string;
    stroke: string;
    bar: string;
    glow: string;
    badge: "success" | "warning" | "danger";
  }
> = {
  low: {
    label: "Low",
    text: "text-success",
    stroke: "stroke-success",
    bar: "bg-success",
    glow: "drop-shadow-[0_0_10px_hsl(var(--success)/0.55)]",
    badge: "success",
  },
  moderate: {
    label: "Moderate",
    text: "text-warning",
    stroke: "stroke-warning",
    bar: "bg-warning",
    glow: "drop-shadow-[0_0_10px_hsl(var(--warning)/0.55)]",
    badge: "warning",
  },
  high: {
    label: "High",
    text: "text-danger",
    stroke: "stroke-danger",
    bar: "bg-danger",
    glow: "drop-shadow-[0_0_10px_hsl(var(--danger)/0.55)]",
    badge: "danger",
  },
  severe: {
    label: "Severe",
    text: "text-danger",
    stroke: "stroke-danger",
    bar: "bg-danger",
    glow: "drop-shadow-[0_0_12px_hsl(var(--danger)/0.7)]",
    badge: "danger",
  },
};

const R = 52;
const ARC = 0.75; // a 270 degree gauge
const C = 2 * Math.PI * R;
const TICKS = Array.from({ length: 11 }, (_, i) => i / 10);

/**
 * 0-100 gauge, like an instrument: tick marks every ten points, the arc sweeping to the
 * score while the number counts up, glowing in the band's colour. The meter's value is the
 * accessible part; the drawing is decoration.
 */
export function ExposureDial({ score, band }: { score: number; band: ExposureBand }) {
  const meta = BAND_META[band];
  // the arc starts empty and sweeps to the score once mounted
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(score));
    return () => cancelAnimationFrame(frame);
  }, [score]);
  const filled = arcShare(shown) * ARC * C;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      aria-valuetext={`${score} out of 100, ${meta.label.toLowerCase()} exposure`}
      aria-label="Exposure score"
      className="relative mx-auto h-48 w-48 shrink-0"
    >
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-[225deg]" aria-hidden>
        {TICKS.map((t) => {
          const a = t * ARC * Math.PI * 2;
          return (
            <line
              key={t}
              x1={60 + Math.cos(a) * 59}
              y1={60 + Math.sin(a) * 59}
              x2={60 + Math.cos(a) * (t % 0.5 === 0 ? 55 : 57)}
              y2={60 + Math.sin(a) * (t % 0.5 === 0 ? 55 : 57)}
              className="stroke-muted-foreground/50"
              strokeWidth="0.8"
            />
          );
        })}
        <circle
          cx="60"
          cy="60"
          r={R - 4}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-muted"
          strokeDasharray={`${ARC * (C - 8 * Math.PI)} ${C}`}
        />
        <circle
          cx="60"
          cy="60"
          r={R - 4}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className={cn(
            meta.stroke,
            meta.glow,
            "transition-[stroke-dasharray] duration-[900ms] ease-out motion-reduce:transition-none",
          )}
          strokeDasharray={`${filled * ((C - 8 * Math.PI) / C)} ${C}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <CountUp value={score} className="font-display text-6xl leading-none tracking-tight" />
        <span className="mt-1 font-mono text-2xs uppercase tracking-[0.14em] text-muted-foreground">
          out of 100
        </span>
      </div>
    </div>
  );
}
