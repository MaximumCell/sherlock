"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import { TargetIcon } from "@/components/common/bits";
import { EmptyState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DETECTION_LABEL } from "@/lib/detect-target";
import { findingTitle } from "@/lib/findings";
import { useScan } from "@/lib/query/mutations";
import { TARGET_TYPES, type Entity, type Finding, type Job, type TargetType } from "@/lib/types";

const isTargetType = (kind: string): kind is TargetType => (TARGET_TYPES as readonly string[]).includes(kind);

/** Identifiers found in results that have not been searched themselves and were not typed in. */
export function pivotSuggestions(entities: readonly Entity[]): (Entity & { kind: TargetType })[] {
  return entities.filter(
    (e): e is Entity & { kind: TargetType } => !e.scanned && !e.is_seed && isTargetType(e.kind),
  );
}

function why(entity: Entity, source: Finding | undefined): string {
  const where = source ? findingTitle(source) : entity.platform;
  const what = DETECTION_LABEL[entity.kind as TargetType] ?? "an identifier";
  return where
    ? `Your ${where} result mentions ${what} we have not searched yet.`
    : `It showed up in your results as ${what} we have not searched yet.`;
}

/** Suggested next searches as one-click cards, each saying why it is suggested. */
export function SuggestedSearches({
  caseId,
  entities,
  findings,
  jobs,
  loading,
  advanced,
}: {
  caseId: string;
  entities: Entity[];
  findings: Finding[];
  jobs: Job[];
  loading: boolean;
  advanced: boolean;
}) {
  const scan = useScan(caseId);
  const pivots = pivotSuggestions(entities);
  const byId = new Map(findings.map((f) => [f.id, f]));

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    );
  }
  if (pivots.length === 0) {
    return (
      <EmptyState icon={Sparkles} title="No suggestions yet">
        When results mention another email, website, handle or wallet, it appears here as a
        one-click search.
      </EmptyState>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-tour="next-steps">
      {pivots.map((entity) => {
        const running = jobs.some(
          (j) => j.target_value === entity.value && (j.status === "queued" || j.status === "running"),
        );
        const pending = scan.isPending && scan.variables?.value === entity.value;
        return (
          <li key={entity.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <TargetIcon type={entity.kind} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm" title={entity.value}>
                  {entity.value}
                </p>
                <p className="text-sm text-muted-foreground">
                  {why(entity, entity.source_finding_id ? byId.get(entity.source_finding_id) : undefined)}
                </p>
                {advanced ? (
                  <p className="font-mono text-2xs text-muted-foreground">
                    entity {entity.kind} · {entity.id}
                  </p>
                ) : null}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={running || pending}
              onClick={() => scan.mutate({ type: entity.kind, value: entity.value })}
              aria-label={`Search ${entity.value}`}
            >
              {running ? "Searching" : "Search this"}
              <ArrowRight aria-hidden />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
