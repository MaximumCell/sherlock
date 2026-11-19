"use client";

import { ChevronDown, ListChecks } from "lucide-react";
import { useId, useState } from "react";
import { findingTitle } from "@/lib/findings";
import type { ExposureFactor, Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";

const EVIDENCE_SHOWN = 6;

/** One factor: points bar, detail, and an expandable list of remediation steps + evidence. */
export function ExposureFactorRow({
  factor,
  findings,
}: {
  factor: ExposureFactor;
  findings: ReadonlyMap<string, Finding>;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { set } = useUrlState();
  const share = factor.max_points > 0 ? Math.min(1, factor.points / factor.max_points) : 0;
  // colour by how close the factor is to its cap, not by the overall band
  const barClass = share >= 0.66 ? "bg-danger" : share >= 0.33 ? "bg-warning" : "bg-accent";
  const evidence = factor.evidence_finding_ids
    .map((id) => findings.get(id))
    .filter((f): f is Finding => f !== undefined);
  const expandable = factor.remediation.length > 0 || evidence.length > 0;
  const points = Number.isInteger(factor.points) ? factor.points : factor.points.toFixed(1);

  return (
    <li className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium">{factor.label}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          <span className="text-foreground">{points}</span> / {factor.max_points}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className={cn("h-full rounded-full", share > 0 ? barClass : "")}
          style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">{factor.detail}</p>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform motion-reduce:transition-none", open && "rotate-180")}
            aria-hidden
          />
          {open ? "Hide" : "What to do"}
          {evidence.length ? ` · ${evidence.length} finding${evidence.length === 1 ? "" : "s"}` : ""}
        </button>
      ) : null}
      {open ? (
        <div id={panelId} className="mt-2 space-y-3 rounded-md border border-border bg-muted/30 p-3">
          {factor.remediation.length ? (
            <ol className="space-y-1.5 text-sm">
              {factor.remediation.map((step, i) => (
                <li key={step} className="flex gap-2">
                  <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                  <span>
                    <span className="sr-only">Step {i + 1}: </span>
                    {step}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
          {evidence.length ? (
            <div>
              <p className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                Evidence
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {evidence.slice(0, EVIDENCE_SHOWN).map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => set({ finding: f.id }, "push")}
                      className="max-w-[16rem] truncate rounded-md border border-border bg-card px-2 py-0.5 text-xs hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {findingTitle(f)}
                    </button>
                  </li>
                ))}
                {evidence.length > EVIDENCE_SHOWN ? (
                  <li className="px-1 py-0.5 text-xs text-muted-foreground">
                    +{evidence.length - EVIDENCE_SHOWN} more
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
