"use client";

import { ExternalLink, PanelRightOpen, Pin } from "lucide-react";
import { tiltHandlers } from "@/components/motion/tilt";
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
        "relative z-10 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors duration-1 hover:bg-muted",
        pinned ? "text-accent" : "text-muted-foreground hover:text-foreground",
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

/** "Confirmed by 3 sources" as three small linked nodes, so it reads at a glance. */
export function SourceDots({ count }: { count: number }) {
  return (
    <span aria-hidden className="inline-flex items-center">
      {Array.from({ length: Math.min(count, 4) }, (_, i) => (
        <span key={i} className="flex items-center">
          {i > 0 ? <span className="h-px w-1.5 bg-success/60" /> : null}
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
        </span>
      ))}
    </span>
  );
}

/**
 * One found ACCOUNT as a person card: the profile picture large and first, with the
 * platform as a badge; then the name, handle and platform; then the bio and a few facts.
 * Open profile, pin and details sit in a quick-action bar revealed on hover or focus.
 */
export function AccountCard({
  account,
  index = 0,
  onOpen,
  onPin,
}: {
  account: CaseAccount;
  index?: number;
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
    <li
      className="min-w-0 animate-rise-in"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <div
        {...tiltHandlers}
        className="tilt group panel relative flex h-full min-w-0 flex-col gap-3 p-4 hover:border-input hover:shadow-lift"
      >
        <div className="flex items-start gap-3.5">
          <ProfileAvatar
            src={view.avatarUrl}
            name={name}
            platform={platform}
            url={account.url}
            size="lg"
            decorative
          />
          <div className="min-w-0 flex-1 pt-1">
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
            {account.sources.length > 1 ? (
              <p className="mt-1.5 inline-flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                <SourceDots count={account.sources.length} />
                <span className="truncate" title={sourceNames(account.sources)}>
                  {sourcesLine(account)}
                </span>
              </p>
            ) : null}
          </div>
          {pinned ? (
            <Pin className="h-4 w-4 shrink-0 fill-current text-accent" aria-label="Pinned" />
          ) : null}
        </div>
        {bio ? <ClampedText text={bio} /> : null}
        <ProfileFacts view={view} extra={extraFacts(account)} />
        <LinkChips links={view.links} />
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <ProvenanceLabel preview={view.preview} platform={platform} />
          <div
            className="reveal relative z-10 ml-auto flex items-center gap-0.5"
            data-on={pinned || undefined}
          >
            {account.url ? (
              <a
                href={account.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-accent hover:bg-muted"
              >
                Open profile
                <ExternalLink className="h-3 w-3" aria-hidden />
                <span className="sr-only"> on {info.label} (opens in a new tab)</span>
              </a>
            ) : null}
            <PinToggle pinned={pinned} label={`${info.label} ${handle}`} onPin={onPin} />
            <button
              type="button"
              onClick={onOpen}
              aria-label={`Details of ${info.label} ${handle}`}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <PanelRightOpen className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </li>
  );
}
