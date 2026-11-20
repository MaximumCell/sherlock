import { Activity, Flag, Gauge, ShieldAlert, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ProgressBar } from "@/components/common/bits";
import { quotaPercent } from "@/lib/admin/logic";
import type { Overview } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

function Tile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: "warning" | "danger";
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-card p-4">
      <p className="eyebrow flex items-center gap-1.5">
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-accent",
          )}
          aria-hidden
        />
        {label}
      </p>
      <p className="font-display text-4xl leading-tight tracking-tight">{value}</p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
      {children}
    </div>
  );
}

const n = (value: number) => value.toLocaleString("en-GB");

export function StatTiles({ overview }: { overview: Overview }) {
  const { totals, quota, days } = overview;
  const used = quotaPercent(quota.global_used_today, quota.global_limit);
  return (
    <section
      aria-label="Totals"
      className="panel grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-5"
    >
      <Tile
        icon={Activity}
        label="Searches"
        value={n(totals.searches)}
        hint={`Last ${days} days, every attempt`}
      />
      <Tile
        icon={Users}
        label="Visitors"
        value={n(totals.sessions)}
        hint="Sessions that searched"
      />
      <Tile
        icon={ShieldAlert}
        label="Refused"
        value={n(totals.refused)}
        hint={
          totals.searches
            ? `${Math.round((totals.refused / totals.searches) * 100)}% of attempts`
            : "None yet"
        }
        tone={totals.refused > 0 ? "warning" : undefined}
      />
      <Tile
        icon={Flag}
        label="Flagged visitors"
        value={n(totals.flagged_sessions)}
        hint="Warning signs in the last 7 days"
        tone={totals.flagged_sessions > 0 ? "danger" : undefined}
      />
      <Tile
        icon={Gauge}
        label="Quota used today"
        value={`${used}%`}
        hint={`${n(quota.global_used_today)} of ${n(quota.global_limit)} scans`}
        tone={used >= 80 ? "warning" : undefined}
      >
        <ProgressBar
          value={used}
          label="Shared daily scan quota used"
          tone={used >= 80 ? "warning" : "accent"}
          className="mt-1"
        />
      </Tile>
    </section>
  );
}
