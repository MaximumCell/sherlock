"use client";

import { ExternalLink, Star } from "lucide-react";
import { Avatar } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { findingTitle, parseFinding } from "@/lib/findings";
import { useCorrelations, useFindings } from "@/lib/query/hooks";
import { useCurate } from "@/lib/query/mutations";
import type { Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { FindingDetail } from "./finding-detail";
import { FindingStatusBadge } from "./findings-table";

function SheetBody({ caseId, finding }: { caseId: string; finding: Finding }) {
  const curate = useCurate(caseId);
  const correlations = useCorrelations(caseId);
  const view = parseFinding(finding);
  const related = (correlations.data ?? []).filter((c) => c.entities_involved.includes(finding.id));
  return (
    <>
      <SheetHeader className="pr-8 text-left">
        <div className="flex items-start gap-3">
          <Avatar src={view.avatarUrl} name={findingTitle(finding)} className="h-12 w-12 text-sm" />
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle className="break-words">{findingTitle(finding)}</SheetTitle>
            <SheetDescription className="break-all font-mono text-xs">
              {finding.identifier_type}: {finding.identifier_value}
            </SheetDescription>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <FindingStatusBadge status={finding.status} />
              <span className="text-xs text-muted-foreground">{view.category}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            variant={finding.curated ? "secondary" : "outline"}
            size="sm"
            aria-pressed={finding.curated}
            onClick={() => curate.mutate({ findingId: finding.id, curated: !finding.curated })}
          >
            <Star className={cn(finding.curated && "fill-warning text-warning")} aria-hidden />
            {finding.curated ? "Shortlisted" : "Add to shortlist"}
          </Button>
          {view.url ? (
            <Button variant="outline" size="sm" asChild>
              <a href={view.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink aria-hidden />
                Open source
              </a>
            </Button>
          ) : null}
        </div>
      </SheetHeader>
      <FindingDetail finding={finding} view={view} related={related} />
    </>
  );
}

/** Detail sheet for the finding named in `?finding=`. Any tab can open it by setting the param. */
export function FindingSheet({ caseId }: { caseId: string }) {
  const { params, set } = useUrlState();
  const findings = useFindings(caseId);
  const id = params.get("finding");
  const finding = id ? findings.data?.find((f) => f.id === id) : undefined;
  const open = Boolean(id) && !findings.isPending;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && set({ finding: null })}>
      <SheetContent className="sm:max-w-xl">
        {finding ? (
          <SheetBody caseId={caseId} finding={finding} />
        ) : (
          <SheetHeader>
            <SheetTitle>Finding not found</SheetTitle>
            <SheetDescription>
              This finding is not part of the case any more. It may have been replaced by a rescan.
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
