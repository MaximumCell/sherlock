import type { ReactNode } from "react";
import { arcShare } from "@/lib/ui/count-up";
import { cn } from "@/lib/utils";

const TONE = {
  accent: "stroke-accent",
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
  muted: "stroke-muted-foreground",
} as const;

/**
 * A small ring: scan progress, or a 270° mini exposure dial (`gauge`). The centre holds a
 * short label. Decorative; the caller states the value in words.
 */
export function MiniRing({
  value,
  max = 100,
  tone = "accent",
  gauge = false,
  spin = false,
  size = 40,
  children,
  className,
}: {
  value: number;
  max?: number;
  tone?: keyof typeof TONE;
  gauge?: boolean;
  spin?: boolean;
  size?: number;
  children?: ReactNode;
  className?: string;
}) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const sweep = gauge ? 0.75 : 1;
  const filled = arcShare(value, max) * sweep * c;
  return (
    <span
      aria-hidden
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 40 40"
        className={cn("absolute inset-0 h-full w-full", gauge ? "-rotate-[225deg]" : "-rotate-90")}
      >
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          className="stroke-muted"
          strokeDasharray={`${sweep * c} ${c}`}
        />
        <g className={cn(spin && "origin-center motion-safe:animate-spin")}>
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className={cn(TONE[tone], "transition-[stroke-dasharray] duration-4 ease-out")}
            strokeDasharray={`${filled} ${c}`}
          />
        </g>
      </svg>
      <span className="relative font-mono text-[10px] tabular-nums text-foreground">{children}</span>
    </span>
  );
}
