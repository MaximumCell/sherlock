"use client";

import { ChevronDown, ListFilter, Pin, SearchCheck } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CaseAccount } from "@/lib/accounts";
import { groupFindings, groupOf, showAllLabel, type FindingGroup } from "@/lib/finding-groups";
import { resolvePlatform } from "@/lib/platforms";
import { accountPlatform } from "@/lib/profile";
import { useCurate } from "@/lib/query/mutations";
import type { Correlation, Finding } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { CaseSection } from "../section";
import { AccountGroupBody, MissesNote, ViewToggle, useCompactView } from "./account-group";
import { ResultCard } from "./result-card";
import { CLEAR_RESULT_FILTERS, ResultsExplorer } from "./results-explorer";

const HIGHLIGHTS = 6;
const FILTER_KEYS = [
  "results",
  "q",
  "group",
  "module",
  "platform",
  "category",
  "curated",
  "misses",
  "show",
  "page",
];

const PERSON_GROUPS = new Set(["accounts", "names"]);

function GroupBlock({
  group,
  misses,
  compact,
  onCompact,
  onShowAll,
  onOpen,
  onPin,
}: {
  group: FindingGroup;
  /** Platforms in this group that were checked and had no account. */
  misses: string[];
  compact: boolean;
  onCompact: (compact: boolean) => void;
  onShowAll: () => void;
  onOpen: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}) {
  const person = PERSON_GROUPS.has(group.id);
  const pin = (acc: CaseAccount, p: boolean) =>
    (p ? [acc.primary] : acc.findings.filter((f) => f.curated)).forEach((f) => onPin(f.id, p));
  return (
    <section aria-labelledby={`group-${group.id}`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`group-${group.id}`} className="text-xl font-semibold tracking-tight">
            {group.title}
            <span className="ml-2 font-mono text-sm font-normal tabular-nums text-muted-foreground">
              {group.items.length}
            </span>
          </h3>
          <p className="text-sm text-muted-foreground">{group.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {person ? <ViewToggle compact={compact} onChange={onCompact} /> : null}
          {group.items.length > HIGHLIGHTS || group.misses > 0 ? (
            <Button variant="ghost" size="sm" onClick={onShowAll}>
              {showAllLabel(group)}
              <ChevronDown aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {person ? (
        <AccountGroupBody
          items={group.items}
          compact={compact}
          onOpen={(acc) => onOpen(acc.primary.id)}
          onPin={pin}
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {group.items.slice(0, HIGHLIGHTS).map((acc, i) => (
            <ResultCard
              key={acc.key}
              index={i}
              account={acc}
              onOpen={() => onOpen(acc.primary.id)}
              onPin={(p) => pin(acc, p)}
            />
          ))}
        </ul>
      )}
      {person ? <MissesNote platforms={misses} /> : null}
    </section>
  );
}

/** Platforms of a group's not-found rows that no found account of the group covers. */
function missedPlatforms(findings: readonly Finding[], group: FindingGroup): string[] {
  const found = new Set(group.items.map((a) => resolvePlatform(accountPlatform(a)).key));
  return findings
    .filter((f) => f.status === "not_found" && groupOf(f) === group.id)
    .map((f) => f.platform)
    .filter((p) => !found.has(resolvePlatform(p).key));
}

/** Results grouped into human categories, with the full filterable list one click away. */
export function FoundSection({
  caseId,
  findings,
  correlations,
  loading,
  error,
  onRetry,
  scanning,
}: {
  caseId: string;
  findings: Finding[];
  correlations: Correlation[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  scanning: boolean;
}) {
  const { params, set } = useUrlState();
  const curate = useCurate(caseId);
  const [compact, setCompact] = useCompactView();
  const groups = useMemo(() => groupFindings(findings, correlations), [findings, correlations]);
  const explorerOpen = FILTER_KEYS.some((k) => params.get(k));
  const pinned = findings.filter((f) => f.curated).length;
  const found = groups.reduce((n, g) => n + g.items.length, 0);

  const openExplorer = (patch: Record<string, string | null> = {}) => {
    set({ ...CLEAR_RESULT_FILTERS, results: "1", ...patch });
    requestAnimationFrame(() =>
      document.getElementById("all-results")?.scrollIntoView({ block: "start" }),
    );
  };

  return (
    <CaseSection
      id="found"
      title="What we found"
      description={
        found
          ? `${found} public result${found === 1 ? "" : "s"}, grouped by kind. An account several sources confirmed is one card. Open any card for every detail, or pin the ones that matter.`
          : undefined
      }
      actions={
        findings.length ? (
          <>
            {pinned ? (
              <Button variant="outline" size="sm" onClick={() => openExplorer({ curated: "1" })}>
                <Pin aria-hidden />
                {pinned} pinned
              </Button>
            ) : null}
            <Button
              variant={explorerOpen ? "secondary" : "outline"}
              size="sm"
              aria-expanded={explorerOpen}
              onClick={() => (explorerOpen ? set(CLEAR_RESULT_FILTERS) : openExplorer())}
            >
              <ListFilter aria-hidden />
              {explorerOpen ? "Hide full list" : "Browse all results"}
            </Button>
          </>
        ) : null
      }
    >
      {error ? (
        <ErrorState title="Could not load the results" error={error} onRetry={onRetry} />
      ) : loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="panel space-y-3 p-4">
              <div className="flex gap-3">
                <Skeleton className="h-20 w-20 rounded-2xl" />
                <div className="flex-1 space-y-2 pt-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : findings.length === 0 ? (
        <EmptyState
          icon={SearchCheck}
          title={scanning ? "Results are on their way" : "No results yet"}
        >
          {scanning
            ? "Each data source adds its results here as soon as it finishes. Watch Scan progress above."
            : "Results appear here after a search. Use Add another target in the menu above to start one."}
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {explorerOpen ? (
            <ResultsExplorer caseId={caseId} findings={findings} correlations={correlations} />
          ) : null}
          <div className={cn("space-y-10", explorerOpen && "border-t border-border pt-8")}>
            {groups.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every source finished without a public result. Browse all results to see what was
                checked.
              </p>
            ) : (
              groups.map((g) => (
                <GroupBlock
                  key={g.id}
                  group={g}
                  misses={missedPlatforms(findings, g)}
                  compact={compact}
                  onCompact={setCompact}
                  onShowAll={() =>
                    openExplorer({
                      group: g.id,
                      show: g.misses ? "all" : null,
                    })
                  }
                  onOpen={(id) => set({ finding: id })}
                  onPin={(id, p) => curate.mutate({ findingId: id, curated: p })}
                />
              ))
            )}
          </div>
        </div>
      )}
    </CaseSection>
  );
}
