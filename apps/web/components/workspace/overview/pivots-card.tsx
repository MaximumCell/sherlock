"use client";

import { Play, Sparkles } from "lucide-react";
import { TargetIcon } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useScan } from "@/lib/query/mutations";
import { TARGET_TYPES, type Entity, type Job, type TargetType } from "@/lib/types";

const isTargetType = (kind: string): kind is TargetType =>
  (TARGET_TYPES as readonly string[]).includes(kind);

/** Entities found during scans that have not been scanned themselves and were not entered by hand. */
export function pivotSuggestions(entities: readonly Entity[]): (Entity & { kind: TargetType })[] {
  return entities.filter(
    (e): e is Entity & { kind: TargetType } => !e.scanned && !e.is_seed && isTargetType(e.kind),
  );
}

export function PivotsCard({
  caseId,
  entities,
  jobs,
  loading,
}: {
  caseId: string;
  entities: Entity[];
  jobs: Job[];
  loading: boolean;
}) {
  const scan = useScan(caseId);
  const pivots = pivotSuggestions(entities);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
          Pivot suggestions
        </CardTitle>
        <CardDescription>
          Identifiers discovered in findings that have not been scanned yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : pivots.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nothing to pivot on yet. New leads appear here as scans finish.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {pivots.map((entity) => {
              const queued = jobs.some(
                (j) =>
                  j.target_value === entity.value &&
                  (j.status === "queued" || j.status === "running"),
              );
              const pending = scan.isPending && scan.variables?.value === entity.value;
              return (
                <li key={entity.id} className="flex items-center gap-3 py-2">
                  <TargetIcon type={entity.kind} className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm" title={entity.value}>
                      {entity.value}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {entity.kind}
                      {entity.platform ? ` · seen on ${entity.platform}` : ""}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={queued || pending}
                    onClick={() => scan.mutate({ type: entity.kind, value: entity.value })}
                    aria-label={`Scan ${entity.value}`}
                  >
                    <Play aria-hidden />
                    {queued ? "Scanning" : "Scan"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
