"use client";

import { Check } from "lucide-react";
import type { ProgressStep, StepId } from "@/lib/case-progress";
import { SCAN_ANCHOR } from "@/lib/sections";
import { cn } from "@/lib/utils";
import { goToSection } from "./section-nav";

const TARGET: Record<StepId, string> = { scan: SCAN_ANCHOR, links: "links", report: "report" };

/**
 * 1 Scanning → 2 Check the links → 3 Report ready: three nodes on one line. The line fills
 * up to the current step; each step scrolls to its section.
 */
export function ProgressRail({ steps, scanning }: { steps: ProgressStep[]; scanning: boolean }) {
  const reached = steps.reduce((n, s, i) => (s.state !== "upcoming" ? i : n), 0);
  return (
    <div className="relative" data-tour="rail">
      <div aria-hidden className="absolute left-3 right-3 top-[13px] h-px bg-border sm:left-4 sm:right-4">
        <div
          className="h-px bg-accent transition-[width] duration-4 ease-out"
          style={{ width: `${(reached / Math.max(1, steps.length - 1)) * 100}%` }}
        />
      </div>
      <ol aria-label="Progress" className="relative grid grid-cols-3 gap-2">
        {steps.map((step, i) => {
          const done = step.state === "done";
          const current = step.state === "current";
          return (
            <li key={step.id} className={cn("min-w-0", i === 1 && "justify-self-center", i === 2 && "justify-self-end")}>
              <button
                type="button"
                onClick={() => goToSection(TARGET[step.id])}
                aria-current={current ? "step" : undefined}
                aria-label={`Step ${i + 1}: ${step.title}, ${step.detail}. Go to this section.`}
                className={cn(
                  "group flex min-w-0 flex-col gap-1.5 rounded-md px-1 pb-0.5",
                  i === 0 && "items-start text-left",
                  i === 1 && "items-center text-center",
                  i === 2 && "items-end text-right",
                )}
              >
                <span
                  className={cn(
                    "relative flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border font-mono text-2xs transition-colors duration-3",
                    done
                      ? "border-success bg-success text-background"
                      : current
                        ? "border-accent bg-background text-accent shadow-glow"
                        : "border-border bg-background text-muted-foreground group-hover:border-input",
                  )}
                  aria-hidden
                >
                  {done ? <Check className="h-3.5 w-3.5 animate-tick-in" strokeWidth={3} /> : i + 1}
                  {current && step.id === "scan" && scanning ? (
                    <span className="absolute -inset-[3px] rounded-full border-2 border-transparent border-t-accent motion-safe:animate-spin" />
                  ) : null}
                </span>
                <span className="min-w-0 max-w-full">
                  <span
                    className={cn(
                      "block truncate text-xs font-medium sm:text-sm",
                      !done && !current && "text-muted-foreground",
                    )}
                  >
                    <span className="sm:hidden">{step.short}</span>
                    <span className="hidden sm:inline">{step.title}</span>
                  </span>
                  <span className="block truncate font-mono text-2xs text-muted-foreground">
                    {step.detail}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
