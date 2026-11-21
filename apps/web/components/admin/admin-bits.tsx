"use client";

import { Ban, Eye, Network } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { TargetIcon } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  OUTCOME_LABELS,
  OUTCOME_TONES,
  adminCaseHref,
  countryFlag,
  severityTone,
  sessionName,
  sharedOriginLabel,
  userAgentLabel,
} from "@/lib/admin/logic";
import type { MisuseFlag, SearchOutcome, SessionBrief } from "@/lib/admin/types";
import { useFlag } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export const HIDE_TARGETS_KEY = "sherlock.admin.hide-targets";

/** The "Hide targets" preference (remembered per browser, off by default). */
export function useHideTargets() {
  return useFlag(HIDE_TARGETS_KEY, false);
}

/** "View case": the read-only case view (every opening is logged on the case). */
export function ViewCaseLink({ caseId, label }: { caseId: string; label?: string }) {
  const pathname = usePathname();
  return (
    <Link
      href={adminCaseHref(pathname, caseId)}
      aria-label={label ? `View case ${label}` : "View case"}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Eye className="h-3.5 w-3.5" aria-hidden />
      View case
    </Link>
  );
}

export function OutcomeBadge({ outcome }: { outcome: SearchOutcome }) {
  return <Badge variant={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Badge>;
}

export function FlagBadge({ flag }: { flag: MisuseFlag }) {
  return (
    <Badge variant={severityTone(flag.severity)} className="whitespace-normal text-left">
      {flag.label}
    </Badge>
  );
}

/**
 * A searched target. Other people's searches are sensitive: with "Hide targets" on, the value is
 * blurred until hovered, focused or clicked.
 */
export function SensitiveTarget({
  type,
  value,
  className,
}: {
  type: string;
  value: string;
  className?: string;
}) {
  const [hide] = useHideTargets();
  const [revealed, setRevealed] = useState(false);
  const blurred = hide && !revealed;
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <TargetIcon type={type} className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">{type}: </span>
      {hide ? (
        <button
          type="button"
          onClick={() => setRevealed((v) => !v)}
          aria-label={blurred ? `Show hidden ${type}` : `${value} (click to hide)`}
          className={cn(
            "min-w-0 truncate rounded-sm font-mono text-sm transition-[filter] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            blurred && "select-none blur-[5px] hover:blur-none focus-visible:blur-none",
          )}
        >
          {value}
        </button>
      ) : (
        <span className="min-w-0 truncate font-mono text-sm" title={value}>
          {value}
        </span>
      )}
    </span>
  );
}

/** Short session label: name, browser, country flag and a shared-origin marker. */
export function SessionLabel({
  session,
  userId,
  compact = false,
}: {
  session: SessionBrief | null;
  userId: string;
  compact?: boolean;
}) {
  if (!session) {
    return (
      <span className="text-xs text-muted-foreground">Unknown session {userId.slice(0, 8)}</span>
    );
  }
  const shared = sharedOriginLabel(session);
  const flagEmoji = countryFlag(session.country);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
      <span
        className={cn(
          "truncate font-medium text-foreground",
          session.is_anonymous && "font-mono font-normal",
        )}
      >
        {sessionName(session)}
      </span>
      {!compact ? <span className="truncate">{userAgentLabel(session.user_agent)}</span> : null}
      {flagEmoji ? (
        <span
          role="img"
          aria-label={`Country ${session.country}`}
          title={session.country ?? undefined}
        >
          {flagEmoji}
        </span>
      ) : null}
      {shared ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-label={shared}
              className="inline-flex items-center gap-0.5 rounded-full border border-warning/30 bg-warning/10 px-1.5 text-2xs text-warning"
            >
              <Network className="h-3 w-3" aria-hidden />
              {session.origin_sessions}
            </span>
          </TooltipTrigger>
          <TooltipContent>{shared}</TooltipContent>
        </Tooltip>
      ) : null}
      {session.blocked ? (
        <span className="inline-flex items-center gap-0.5 text-danger">
          <Ban className="h-3 w-3" aria-hidden />
          Blocked
        </span>
      ) : null}
    </span>
  );
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
