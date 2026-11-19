"use client";

import { FileQuestion } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCase, useCaseRealtime, useJobs, useWakeStuckJobs } from "@/lib/query/hooks";
import { useUrlState } from "@/lib/use-url-state";
import { CaseHeader } from "./case-header";
import { FindingSheet } from "./findings/finding-sheet";
import { FindingsTab } from "./findings/findings-tab";
import { JobsPanel } from "./jobs/jobs-panel";
import { OverviewTab } from "./overview/overview-tab";
import { ReportTab } from "./report/report-tab";
import { ReviewTab } from "./review/review-tab";
import { PeopleTab } from "./people/people-tab";
import { parseTab, WorkspaceTabs, type WorkspaceTab } from "./tabs";
import { TimelineTab } from "./timeline/timeline-tab";

// React Flow measures the DOM, so the graph only ever renders in the browser.
const GraphTab = dynamic(() => import("./graph/graph-tab").then((m) => m.GraphTab), {
  ssr: false,
  loading: () => <Skeleton className="h-[60dvh] w-full" />,
});

export function WorkspaceSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading case">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-80 max-w-full" />
      <Skeleton className="h-5 w-64 max-w-full" />
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function TabPanel({ tab, caseId }: { tab: WorkspaceTab; caseId: string }) {
  switch (tab) {
    case "overview":
      return <OverviewTab caseId={caseId} />;
    case "people":
      return <PeopleTab caseId={caseId} />;
    case "findings":
      return <FindingsTab caseId={caseId} />;
    case "graph":
      return <GraphTab caseId={caseId} />;
    case "timeline":
      return <TimelineTab caseId={caseId} />;
    case "review":
      return <ReviewTab caseId={caseId} />;
    case "report":
      return <ReportTab caseId={caseId} />;
  }
}

export function Workspace({ caseId }: { caseId: string }) {
  const { params } = useUrlState();
  const caseQuery = useCase(caseId);
  const hasPeople = caseQuery.data?.identifiers.some((i) => i.type === "name") ?? false;
  const tab = parseTab(params.get("tab"), hasPeople);
  const jobs = useJobs(caseId);
  useCaseRealtime(caseId);
  useWakeStuckJobs(caseId, jobs.data);

  if (caseQuery.isPending) return <WorkspaceSkeleton />;
  if (caseQuery.isError) {
    return (
      <ErrorState
        title="Could not load this case"
        error={caseQuery.error}
        onRetry={() => void caseQuery.refetch()}
      />
    );
  }
  if (!caseQuery.data) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="Case not found"
        action={
          <Button asChild variant="outline">
            <Link href="/">Back to cases</Link>
          </Button>
        }
      >
        It may have been deleted, or it belongs to another session. Cases are only visible to the
        session that created them.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4 pb-16">
      <CaseHeader c={caseQuery.data} />
      <WorkspaceTabs caseId={caseId} active={tab} hasPeople={hasPeople} />
      <section
        id={`panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="animate-fade-in"
        key={tab}
      >
        <TabPanel tab={tab} caseId={caseId} />
      </section>
      <FindingSheet caseId={caseId} />
      <JobsPanel caseId={caseId} />
    </div>
  );
}
