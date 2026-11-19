"use client";

import { ChevronDown, CircleCheckBig } from "lucide-react";
import { useState } from "react";
import type { RemediationStep } from "@/lib/remediation";
import { cn } from "@/lib/utils";

/** Prioritised "what to do" steps; the first `visible` show, the rest behind "Show all". */
export function RemediationList({
  steps,
  visible = 3,
  start = 0,
  emptyText,
}: {
  steps: RemediationStep[];
  visible?: number;
  /** Skip the first N steps (Next steps shows the ones after the summary). */
  start?: number;
  emptyText: string;
}) {
  const [all, setAll] = useState(false);
  const list = steps.slice(start);
  if (list.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const shown = all ? list : list.slice(0, visible);
  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {shown.map((step, i) => (
          <li
            key={step.text}
            className="flex animate-rise-in items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-soft"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success/10 text-xs font-semibold text-success">
              {start + i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base">{step.text}</span>
              <span className="text-sm text-muted-foreground">Lowers: {step.factor}</span>
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
          {all ? (
            "Show fewer"
          ) : (
            <>
              <CircleCheckBig className="h-4 w-4" aria-hidden />
              Show all {list.length} steps
            </>
          )}
          <ChevronDown className={cn("h-4 w-4 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
