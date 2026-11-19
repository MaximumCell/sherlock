"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sourceProgress } from "@/lib/case-progress";
import { caseDisplayTitle } from "@/lib/case-status";
import { useCaseListRealtime, useCaseSummaries } from "@/lib/query/hooks";
import { useCaseHref } from "@/lib/use-case-href";

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
          className="mr-1 flex h-8 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/15"
        >
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span className="hidden sm:inline">
            {running.length === 1 ? `${p.done}/${p.total}` : `${running.length} scanning`}
          </span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
