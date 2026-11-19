"use client";

import { ChevronDown } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { Exposure, Finding } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExposureFactorRow } from "./exposure-factor-row";

/** "How this score is calculated": every factor with its points, evidence and the method. */
export function ScoreDetails({ exposure, findings }: { exposure: Exposure; findings: Finding[] }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const scored = exposure.factors.filter((f) => f.points > 0);
  const zero = exposure.factors.filter((f) => f.points <= 0);
  const { findings: rows, approved_correlations: links } = exposure.computed_from;

  return (
    <div className="rounded-2xl border border-border bg-card shadow-soft">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-5 py-4 text-left text-base font-medium hover:bg-muted/40"
      >
        How this score is calculated
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className="animate-fade-in space-y-5 border-t border-border px-5 py-5">
          <p className="text-sm text-muted-foreground">
            Worked out from {rows} found result{rows === 1 ? "" : "s"} and {links} confirmed link
            {links === 1 ? "" : "s"}. Each factor below adds points up to its own cap.
          </p>
          {scored.length ? (
            <ul className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2">
              {scored.map((factor) => (
                <ExposureFactorRow key={factor.key} factor={factor} findings={byId} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing scores yet. Run a search, then confirm the links you trust.
            </p>
          )}
          {zero.length ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Not contributing:</span>{" "}
              {zero.map((f) => f.label).join(", ")}.
            </p>
          ) : null}
          {exposure.method ? (
            <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Method.</span> {exposure.method}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
