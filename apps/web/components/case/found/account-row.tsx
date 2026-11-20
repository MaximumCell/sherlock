"use client";

import { ExternalLink, Layers } from "lucide-react";
import { PlatformIcon } from "@/components/common/platform-icon";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import type { CaseAccount } from "@/lib/accounts";
import { accountPlatform, displayHandle, isBareAccount } from "@/lib/profile";
import { resolvePlatform } from "@/lib/platforms";
import { PinToggle } from "./account-card";

export const BARE_NOTE = "Account exists · no public profile details";

/**
 * One account as a compact row. Bare "account exists" results always look like this, so the
 * rich cards stand out; in the Compact list view every account does.
 */
export function AccountRow({
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
  const bare = isBareAccount(account);
  const pinned = account.findings.some((f) => f.curated);
  const detail = bare
    ? BARE_NOTE
    : [view.fullname, view.headline ?? view.bio ?? view.location].filter(Boolean).join(" · ");

  return (
    <li className="group relative flex min-w-0 animate-rise-in items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 transition-colors duration-1 hover:border-input hover:bg-muted/30">
      {bare ? (
        <PlatformIcon platform={platform} url={account.url} size="lg" />
      ) : (
        <ProfileAvatar
          src={view.avatarUrl}
          name={view.fullname ?? handle}
          platform={platform}
          url={account.url}
          size="sm"
          decorative
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-2">
          <button
            type="button"
            onClick={onOpen}
            className="shrink-0 rounded text-left text-sm font-medium after:absolute after:inset-0 after:rounded-lg"
            aria-label={`Open ${info.label} account ${handle}`}
          >
            {info.label}
          </button>
          <span className="truncate font-mono text-xs text-muted-foreground">{handle}</span>
          {account.sources.length > 1 ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 text-2xs text-success"
              title={`One account, confirmed by ${account.sources.length} sources`}
            >
              <Layers className="h-3 w-3" aria-hidden />
              {account.sources.length}
              <span className="sr-only"> sources</span>
            </span>
          ) : null}
        </p>
        {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      {account.url ? (
        <a
          href={account.url}
          target="_blank"
          rel="noreferrer noopener"
          className="relative z-10 hidden shrink-0 items-center gap-1 rounded text-xs font-medium text-accent hover:underline sm:inline-flex"
        >
          Open profile
          <ExternalLink className="h-3 w-3" aria-hidden />
          <span className="sr-only"> on {info.label} (opens in a new tab)</span>
        </a>
      ) : null}
      {account.url ? (
        <a
          href={account.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`Open profile on ${info.label} (opens in a new tab)`}
          className="relative z-10 shrink-0 rounded p-1.5 text-accent hover:bg-muted sm:hidden"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      ) : null}
      <PinToggle pinned={pinned} label={`${info.label} ${handle}`} onPin={onPin} />
    </li>
  );
}
