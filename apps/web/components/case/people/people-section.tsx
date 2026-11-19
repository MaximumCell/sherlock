"use client";

import { Info, LogIn, SearchX, UsersRound } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCandidates, useCase, useJobs, useSession } from "@/lib/query/hooks";
import { useConfirmCandidate } from "@/lib/query/mutations";
import { requestSignIn } from "@/lib/sign-in-prompt";
import { CaseSection } from "../section";
import { CandidateCard } from "./candidate-card";

/** Ranked people for a name search. Picking one adds its identifiers as suggested searches. */
export function PeopleSection({ caseId }: { caseId: string }) {
  return (
    <CaseSection
      id="people"
      title="People"
      description="Several people can share a name. Pick the one you mean and we suggest what to search next."
    >
      <PeopleBody caseId={caseId} />
    </CaseSection>
  );
}

function PeopleBody({ caseId }: { caseId: string }) {
  const c = useCase(caseId);
  const session = useSession();
  const jobs = useJobs(caseId);
  const candidates = useCandidates(caseId);
  const confirm = useConfirmCandidate(caseId);
  const names = [
    ...new Set([
      ...(c.data?.identifiers.filter((i) => i.type === "name").map((i) => i.value) ?? []),
      ...(jobs.data ?? []).filter((j) => j.target_type === "name").map((j) => j.target_value),
    ]),
  ];
  const searching = (jobs.data ?? []).some(
    (j) => j.target_type === "name" && (j.status === "queued" || j.status === "running"),
  );
  const anonymous = session.data?.anonymous ?? true;

  const intro = (
    <div className="flex gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
      <p className="text-muted-foreground">
        Several people can share{" "}
        <span className="font-medium text-foreground">{names.join(", ") || "a name"}</span>. Each card
        groups public profiles that look like the same person and says why. Choosing one records your
        decision and adds its handles and sites to Next steps. It never starts a search on its own.
      </p>
    </div>
  );

  if (candidates.isPending) {
    return (
      <div className="space-y-4" aria-busy="true">
        {intro}
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
    );
  }

  if (candidates.isError) {
    return (
      <ErrorState
        title="Could not load the people"
        error={candidates.error}
        onRetry={() => void candidates.refetch()}
      />
    );
  }

  if (candidates.data === null) {
    return (
      <EmptyState icon={UsersRound} title="People matching is not available yet">
        The scan service does not rank people yet. Name search results still appear under What we
        found.
      </EmptyState>
    );
  }

  const list = candidates.data;
  if (list.length === 0) {
    return (
      <div className="space-y-4">
        {intro}
        <EmptyState
          icon={SearchX}
          title={searching ? "Searching public sources" : "No people to choose from yet"}
          action={
            anonymous ? (
              <Button variant="outline" onClick={() => requestSignIn()}>
                <LogIn aria-hidden />
                Sign in to run name searches
              </Button>
            ) : null
          }
        >
          {searching
            ? "People appear here as the name search finishes."
            : "Search a full name with Add another target. A city, employer or school sharpens the ranking."}
        </EmptyState>
      </div>
    );
  }

  const anyConfirmed = list.some((x) => x.confirmed);
  return (
    <div className="space-y-4">
      {intro}
      <ol className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="People, best match first">
        {list.map((candidate, i) => (
          <li key={candidate.candidate_id} className="min-w-0">
            <CandidateCard
              candidate={candidate}
              rank={i + 1}
              anyConfirmed={anyConfirmed}
              pending={confirm.isPending && confirm.variables === candidate.candidate_id}
              onConfirm={() => confirm.mutate(candidate.candidate_id)}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}
