"use client";

import { RefreshCw } from "lucide-react";
import { InfoHint } from "@/components/common/info-hint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { describeError } from "@/lib/data/gateway";
import { BAND_MEANING } from "@/lib/remediation";
import type { Exposure } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BAND_META, ExposureDial } from "./exposure-dial";

export function ScoreHint() {
  return (
    <InfoHint label="What is the exposure score?" title="Exposure score">
      <p>
        A 0 to 100 estimate of how much a stranger can piece together about this target from what
        was found. Higher means more is public.
      </p>
      <p>
        It only counts results that were found and links you confirmed, so it changes as you answer
        the link questions. It is not a security audit.
      </p>
    </InfoHint>
  );
}

/** The dial, its band and one line saying what it means. */
export function ScoreCard({
  exposure,
  pending,
  error,
  onRetry,
}: {
  exposure: Exposure | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <div className="panel relative flex h-full flex-col items-center justify-center gap-3 overflow-hidden p-6 text-center">
      <p className="eyebrow flex items-center gap-1">
        Exposure score
        <ScoreHint />
      </p>
      {pending ? (
        <Skeleton className="h-48 w-48 rounded-full" />
      ) : error || !exposure ? (
        <div className="space-y-3 py-4 text-sm">
          <p className="text-muted-foreground">
            The score could not be worked out right now. {describeError(error)}
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden />
            Try again
          </Button>
        </div>
      ) : (
        <>
          <ExposureDial score={exposure.score} band={exposure.band} />
          <p className={cn("font-medium", BAND_META[exposure.band].text)}>
            {BAND_META[exposure.band].label} exposure
          </p>
          <p className="max-w-60 text-sm text-muted-foreground">{BAND_MEANING[exposure.band]}</p>
        </>
      )}
    </div>
  );
}
