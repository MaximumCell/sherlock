"use client";

import { RefreshCw, ShieldAlert } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/data/gateway";
import { useExposure, useFindings } from "@/lib/query/hooks";
import { BAND_META, ExposureDial } from "./exposure-dial";
import { ExposureFactorRow } from "./exposure-factor-row";

function Header({ badge }: { badge?: ReactNode }) {
  return (
    <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
      <div className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
          Exposure score
        </CardTitle>
        <CardDescription>How much a stranger can piece together from what was found</CardDescription>
      </div>
      {badge}
    </CardHeader>
  );
}

/** `GET /cases/{id}/exposure`, fetched through the gateway (cold-start retries included). */
export function ExposureCard({ caseId }: { caseId: string }) {
  const exposure = useExposure(caseId);
  const findings = useFindings(caseId);
  const byId = useMemo(() => new Map((findings.data ?? []).map((f) => [f.id, f])), [findings.data]);

  if (exposure.isPending) {
    return (
      <Card aria-busy="true">
        <Header />
        <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
          <Skeleton className="mx-auto h-36 w-36 rounded-full" />
          <div className="space-y-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (exposure.isError) {
    return (
      <Card>
        <Header />
        <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            Could not compute the score. {describeError(exposure.error)}
          </p>
          <Button variant="outline" size="sm" onClick={() => void exposure.refetch()}>
            <RefreshCw aria-hidden />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const data = exposure.data;
  const meta = BAND_META[data.band];
  const scored = data.factors.filter((f) => f.points > 0);
  const zero = data.factors.filter((f) => f.points <= 0);

  return (
    <Card>
      <Header badge={<Badge variant={meta.badge}>{meta.label}</Badge>} />
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-[180px_1fr]">
          <div className="space-y-2 text-center">
            <ExposureDial score={data.score} band={data.band} />
            <p className="text-xs text-muted-foreground">
              From {data.computed_from.findings} found row
              {data.computed_from.findings === 1 ? "" : "s"} and{" "}
              {data.computed_from.approved_correlations} approved link
              {data.computed_from.approved_correlations === 1 ? "" : "s"}
            </p>
          </div>
          {scored.length ? (
            <ul className="divide-y divide-border">
              {scored.map((factor) => (
                <ExposureFactorRow key={factor.key} factor={factor} findings={byId} barClass={meta.bar} />
              ))}
            </ul>
          ) : (
            <p className="self-center text-sm text-muted-foreground">
              Nothing scores yet. Run a scan, then approve the links you trust in Review.
            </p>
          )}
        </div>
        {zero.length ? (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Not contributing:</span>{" "}
            {zero.map((f) => f.label).join(", ")}.
          </p>
        ) : null}
        {data.method ? (
          <p className="border-t border-border pt-3 text-2xs leading-relaxed text-muted-foreground">
            <span className="font-medium">How this is scored.</span> {data.method}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
