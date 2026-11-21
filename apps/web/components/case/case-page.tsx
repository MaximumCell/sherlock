"use client";

import { FileQuestion } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { useReadOnly } from "@/components/providers/read-only";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deriveSteps, sourceProgress } from "@/lib/case-progress";
import { caseDisplayTitle } from "@/lib/case-status";
import {
  useCase,
  useCaseRealtime,
  useCorrelations,
  useEntities,
  useFindings,
  useJobs,
  useWakeStuckJobs,
} from "@/lib/query/hooks";
import {
  SCAN_ANCHOR,
  sectionFromUrl,
  visibleSections,
  type CaseSection as SectionId,
} from "@/lib/sections";
import { useNearViewport } from "@/lib/use-near-viewport";
import { useScrollSpy } from "@/lib/use-scroll-spy";
import { groupFindings } from "@/lib/finding-groups";
import { useUrlState } from "@/lib/use-url-state";
import type { Case, Correlation, Entity, Finding } from "@/lib/types";
import { CaseHeader } from "./case-header";
import { CaseSkeleton } from "./case-skeleton";

export { CaseSkeleton };
import { FindingSheet } from "./found/finding-sheet";
import { FoundSection } from "./found/found-section";
import { HistorySection } from "./history/history-section";
import { LinksSection } from "./links/links-section";
import { NextStepsSection } from "./next/next-steps-section";
import { PeopleSection } from "./people/people-section";
import { ProgressRail } from "./progress-rail";
import { ReportSection } from "./report/report-section";
import { ScanPanel } from "./scan/scan-panel";
import { CaseSection } from "./section";
import { SectionNav } from "./section-nav";
import { SummarySection } from "./summary/summary-section";

// React Flow measures the DOM, so the map only ever renders in the browser.
const MapView = dynamic(() => import("./map/map-section").then((m) => m.MapView), {
  ssr: false,
  loading: () => <Skeleton className="h-[65dvh] w-full rounded-xl" />,
});

function MapSection(props: {
  c: Case;
  findings: Finding[];
  correlations: Correlation[];
  entities: Entity[];
  ready: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref);
  return (
    <CaseSection
      id="map"
      title="Connections map"
      description="Each circle is something we found; lines show how they connect. Solid green lines are links you confirmed, dashed amber ones still need your decision. Hover a circle to focus on its connections; click it for its details."
    >
      <div ref={ref}>
        {near && props.ready ? (
          <MapView {...props} />
        ) : (
          <Skeleton className="h-[65dvh] w-full rounded-xl" />
        )}
      </div>
    </CaseSection>
  );
}

