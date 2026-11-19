"use client";

import { Check, LoaderCircle } from "lucide-react";
import type { ProgressStep, StepId } from "@/lib/case-progress";
import { SCAN_ANCHOR } from "@/lib/sections";
import { cn } from "@/lib/utils";
import { goToSection } from "./section-nav";

const TARGET: Record<StepId, string> = { scan: SCAN_ANCHOR, links: "links", report: "report" };

/** 1 Scanning → 2 Check the links → 3 Report ready. Each step scrolls to its section. */
export function ProgressRail({ steps, scanning }: { steps: ProgressStep[]; scanning: boolean }) {
  return (
    <ol data-tour="rail" aria-label="Progress" className="grid grid-cols-3 gap-1.5 sm:gap-2">
      {steps.map((step, i) => {
        const done = step.state === "done";
        const current = step.state === "current";
        return (
          <li key={step.id} className="min-w-0">
            <button
              type="button"
              onClick={() => goToSection(TARGET[step.id])}
              aria-current={current ? "step" : undefined}
              aria-label={`Step ${i + 1}: ${step.title}, ${step.detail}. Go to this section.`}
              className={cn(
                "group flex w-full min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors sm:gap-2.5 sm:px-3 sm:py-2",
                current
                  ? "border-accent/40 bg-accent/[0.06]"
                  : done
                    ? "border-border bg-card hover:border-input"
                    : "border-dashed border-border bg-transparent hover:border-input",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  done
                    ? "bg-success text-background"
                    : current
                      ? "bg-accent text-accent-foreground"
                      : "bg-muted text-muted-foreground",
                )}
                aria-hidden
              >
                {done ? (
                  <Check className="h-3.5 w-3.5 animate-tick-in" />
                ) : current && step.id === "scan" && scanning ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-xs font-medium sm:text-sm", !done && !current && "text-muted-foreground")}>
                  {step.title}
                </span>
                <span className="block truncate text-2xs text-muted-foreground sm:text-xs">{step.detail}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
