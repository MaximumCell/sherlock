"use client";

import { Info, LogIn, SearchX, UsersRound } from "lucide-react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCandidates, useCase, useJobs, useSession } from "@/lib/query/hooks";
import { useConfirmCandidate } from "@/lib/query/mutations";
import { requestSignIn } from "@/lib/sign-in-prompt";
import { CandidateCard } from "./candidate-card";

/** Ranked people for a name search. Picking one adds its identifiers as pivot suggestions. */
export function PeopleTab({ caseId }: { caseId: string }) {
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
        groups public profiles that look like the same person and says why. Confirming one records your
        choice and adds its handles and sites to the pivot suggestions on Overview; it never starts a scan
        on its own.
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
        title="Could not load candidates"
        error={candidates.error}
        onRetry={() => void candidates.refetch()}
      />
    );
  }

  if (candidates.data === null) {
    return (
      <EmptyState icon={UsersRound} title="People matching is not available yet">
        The scan service does not offer candidate ranking yet. Name-search findings still appear in the
        Findings tab.
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
          title={searching ? "Searching public sources…" : "No candidates yet"}
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
            ? "Candidates appear here as the name search finishes."
            : "Run a name search from Overview. Adding a city, employer or school as hints sharpens the ranking."}
        </EmptyState>
      </div>
    );
  }

  const anyConfirmed = list.some((x) => x.confirmed);
  return (
    <div className="space-y-4">
      {intro}
      <ol className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="Candidates, best match first">
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
