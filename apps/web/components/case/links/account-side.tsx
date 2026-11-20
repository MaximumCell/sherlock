"use client";

import { Layers } from "lucide-react";
import { Avatar } from "@/components/common/bits";
import type { CaseAccount } from "@/lib/accounts";
import { findingTitle } from "@/lib/findings";
import { evidenceLabel } from "@/lib/rules";
import type { EvidenceRef } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Evidence of one account in a link, with human labels (never raw field paths). */
export function accountEvidence(account: CaseAccount, refs: readonly EvidenceRef[]) {
  const byId = new Map(account.findings.map((f) => [f.id, f]));
  const seen = new Set<string>();
  const out: { label: string; value: string }[] = [];
  for (const r of refs) {
    const f = byId.get(r.finding_id);
    if (!f) continue;
    const label = evidenceLabel(r.field, f.identifier_type);
    const key = `${label}|${r.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value: r.value });
  }
  return out;
}

/** One side of a link: an ACCOUNT (however many sources reported it), not a row. */
export function AccountSide({
  account,
  refs,
  onOpen,
  compact = false,
}: {
  account: CaseAccount;
  refs: readonly EvidenceRef[];
  onOpen: () => void;
  compact?: boolean;
}) {
  const { view } = account;
  const title = account.findings.length > 1 ? account.label : findingTitle(account.primary);
  const shown = account.handle ?? account.primary.identifier_value;
  const evidence = accountEvidence(account, refs);
  return (
    <li
      className={cn(
        "min-w-0 border border-border",
        compact ? "rounded-md bg-surface p-2.5" : "rounded-xl bg-surface/60 p-4",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-3 rounded-md text-left"
        aria-label={`Open ${title} ${shown}`}
      >
        <Avatar
          src={view.avatarUrl}
          name={title}
          className={compact ? "h-7 w-7" : "h-11 w-11 rounded-lg"}
        />
        <span className="min-w-0">
          <span className={cn("block truncate font-medium", compact && "text-sm")}>{title}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">{shown}</span>
        </span>
      </button>
      {account.sources.length > 1 ? (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5 text-success" aria-hidden />
          One account, confirmed by {account.sources.length} sources
        </p>
      ) : null}
      {!compact && (view.fullname || view.bio) ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
          {view.fullname ? <span className="text-foreground">{view.fullname}. </span> : null}
          {view.bio}
        </p>
      ) : null}
      {evidence.length > 0 ? (
        <dl
          className={cn("space-y-1.5 border-t border-border", compact ? "mt-2 pt-2" : "mt-3 pt-3")}
        >
          {evidence.map((item) => (
            <div key={`${item.label}|${item.value}`} className="text-sm">
              <dt className="text-xs text-muted-foreground">{item.label}</dt>
              <dd
                className={cn(
                  "break-all font-mono text-xs",
                  !compact && "rounded bg-warning/10 px-1.5 py-0.5",
                )}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
