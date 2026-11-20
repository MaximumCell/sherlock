"use client";

import { ExternalLink, Pin } from "lucide-react";
import { useMemo } from "react";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { ProvenanceLabel } from "@/components/common/provenance-label";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { buildAccounts, linkRows } from "@/lib/accounts";
import { findingTitle, parseFinding } from "@/lib/findings";
import { useCorrelations, useFindings } from "@/lib/query/hooks";
import { useCurate } from "@/lib/query/mutations";
import type { Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { findingPlatform } from "@/lib/profile";
import { resolvePlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import { AccountSheetBody } from "./account-sheet-body";
import { FindingDetail } from "./finding-detail";
import { FindingStatusBadge } from "./results-table";

function SheetBody({
  caseId,
  finding,
  findings,
}: {
  caseId: string;
  finding: Finding;
  findings: Finding[];
}) {
  const curate = useCurate(caseId);
  const correlations = useCorrelations(caseId);
  const all = useMemo(() => correlations.data ?? [], [correlations.data]);
  const account = useMemo(
    () => buildAccounts(findings, all).byFinding.get(finding.id),
    [findings, all, finding.id],
  );
  const view = parseFinding(finding);
  const platform = findingPlatform(finding);
  const platformKnown = resolvePlatform(platform).known;
  const mine = new Set(account ? account.findings.map((f) => f.id) : [finding.id]);
  const related = linkRows(all).filter((c) => c.entities_involved.some((id) => mine.has(id)));
  if (account && account.findings.length > 1) {
    return (
      <AccountSheetBody caseId={caseId} account={account} related={related} openId={finding.id} />
    );
  }
  return (
    <>
      <SheetHeader className="-mx-5 -mt-5 border-b border-border bg-surface/70 px-5 pb-5 pt-7 pr-12 text-left">
        <div className="flex items-start gap-4">
          <ProfileAvatar
            src={view.avatarUrl}
            name={view.fullname ?? findingTitle(finding)}
            platform={platformKnown ? platform : null}
            url={view.url}
            size={view.avatarUrl || view.fullname ? "xl" : "md"}
          />
          <div className="min-w-0 flex-1 space-y-1">
            <SheetTitle className="break-words">{view.fullname ?? findingTitle(finding)}</SheetTitle>
            {view.fullname ? <p className="text-sm text-muted-foreground">{findingTitle(finding)}</p> : null}
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
            <Pin className={cn(finding.curated && "fill-current text-accent")} aria-hidden />
            {finding.curated ? "Pinned" : "Pin"}
          </Button>
          {view.url ? (
            <Button variant="outline" size="sm" asChild>
              <a href={view.url} target="_blank" rel="noreferrer noopener">
                <ExternalLink aria-hidden />
                Open the page
              </a>
            </Button>
          ) : null}
        </div>
        {/* after the buttons, so the sheet does not open with its tooltip focused */}
        <ProvenanceLabel preview={view.preview} platform={platform} />
      </SheetHeader>
      <FindingDetail finding={finding} view={view} related={related} />
    </>
  );
}

/** Detail sheet for the result named in `?finding=`. Any section can open it by setting the param. */
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
          <SheetBody caseId={caseId} finding={finding} findings={findings.data ?? []} />
        ) : (
          <SheetHeader>
            <SheetTitle>This result is gone</SheetTitle>
            <SheetDescription>
              It is not part of this investigation any more. A newer search may have replaced it.
              Close this panel and pick another result.
            </SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}
