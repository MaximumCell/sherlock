"use client";

import { useMemo } from "react";
import { ErrorState } from "@/components/common/states";
import { computeStats } from "@/lib/findings";
import {
  useAudit,
  useCase,
  useCorrelations,
  useEntities,
  useFindings,
  useJobs,
} from "@/lib/query/hooks";
import { buildTimeline } from "@/lib/timeline";
import { ExposureCard } from "./exposure-card";
import { PivotsCard } from "./pivots-card";
import { RecentActivity } from "./recent-activity";
import { StatTiles } from "./stat-tiles";
import { TargetsCard } from "./targets-card";

export function OverviewTab({ caseId }: { caseId: string }) {
  const c = useCase(caseId);
  const findings = useFindings(caseId);
  const correlations = useCorrelations(caseId);
  const entities = useEntities(caseId);
  const jobs = useJobs(caseId);
  const audit = useAudit(caseId);

  const stats = useMemo(
    () => computeStats(findings.data ?? [], correlations.data ?? []),
    [findings.data, correlations.data],
  );
  const recent = useMemo(
    () =>
      buildTimeline({
        case: c.data ?? null,
        audit: audit.data ?? [],
        jobs: jobs.data ?? [],
        findings: [],
      }).slice(0, 7),
    [c.data, audit.data, jobs.data],
  );

  if (findings.isError) {
    return <ErrorState error={findings.error} onRetry={() => void findings.refetch()} />;
  }
  if (!c.data) return null;

  return (
    <div className="space-y-4">
      <StatTiles
        caseId={caseId}
        stats={stats}
        loading={findings.isPending || correlations.isPending}
      />
      {c.data.exposure ? <ExposureCard exposure={c.data.exposure} /> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TargetsCard c={c.data} jobs={jobs.data ?? []} entities={entities.data ?? []} />
        <PivotsCard caseId={caseId} entities={entities.data ?? []} jobs={jobs.data ?? []} loading={entities.isPending} />
      </div>
      <RecentActivity caseId={caseId} events={recent} loading={audit.isPending && jobs.isPending} />
    </div>
  );
}
