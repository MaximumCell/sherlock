"use client";

import { Hourglass } from "lucide-react";
import { useQueueStatus } from "@/lib/query/hooks";
import { waitingText } from "@/lib/search-refusal";
import type { Job } from "@/lib/types";

/** "Waiting for other searches to finish · N ahead of you", only while that is true. */
export function QueueWaiting({ caseId, jobs }: { caseId: string; jobs: readonly Job[] }) {
  const status = useQueueStatus(caseId, jobs);
  const text = waitingText(status.data);
  if (!text) return null;
  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-border bg-warning/[0.06] px-4 py-3 sm:px-5"
    >
      <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-medium">{text.headline}</p>
        {text.detail ? <p className="text-sm text-muted-foreground">{text.detail}</p> : null}
      </div>
    </div>
  );
}
