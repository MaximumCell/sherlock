import { CircleCheck, CircleHelp, CircleX, Eye } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { VERDICT_META, sortChecks, type GeoCheck, type Verdict } from "@/lib/geo";
import { cn } from "@/lib/utils";

const ICON: Record<Verdict, typeof CircleCheck> = {
  consistent: CircleCheck,
  inconsistent: CircleX,
  cant_tell: CircleHelp,
};
const ICON_TONE: Record<Verdict, string> = {
  consistent: "text-success",
  inconsistent: "text-danger",
  cant_tell: "text-muted-foreground",
};

/** Each check on its own: verdict, why, and what to look at in the photo. No overall score. */
export function CheckList({ checks }: { checks: GeoCheck[] }) {
  if (checks.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No checks yet. Add where and when the photo is said to be from, or wait for the photo&apos;s
        own data to be read.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Checks">
      {sortChecks(checks).map((c) => {
        const Icon = ICON[c.verdict];
        const meta = VERDICT_META[c.verdict];
        return (
          <li key={c.key} className="flex gap-3 p-3.5" data-verdict={c.verdict}>
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", ICON_TONE[c.verdict])} aria-hidden />
            <div className="min-w-0 space-y-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-medium">{c.title}</span>
                <Badge variant={meta.tone}>{meta.label}</Badge>
              </p>
              <p className="text-sm text-muted-foreground">{c.reason}</p>
              {c.lookFor ? (
                <p className="flex gap-1.5 text-sm">
                  <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="sr-only">What to look at: </span>
                    {c.lookFor}
                  </span>
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
