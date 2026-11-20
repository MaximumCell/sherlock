"use client";

import { LayoutGrid, List } from "lucide-react";
import { useMemo } from "react";
import { PlatformIcon } from "@/components/common/platform-icon";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { CaseAccount } from "@/lib/accounts";
import { useFlag } from "@/lib/preferences";
import { isBareAccount, sortRichFirst } from "@/lib/profile";
import { resolvePlatform } from "@/lib/platforms";
import { AccountCard } from "./account-card";
import { AccountRow, BARE_NOTE } from "./account-row";

export const COMPACT_KEY = "sherlock.results-compact";
const CARDS = 9;
const ROWS = 8;
const LIST_ROWS = 14;

/** Cards / Compact list, remembered per browser. */
export function useCompactView(): [boolean, (compact: boolean) => void] {
  return useFlag(COMPACT_KEY);
}

export function ViewToggle({
  compact,
  onChange,
}: {
  compact: boolean;
  onChange: (compact: boolean) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={compact ? "list" : "cards"}
      onValueChange={(v) => v && onChange(v === "list")}
      aria-label="How to show accounts"
      className="rounded-lg border border-border p-0.5"
    >
      <ToggleGroupItem value="cards" aria-label="Cards">
        <LayoutGrid aria-hidden />
        <span className="hidden sm:inline">Cards</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="list" aria-label="Compact list">
        <List aria-hidden />
        <span className="hidden sm:inline">Compact list</span>
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

/** "Not found on 8 other sites: Instagram, TikTok, …" as one neutral line. */
export function MissesNote({ platforms }: { platforms: readonly string[] }) {
  const labels = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const p of platforms) {
      const info = resolvePlatform(p);
      if (!byKey.has(info.key)) byKey.set(info.key, p);
    }
    return [...byKey.values()];
  }, [platforms]);
  if (labels.length === 0) return null;
  const shown = labels.slice(0, 6);
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>
        No account found on {labels.length} other site{labels.length === 1 ? "" : "s"} checked:
      </span>
      {shown.map((p) => (
        <span key={p} className="inline-flex items-center gap-1">
          <PlatformIcon platform={p} size="xs" className="opacity-70" />
          {resolvePlatform(p).label}
        </span>
      ))}
      {labels.length > shown.length ? <span>and {labels.length - shown.length} more</span> : null}
    </p>
  );
}

/**
 * The accounts of one group: rich profiles as cards (picture, name and details first),
 * bare "account exists" results as compact rows below them, or everything as rows.
 */
export function AccountGroupBody({
  items,
  compact,
  onOpen,
  onPin,
}: {
  items: CaseAccount[];
  compact: boolean;
  onOpen: (acc: CaseAccount) => void;
  onPin: (acc: CaseAccount, pinned: boolean) => void;
}) {
  const sorted = useMemo(() => sortRichFirst(items), [items]);
  const row = (acc: CaseAccount) => (
    <AccountRow
      key={acc.key}
      account={acc}
      onOpen={() => onOpen(acc)}
      onPin={(p) => onPin(acc, p)}
    />
  );
  if (compact) {
    return (
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2" aria-label="Accounts">
        {sorted.slice(0, LIST_ROWS).map(row)}
      </ul>
    );
  }
  const rich = sorted.filter((a) => !isBareAccount(a)).slice(0, CARDS);
  const bare = sorted.filter(isBareAccount);
  return (
    <div className="space-y-4">
      {rich.length ? (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Profiles">
          {rich.map((acc) => (
            <AccountCard
              key={acc.key}
              account={acc}
              onOpen={() => onOpen(acc)}
              onPin={(p) => onPin(acc, p)}
            />
          ))}
        </ul>
      ) : null}
      {bare.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {BARE_NOTE} ({bare.length})
          </p>
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2" aria-label={BARE_NOTE}>
            {bare.slice(0, ROWS).map(row)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