function LazyReport({ caseId }: { caseId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const near = useNearViewport(ref, "400px");
  return (
    <div ref={ref}>
      <ReportSection caseId={caseId} visible={near} />
    </div>
  );
}

/** The whole investigation on one guided, scrollable page. */
export function CasePage({ caseId, replayScan = false }: { caseId: string; replayScan?: boolean }) {
  const { params } = useUrlState();
  const caseQuery = useCase(caseId);
  const jobs = useJobs(caseId);
  const findings = useFindings(caseId);
  const correlations = useCorrelations(caseId);
  const entities = useEntities(caseId);
  useCaseRealtime(caseId);
  useWakeStuckJobs(caseId, jobs.data);

  const c = caseQuery.data;
  const jobList = useMemo(() => jobs.data ?? [], [jobs.data]);
  const findingList = useMemo(() => findings.data ?? [], [findings.data]);
  const correlationList = useMemo(() => correlations.data ?? [], [correlations.data]);
  const entityList = useMemo(() => entities.data ?? [], [entities.data]);
  const hasPeople =
    (c?.identifiers.some((i) => i.type === "name") ?? false) ||
    jobList.some((j) => j.target_type === "name");
  const readOnly = useReadOnly();
  // Next steps only offers actions (new searches), so the read-only view leaves it out.
  const sections = visibleSections(hasPeople).filter((s) => !readOnly || s !== "next");
  const active = useScrollSpy(sections);
  const foundCount = useMemo(
    () => groupFindings(findingList, correlationList).reduce((n, g) => n + g.items.length, 0),
    [findingList, correlationList],
  );
  // automatic same_account merges are never questions
  const links = correlationList.filter((x) => x.type !== "same_account");
  const pending = links.filter((x) => x.status === "pending").length;
  const steps = deriveSteps({
    jobs: jobList,
    pendingLinks: pending,
    totalLinks: links.length,
    results: findingList.filter((f) => f.status === "found").length,
  });
  const progress = sourceProgress(jobList);
  const ready = !findings.isPending && !correlations.isPending && !jobs.isPending;
  const counts: Partial<Record<SectionId, number>> = {
    found: foundCount,
    links: pending,
  };

  // Land on the section the URL asks for (#links, ?section=map, or an old ?tab=review link).
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !ready || !c) return;
    landed.current = true;
    const hash = window.location.hash.replace(/^#/, "");
    const target = hash === SCAN_ANCHOR ? SCAN_ANCHOR : sectionFromUrl(params, hash, hasPeople);
    if (!target || (target === "summary" && hash !== "summary")) return;
    const id = target;
    const land = () => document.getElementById(id)?.scrollIntoView({ block: "start" });
    requestAnimationFrame(land);
    // the score and other late data can push the section down; settle once more
    const settle = window.setTimeout(() => {
      const top = document.getElementById(id)?.getBoundingClientRect().top ?? 0;
      if (Math.abs(top - 144) > 24) land();
    }, 700);
    return () => window.clearTimeout(settle);
  }, [ready, c, params, hasPeople]);

  if (caseQuery.isPending) return <CaseSkeleton />;
  if (caseQuery.isError) {
    return (
      <ErrorState
        title="Could not load this investigation"
        error={caseQuery.error}
        onRetry={() => void caseQuery.refetch()}
      />
    );
  }
  if (!c) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Investigation not found"
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to investigations</Link>
          </Button>
        }
      >
        It may have been deleted, or it belongs to another browser session. Investigations are only
        visible to the session that started them.
      </EmptyState>
    );
  }

  return (
    <div className="pb-24">
      <div data-print-unless-report>
        <CaseHeader c={c} />
      </div>

      <div
        data-print="hide"
        data-sticky
        className="glass sticky top-14 z-30 -mx-4 mt-6 border-b border-border px-4 py-3 sm:-mx-6 sm:px-6"
      >
        <div className="flex items-center gap-6">
          <p
            className="hidden w-44 shrink-0 truncate font-display text-lg lg:block"
            title={caseDisplayTitle(c)}
          >
            {caseDisplayTitle(c)}
          </p>
          <div className="min-w-0 flex-1">
            <ProgressRail steps={steps} scanning={progress.scanning} />
          </div>
        </div>
        <div className="mt-2.5 lg:hidden">
          <SectionNav
            sections={sections}
            active={active}
            counts={counts}
            orientation="horizontal"
          />
        </div>
      </div>

      <div className="mt-8 lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block" data-print="hide">
          <div className="sticky top-44">
            <SectionNav
              sections={sections}
              active={active}
              counts={counts}
              orientation="vertical"
            />
          </div>
        </aside>
        <div className="min-w-0 space-y-12">
          <div data-print-unless-report>
            <ScanPanel
              caseId={caseId}
              jobs={jobList}
              findings={findingList}
              loading={jobs.isPending}
              replay={replayScan}
              target={c.identifiers[0] ?? null}
            />
          </div>
          <SummarySection
            c={c}
            findings={findingList}
            correlations={correlationList}
            jobs={jobList}
            loading={!ready}
          />
          <FoundSection
            caseId={caseId}
            findings={findingList}
            correlations={correlationList}
            loading={findings.isPending}
            error={findings.isError ? findings.error : null}
            onRetry={() => void findings.refetch()}
            scanning={progress.scanning}
          />
          <LinksSection
            caseId={caseId}
            correlations={correlationList}
            findings={findingList}
            loading={correlations.isPending || findings.isPending}
            error={correlations.isError ? correlations.error : null}
            onRetry={() => void correlations.refetch()}
            active={active === "links"}
            scanning={progress.scanning}
          />
          {hasPeople ? <PeopleSection caseId={caseId} /> : null}
          <MapSection
            c={c}
            findings={findingList}
            correlations={correlationList}
            entities={entityList}
            ready={ready && !entities.isPending}
          />
          {readOnly ? null : (
            <NextStepsSection
              c={c}
              entities={entityList}
              findings={findingList}
              correlations={correlationList}
              jobs={jobList}
              loading={entities.isPending}
            />
          )}
          <HistorySection c={c} jobs={jobList} findings={findingList} loading={!ready} />
          <LazyReport caseId={caseId} />
        </div>
      </div>
      <FindingSheet caseId={caseId} />
    </div>
  );
}
