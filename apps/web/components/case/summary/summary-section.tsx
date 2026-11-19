"use client";

import { useMemo } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceProgress } from "@/lib/case-progress";
import { buildSummarySentence } from "@/lib/case-summary";
import { caseDisplayTitle } from "@/lib/case-status";
import { computeStats } from "@/lib/findings";
import { useExposure } from "@/lib/query/hooks";
import { prioritisedSteps } from "@/lib/remediation";
import type { Case, Correlation, Finding, Job } from "@/lib/types";
import { CaseSection } from "../section";
import { goToSection } from "../section-nav";
import { RemediationList } from "./remediation-list";
import { ScoreCard } from "./score-card";
import { ScoreDetails } from "./score-details";

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
    <li>
      <button
        type="button"
        onClick={() => goToSection(target)}
        className="block h-full w-full rounded-xl border border-border bg-card p-4 text-left shadow-soft transition-colors hover:border-input"
      >
        <span className="block text-3xl font-semibold tabular-nums tracking-tight">{value}</span>
        <span className="mt-1 block text-sm font-medium">{label}</span>
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
  const progress = sourceProgress(jobs);
  const results = findings.filter((f) => f.status === "found").length;
  const sentence = buildSummarySentence({
    subject: c.identifiers[0]?.value ?? caseDisplayTitle(c),
    accounts: stats.accountsFound,
    results,
    sources: stats.platformsChecked,
    breaches: stats.breaches,
    pendingLinks: stats.pendingReviews,
    scanning: progress.scanning ? { done: progress.done, total: progress.total } : null,
  });
  const steps = useMemo(() => prioritisedSteps(exposure.data?.factors ?? []), [exposure.data]);

  return (
    <CaseSection id="summary" title="Summary">
      <div className="space-y-5" data-tour="summary">
        {loading ? (
          <Skeleton className="h-8 w-full max-w-3xl" />
        ) : (
          <p
            className="max-w-3xl text-xl leading-relaxed text-foreground sm:text-2xl sm:leading-snug"
            aria-live="polite"
          >
            {sentence}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,15rem)_1fr]">
          <ScoreCard
            exposure={exposure.data}
            pending={exposure.isPending}
            error={exposure.isError ? exposure.error : null}
            onRetry={() => void exposure.refetch()}
          />
          <ul className="grid grid-cols-2 gap-3 self-start">
            <KeyNumber
              label="Accounts found"
              value={stats.accountsFound}
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
              value={stats.linkedIdentities}
              hint={
                stats.pendingReviews
                  ? `${stats.pendingReviews} more links to check`
                  : "In links you confirmed"
              }
              target="links"
            />
          </ul>
        </div>
      </div>
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">What to do</h3>
        {exposure.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <RemediationList
            steps={steps}
            emptyText="Nothing to fix yet. Steps appear here once results raise the score."
          />
        )}
      </div>
      {exposure.data ? <ScoreDetails exposure={exposure.data} findings={findings} /> : null}
    </CaseSection>
  );
}
