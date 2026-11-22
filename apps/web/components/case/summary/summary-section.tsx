"use client";

import { useMemo } from "react";
import { CountUp } from "@/components/motion/count-up";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceProgress } from "@/lib/case-progress";
import { buildSummarySentence } from "@/lib/case-summary";
import { caseDisplayTitle } from "@/lib/case-status";
import { accountsInLink, buildAccounts, linkRows } from "@/lib/accounts";
import { countAccounts } from "@/lib/finding-groups";
import { computeStats } from "@/lib/findings";
import { useExposure } from "@/lib/query/hooks";
import { prioritisedSteps } from "@/lib/remediation";
import type { Case, Correlation, Finding, Job } from "@/lib/types";
import { CaseSection } from "../section";
import { goToSection } from "../section-nav";
import { FacesStrip } from "./faces-strip";
import { RemediationList } from "./remediation-list";
import { ScoreCard } from "./score-card";
import { ScoreDetails } from "./score-details";
import { UploadedPhoto } from "./uploaded-photo";
import { displayTargetValue, isUploadedPhoto } from "@/lib/uploads";

function KeyNumber({
  label,
  value,
  hint,
  target,
}: {
  label: string;
  value: number;
  hint: string;
  target: string;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => goToSection(target)}
        className="group block h-full w-full p-4 text-left transition-colors duration-1 hover:bg-muted/50"
      >
        <CountUp
          value={value}
          className="block font-display text-5xl leading-none tracking-tight"
        />
        <span className="mt-2 block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </button>
    </li>
  );
}

export function SummarySection({
  c,
  findings,
  correlations,
  jobs,
  loading,
}: {
  c: Case;
  findings: Finding[];
  correlations: Correlation[];
  jobs: Job[];
  loading: boolean;
}) {
  const exposure = useExposure(c.id);
  const stats = useMemo(() => computeStats(findings, correlations), [findings, correlations]);
  const accounts = useMemo(() => countAccounts(findings, correlations), [findings, correlations]);
  const linkedAccounts = useMemo(() => {
    const index = buildAccounts(findings, correlations);
    const keys = new Set<string>();
    for (const c of linkRows(correlations)) {
      if (c.status === "approved") accountsInLink(c, index).forEach((a) => keys.add(a.key));
    }
    return keys.size;
  }, [findings, correlations]);
  const progress = sourceProgress(jobs);
  const results = findings.filter((f) => f.status === "found").length;
  const sentence = buildSummarySentence({
    subject: c.identifiers[0] ? displayTargetValue(c.identifiers[0].value) : caseDisplayTitle(c),
    accounts,
    results,
    sources: stats.platformsChecked,
    breaches: stats.breaches,
    pendingLinks: stats.pendingReviews,
    scanning: progress.scanning ? { done: progress.done, total: progress.total } : null,
  });
  const steps = useMemo(() => prioritisedSteps(exposure.data?.factors ?? []), [exposure.data]);
  const upload = c.identifiers.find((i) => i.type === "image" && isUploadedPhoto(i.value));

  return (
    <CaseSection id="summary" title="Summary">
      <div className="space-y-6" data-tour="summary">
        {loading ? (
          <Skeleton className="h-9 w-full max-w-3xl" />
        ) : (
          <p
            className="max-w-4xl text-xl leading-relaxed text-foreground sm:text-[1.625rem] sm:leading-snug"
            aria-live="polite"
          >
            {sentence}
          </p>
        )}
        {upload ? <UploadedPhoto value={upload.value} findings={findings} /> : null}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
          <div className="xl:col-span-4 xl:row-span-2">
            <ScoreCard
              exposure={exposure.data}
              pending={exposure.isPending}
              error={exposure.isError ? exposure.error : null}
              onRetry={() => void exposure.refetch()}
            />
          </div>
          <ul className="panel grid grid-cols-2 divide-x divide-y divide-border overflow-hidden xl:col-span-5 [&>li:nth-child(2)]:border-t-0 [&>li:nth-child(3)]:border-l-0">
            <KeyNumber
              label="Accounts found"
              value={accounts}
              hint="Profiles and sign-ups"
              target="found"
            />
            <KeyNumber
              label="Sites checked"
              value={stats.platformsChecked}
              hint="Across every data source"
              target="scan"
            />
            <KeyNumber
              label="Breach listings"
              value={stats.breaches}
              hint="Names and dates only"
              target="found"
            />
            <KeyNumber
              label="Linked accounts"
              value={linkedAccounts}
              hint={
                stats.pendingReviews
                  ? `${stats.pendingReviews} more links to check`
                  : "In links you confirmed"
              }
              target="links"
            />
          </ul>
          <div className="md:col-span-2 xl:col-span-3">
            <FacesStrip findings={findings} correlations={correlations} />
          </div>
          <div className="space-y-3 md:col-span-2 xl:col-span-8">
            <h3 className="eyebrow">What to do</h3>
            {exposure.isPending ? (
              <div className="grid gap-3 md:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : (
              <RemediationList
                steps={steps}
                columns={3}
                emptyText="Nothing to fix yet. Steps appear here once results raise the score."
              />
            )}
          </div>
        </div>
      </div>
      {exposure.data ? <ScoreDetails exposure={exposure.data} findings={findings} /> : null}
    </CaseSection>
  );
}
