"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sourceProgress } from "@/lib/case-progress";
import { caseDisplayTitle } from "@/lib/case-status";
import { useCaseListRealtime, useCaseSummaries } from "@/lib/query/hooks";
import { useCaseHref } from "@/lib/use-case-href";

/** A 14px ring that fills with progress (or spins when there is no single number). */
function ScanRing({ value }: { value: number | null }) {
  const c = 2 * Math.PI * 5.5;
  return (
    <svg
      viewBox="0 0 14 14"
      className={value === null ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5 -rotate-90"}
      aria-hidden
    >
      <circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="7"
        cy="7"
        r="5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(value ?? 0.3) * c} ${c}`}
        className="transition-[stroke-dasharray] duration-4 ease-out"
      />
    </svg>
  );
}

/** Small global hint in the top bar while any investigation is still scanning. */
export function ScanIndicator() {
  const cases = useCaseSummaries();
  useCaseListRealtime();
  const caseHref = useCaseHref();
  const running = useMemo(
    () => (cases.data ?? []).filter((s) => !s.case.archived_at && sourceProgress(s.jobs).scanning),
    [cases.data],
  );
  const first = running[0];
  if (!first) return null;
  const p = sourceProgress(first.jobs);
  const label =
    running.length === 1
      ? `Scanning ${caseDisplayTitle(first.case)}: ${p.done} of ${p.total} sources done`
      : `${running.length} investigations are scanning`;
  const href = running.length === 1 ? `${caseHref(first.case.id)}#scan` : "/";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          className="mr-1 flex h-8 items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.07] px-2.5 font-mono text-xs text-accent transition-colors duration-1 hover:bg-accent/15"
        >
          <ScanRing value={running.length === 1 && p.total ? p.done / p.total : null} />
          <span className="hidden sm:inline">
            {running.length === 1 ? `${p.done}/${p.total}` : `${running.length} scanning`}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
