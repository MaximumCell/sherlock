import { ShieldAlert } from "lucide-react";
import { ProgressBar } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { timeAgo } from "@/lib/format";
import type { Exposure } from "@/lib/types";

const LEVELS: Record<
  Exposure["level"],
  { label: string; badge: "success" | "warning" | "danger"; tone: "success" | "warning" | "danger" }
> = {
  low: { label: "Low", badge: "success", tone: "success" },
  moderate: { label: "Moderate", badge: "warning", tone: "warning" },
  high: { label: "High", badge: "danger", tone: "danger" },
  critical: { label: "Critical", badge: "danger", tone: "danger" },
};

/** Rendered only when the case carries an `exposure` object (scoring ships later). */
export function ExposureCard({ exposure }: { exposure: Exposure }) {
  const level = LEVELS[exposure.level];
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
            Exposure summary
          </CardTitle>
          <CardDescription>
            How much a stranger can piece together from public sources
            {exposure.computed_at ? ` · scored ${timeAgo(exposure.computed_at)}` : ""}
          </CardDescription>
        </div>
        <Badge variant={level.badge}>{level.label}</Badge>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-[200px_1fr]">
        <div className="space-y-2">
          <p className="font-mono text-3xl font-semibold tabular-nums">
            {exposure.score}
            <span className="text-base font-normal text-muted-foreground"> / 100</span>
          </p>
          <ProgressBar value={exposure.score} tone={level.tone} label="Exposure score" className="h-2" />
        </div>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {exposure.factors.map((factor) => (
            <li key={factor.label} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{factor.label}</span>
                <span className="block text-xs text-muted-foreground">{factor.detail}</span>
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">+{factor.weight}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
