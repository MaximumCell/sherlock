"use client";

import { Layers } from "lucide-react";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { ProvenanceLabel } from "@/components/common/provenance-label";
import type { CaseAccount } from "@/lib/accounts";
import { findingTitle } from "@/lib/findings";
import { accountPlatform, displayHandle } from "@/lib/profile";
import { resolvePlatform } from "@/lib/platforms";
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
  pictureMatch = false,
}: {
  account: CaseAccount;
  refs: readonly EvidenceRef[];
  onOpen: () => void;
  compact?: boolean;
  /** The link is about the profile pictures: show them big, side by side. */
  pictureMatch?: boolean;
}) {
  const { view } = account;
  const platform = accountPlatform(account);
  const info = resolvePlatform(platform, account.url);
  const title = info.known
    ? info.label
    : account.findings.length > 1
      ? account.label
      : findingTitle(account.primary);
  const shown = displayHandle(account);
  const isImage = account.primary.identifier_type === "image";
  const person = Boolean(view.fullname || view.avatarUrl);
  // a person's name (or picture) leads; results with no profile (breaches, sites) keep their title
  const name = view.fullname ?? (isImage ? `${title} profile picture` : person ? shown : title);
  const sub = person && !isImage ? title : shown;
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
        className={cn(
          "flex w-full min-w-0 gap-3 rounded-md text-left",
          pictureMatch && !compact ? "flex-col items-center text-center" : "items-center",
        )}
        aria-label={`Open ${title} ${shown}${view.fullname ? `, ${view.fullname}` : ""}`}
      >
        <ProfileAvatar
          src={view.avatarUrl}
          name={name}
          platform={info.known ? platform : null}
          url={account.url}
          size={compact ? "xs" : pictureMatch ? "xl" : "md"}
          decorative
        />
        <span className={cn("min-w-0", pictureMatch && !compact && "max-w-full")}>
          <span className={cn("block truncate font-semibold", compact && "text-sm font-medium")}>
            {name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {view.fullname && !isImage ? <span className="font-mono">{shown} · </span> : null}
            <span className={cn((!person || isImage) && "font-mono")}>{sub}</span>
          </span>
        </span>
      </button>
      {!compact && view.preview ? (
        <div className={cn("mt-2", pictureMatch && "text-center")}>
          <ProvenanceLabel preview={view.preview} platform={platform} />
        </div>
      ) : null}
      {account.sources.length > 1 ? (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Layers className="h-3.5 w-3.5 text-success" aria-hidden />
          One account, confirmed by {account.sources.length} sources
        </p>
      ) : null}
      {!compact && (view.bio ?? view.headline) ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{view.bio ?? view.headline}</p>
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
