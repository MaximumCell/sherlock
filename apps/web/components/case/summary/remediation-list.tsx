"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";
import type { RemediationStep } from "@/lib/remediation";
import { cn } from "@/lib/utils";

/** Prioritised "what to do" steps; the first `visible` show, the rest behind "Show all". */
export function RemediationList({
  steps,
  visible = 3,
  start = 0,
  emptyText,
  columns = 1,
}: {
  steps: RemediationStep[];
  visible?: number;
  /** Skip the first N steps (Next steps shows the ones after the summary). */
  start?: number;
  emptyText: string;
  columns?: 1 | 3;
}) {
  const [all, setAll] = useState(false);
  const list = steps.slice(start);
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const shown = all ? list : list.slice(0, visible);
  return (
    <div className="space-y-3">
      <ol className={cn("grid gap-3", columns === 3 && "md:grid-cols-3")}>
        {shown.map((step, i) => (
          <li
            key={step.text}
            className="panel flex animate-rise-in flex-col gap-3 p-4"
            style={{ animationDelay: `${Math.min(i, 6) * 60}ms` }}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-2xs text-muted-foreground">
                {String(start + i + 1).padStart(2, "0")}
              </span>
              <span className="h-px flex-1 bg-border" aria-hidden />
            </span>
            <span className="block flex-1 text-base leading-snug">{step.text}</span>
            <span className="text-xs text-muted-foreground">
              Lowers: <span className="text-foreground/80">{step.factor}</span>
            </span>
          </li>
        ))}
      </ol>
      {list.length > visible ? (
        <button
          type="button"
          aria-expanded={all}
          onClick={() => setAll((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-sm font-medium text-accent hover:underline"
        >
          {all ? "Show fewer" : `Show all ${list.length} steps`}
          <ChevronDown
            className={cn("h-4 w-4 transition-transform duration-2", all && "rotate-180")}
            aria-hidden
          />
        </button>
      ) : null}
    </div>
  );
}
