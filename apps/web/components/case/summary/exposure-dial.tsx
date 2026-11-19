import type { ExposureBand } from "@/lib/types";
import { cn } from "@/lib/utils";

export const BAND_META: Record<
  ExposureBand,
  {
    label: string;
    text: string;
    stroke: string;
    bar: string;
    badge: "success" | "warning" | "danger";
  }
> = {
  low: {
    label: "Low",
    text: "text-success",
    stroke: "stroke-success",
    bar: "bg-success",
    badge: "success",
  },
  moderate: {
    label: "Moderate",
    text: "text-warning",
    stroke: "stroke-warning",
    bar: "bg-warning",
    badge: "warning",
  },
  high: {
    label: "High",
    text: "text-danger",
    stroke: "stroke-danger",
    bar: "bg-danger",
    badge: "danger",
  },
  severe: {
    label: "Severe",
    text: "text-danger",
    stroke: "stroke-danger",
    bar: "bg-danger",
    badge: "danger",
  },
};

const R = 52;
const ARC = 0.75; // a 270 degree gauge
const C = 2 * Math.PI * R;

/** 0-100 gauge. The number is the accessible value; the arc is decoration. */
export function ExposureDial({ score, band }: { score: number; band: ExposureBand }) {
  const meta = BAND_META[band];
  const filled = (Math.max(0, Math.min(100, score)) / 100) * ARC * C;
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={score}
      aria-valuetext={`${score} out of 100, ${meta.label.toLowerCase()} exposure`}
      aria-label="Exposure score"
      className="relative mx-auto h-36 w-36 shrink-0"
    >
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-[225deg]" aria-hidden>
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className="stroke-muted"
          strokeDasharray={`${ARC * C} ${C}`}
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          strokeWidth="9"
          strokeLinecap="round"
          className={cn(
            meta.stroke,
            "transition-[stroke-dasharray] duration-700 motion-reduce:transition-none",
          )}
          strokeDasharray={`${filled} ${C}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-semibold tabular-nums leading-none tracking-tight">
          {score}
        </span>
        <span className="mt-1.5 text-xs text-muted-foreground">out of 100</span>
      </div>
    </div>
  );
}
