"use client";

import { ExternalLink, Layers, Pin } from "lucide-react";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { ProvenanceLabel } from "@/components/common/provenance-label";
import { sourcesLine, type CaseAccount } from "@/lib/accounts";
import { compactNumber } from "@/lib/format";
import { accountPlatform, displayHandle } from "@/lib/profile";
import { resolvePlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import { ClampedText, LinkChips, ProfileFacts } from "./profile-bits";
import { sourceNames } from "./result-card";

export function PinToggle({
  pinned,
  label,
  onPin,
}: {
  pinned: boolean;
  label: string;
  onPin: (pinned: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pinned}
      aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`}
      onClick={() => onPin(!pinned)}
      className={cn(
        "relative z-10 shrink-0 rounded-md p-1.5 transition-colors hover:bg-muted",
        pinned
          ? "text-accent"
          : "text-muted-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100",
      )}
    >
      <Pin className={cn("h-4 w-4", pinned && "fill-current")} aria-hidden />
    </button>
  );
}

/** Extra facts some sources give (karma, repositories) that are worth a chip. */
function extraFacts(acc: CaseAccount): string[] {
  const out: string[] = [];
  for (const [key, value] of acc.view.other) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    if (key === "public repos") out.push(`${compactNumber(n)} repositories`);
    if (key === "karma") out.push(`${compactNumber(n)} karma`);
    if (key === "reputation") out.push(`${compactNumber(n)} reputation`);
  }
  return out.slice(0, 2);
}

/**
 * One found ACCOUNT as a person card: the profile picture large and first, with the
 * platform as a badge; then the name, handle and platform; then the bio and a few facts.
 */
export function AccountCard({
  account,
  onOpen,
  onPin,
}: {
  account: CaseAccount;
  onOpen: () => void;
  onPin: (pinned: boolean) => void;
}) {
  const { view } = account;
  const platform = accountPlatform(account);
  const info = resolvePlatform(platform, account.url);
  const handle = displayHandle(account);
  const name = view.fullname ?? handle;
  const pinned = account.findings.some((f) => f.curated);
  // a search snippet repeats the headline facts below; the full snippet is in the sheet
  const bio = view.bio ?? (view.headline ? null : view.snippet);

  return (
    <li className="group relative flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft transition-[border-color,box-shadow] hover:border-input hover:shadow-lift">
      <div className="flex items-start gap-3.5">
        <ProfileAvatar
          src={view.avatarUrl}
          name={name}
          platform={platform}
          url={account.url}
          size="md"
          decorative
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left text-base font-semibold leading-snug after:absolute after:inset-0 after:rounded-xl"
            aria-label={`Open ${info.label} account ${handle}${view.fullname ? `, ${view.fullname}` : ""}`}
          >
            {name}
          </button>
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {view.fullname ? <span className="truncate font-mono text-xs">{handle}</span> : null}
            {view.fullname ? <span aria-hidden>·</span> : null}
            <span className="shrink-0">{info.label}</span>
          </p>
        </div>
        <PinToggle pinned={pinned} label={`${info.label} ${handle}`} onPin={onPin} />
      </div>
      {bio ? <ClampedText text={bio} /> : null}
      <ProfileFacts view={view} extra={extraFacts(account)} />
      <LinkChips links={view.links} />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col gap-1">
          <ProvenanceLabel preview={view.preview} platform={platform} />
          {account.sources.length > 1 ? (
            <p className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Layers className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
              <span className="truncate" title={sourceNames(account.sources)}>
                <span className="font-medium text-foreground">{sourcesLine(account)}</span>
              </span>
            </p>
          ) : null}
        </div>
        {account.url ? (
          <a
            href={account.url}
            target="_blank"
            rel="noreferrer noopener"
            className="relative z-10 inline-flex items-center gap-1 rounded text-xs font-medium text-accent hover:underline"
          >
            Open profile
            <ExternalLink className="h-3 w-3" aria-hidden />
            <span className="sr-only"> on {info.label} (opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    </li>
  );
}
