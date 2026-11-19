import { Archive, CircleDashed, Eye, LoaderCircle } from "lucide-react";
import { ProgressBar } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import type { DerivedCaseStatus } from "@/lib/case-status";

export function CaseStatusBadge({ status }: { status: DerivedCaseStatus }) {
  switch (status.kind) {
    case "scanning":
      return (
        <div className="flex min-w-28 flex-col gap-1">
          <Badge variant="accent" className="w-fit">
            <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
            Scanning {status.progress ?? 0}%
          </Badge>
          <ProgressBar value={status.progress ?? 0} label="Scan progress" className="h-1" />
        </div>
      );
    case "needs_review":
      return (
        <Badge variant="warning">
          <Eye className="h-3 w-3" aria-hidden />
          {status.pendingReviews} to review
        </Badge>
      );
    case "archived":
      return (
        <Badge variant="muted">
          <Archive className="h-3 w-3" aria-hidden />
          Archived
        </Badge>
      );
    case "idle":
      return (
        <Badge variant="outline">
          <CircleDashed className="h-3 w-3" aria-hidden />
          Idle
        </Badge>
      );
  }
}
