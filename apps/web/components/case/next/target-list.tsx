"use client";

import { RotateCw } from "lucide-react";
import { TargetIcon } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import type { AccountIndex } from "@/lib/accounts";
import { DETECTION_LABEL } from "@/lib/detect-target";
import { followUpOutcome, suggestionSource } from "@/lib/follow-up";
import { useScan } from "@/lib/query/mutations";
import type { Case, Entity, Finding, Job, TargetType } from "@/lib/types";
import { TARGET_TYPES } from "@/lib/types";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isType = (t: string): t is TargetType => (TARGET_TYPES as readonly string[]).includes(t);

interface Row {
  type: TargetType;
  value: string;
  /** Where a follow-up search came from; null for what was typed in. */
  origin: string | null;
}

/**
 * The identifiers this case searched (typed in, then follow-ups from Next steps), with
 * their state, what each finished search added, and a one-click rescan.
 */
export function TargetList({
  c,
  jobs,
  entities,
  findings,
  accounts,
}: {
  c: Case;
  jobs: Job[];
  entities: Entity[];
  findings: Finding[];
  accounts: AccountIndex;
}) {
  const scan = useScan(c.id);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const rows: Row[] = c.identifiers.map((i) => ({ type: i.type, value: i.value, origin: null }));
  for (const e of entities) {
    if (!e.scanned || e.is_seed || !isType(e.kind)) continue;
    if (rows.some((r) => r.type === e.kind && same(r.value, e.value))) continue;
    rows.push({ type: e.kind, value: e.value, origin: suggestionSource(e, byId, accounts) });
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {rows.map((row) => {
        const mine = jobs.filter((j) => same(j.target_value, row.value));
        const running = mine.some((j) => j.status === "queued" || j.status === "running");
        const scanned =
          mine.length > 0 || entities.some((e) => e.scanned && same(e.value, row.value));
        const pending = scan.isPending && scan.variables?.value === row.value;
        const outcome = followUpOutcome(
          { kind: row.type, value: row.value },
          jobs,
          findings,
          accounts,
          row.origin !== null,
        );
        const status = running
          ? "Searching now"
          : mine.length > 0
            ? `Searched with ${mine.length} data source${mine.length === 1 ? "" : "s"}`
            : scanned
              ? "Searched"
              : "Not searched yet";
        return (
          <li key={`${row.type}:${row.value}`} className="flex items-center gap-3 px-4 py-3">
            <TargetIcon type={row.type} className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm" title={row.value}>
                {row.value}
              </p>
              <p className="text-xs text-muted-foreground">
                {DETECTION_LABEL[row.type]} · {status}
                {row.origin ? ` · follow-up: ${row.origin}` : ""}
              </p>
              {outcome?.state === "done" ? (
                <p className="text-xs font-medium text-foreground/80" aria-live="polite">
                  {outcome.text}
                </p>
              ) : null}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={running || pending}
              onClick={() => scan.mutate({ type: row.type, value: row.value })}
              aria-label={`${scanned ? "Search again" : "Search"} ${row.value}`}
            >
              <RotateCw aria-hidden />
              {running ? "Searching" : scanned ? "Search again" : "Search"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
