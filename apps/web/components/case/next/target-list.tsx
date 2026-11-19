"use client";

import { RotateCw } from "lucide-react";
import { TargetIcon } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { DETECTION_LABEL } from "@/lib/detect-target";
import { useScan } from "@/lib/query/mutations";
import type { Case, Entity, Job, TargetType } from "@/lib/types";
import { TARGET_TYPES } from "@/lib/types";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const isType = (t: string): t is TargetType => (TARGET_TYPES as readonly string[]).includes(t);

/** The identifiers this case searched, with their state and a one-click rescan. */
export function TargetList({ c, jobs, entities }: { c: Case; jobs: Job[]; entities: Entity[] }) {
  const scan = useScan(c.id);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {c.identifiers.map((idf) => {
        const mine = jobs.filter((j) => same(j.target_value, idf.value));
        const running = mine.some((j) => j.status === "queued" || j.status === "running");
        const scanned =
          mine.length > 0 || entities.some((e) => e.scanned && same(e.value, idf.value));
        const pending = scan.isPending && scan.variables?.value === idf.value;
        const status = running
          ? "Searching now"
          : mine.length > 0
            ? `Searched with ${mine.length} data source${mine.length === 1 ? "" : "s"}`
            : scanned
              ? "Searched"
              : "Not searched yet";
        return (
          <li key={`${idf.type}:${idf.value}`} className="flex items-center gap-3 px-4 py-3">
            <TargetIcon type={idf.type} className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-sm" title={idf.value}>
                {idf.value}
              </p>
              <p className="text-xs text-muted-foreground">
                {isType(idf.type) ? DETECTION_LABEL[idf.type] : idf.type} · {status}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={running || pending}
              onClick={() => scan.mutate({ type: idf.type, value: idf.value })}
              aria-label={`${scanned ? "Search again" : "Search"} ${idf.value}`}
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
