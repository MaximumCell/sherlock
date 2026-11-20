"use client";

import { useMemo } from "react";
import { CountUp } from "@/components/motion/count-up";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { findingTitle, parseFinding } from "@/lib/findings";
import { resolvePlatform } from "@/lib/platforms";
import { findingPlatform } from "@/lib/profile";
import type { Finding } from "@/lib/types";
import type { ScanTile, TickerItem } from "@/lib/ui/scanner";
import { ScannerOrbit, SourceTile } from "./scanner-orbit";

/** "GitHub · account found", newest first, each arriving with its picture. */
function Ticker({ items, findings }: { items: TickerItem[]; findings: Map<string, Finding> }) {
  return (
    <div className="min-w-0 space-y-3">
      <p className="eyebrow">Just found</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Results appear here the moment a source finds one.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Most recent results">
          {items.map((item) => {
            const f = findings.get(item.id);
            const view = f ? parseFinding(f) : null;
            const platform = resolvePlatform(f ? findingPlatform(f) : item.platform);
            const label = platform.known || !f ? platform.label : findingTitle(f);
            return (
              <li key={item.id} className="flex min-w-0 animate-rise-in items-center gap-2.5">
                <span className="animate-tick-in">
                  <ProfileAvatar
                    src={view?.avatarUrl}
                    name={view?.fullname ?? label}
                    platform={f ? findingPlatform(f) : item.platform}
                    size="xs"
                    decorative
                  />
                </span>
                <span className="min-w-0 truncate text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground"> · {item.what}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The scan in progress: a big counter, the sources in orbit around the target (a grid on
 * small screens), and a live ticker of what was just found.
 */
export function ScannerStage({
  tiles,
  done,
  found,
  failed,
  ticker,
  findings,
  targetType,
  targetValue,
  actions,
}: {
  tiles: ScanTile[];
  done: number;
  found: number;
  failed: number;
  ticker: TickerItem[];
  findings: Finding[];
  targetType: string;
  targetValue: string;
  actions: React.ReactNode;
}) {
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const total = tiles.length;
  return (
    <div className="grid grid-cols-1 gap-8 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)_minmax(0,1fr)] lg:items-center">
      <div className="space-y-5">
        <p className="eyebrow flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse"
            aria-hidden
          />
          Scanning public sources
        </p>
        <p className="font-display leading-none tracking-tight" aria-hidden>
          <CountUp value={done} className="inline-block min-w-[2ch] text-right text-7xl" />
          <span className="ml-3 text-3xl text-muted-foreground">of {total}</span>
        </p>
        <dl className="grid max-w-xs grid-cols-2 gap-3 text-sm">
          <div className="border-l border-accent/60 pl-3">
            <dt className="text-muted-foreground">Found so far</dt>
            <dd className="font-mono text-lg tabular-nums">
              <CountUp value={found} />
            </dd>
          </div>
          <div className="border-l border-border pl-3">
            <dt className="text-muted-foreground">Could not check</dt>
            <dd
              className={
                failed
                  ? "font-mono text-lg tabular-nums text-warning"
                  : "font-mono text-lg tabular-nums"
              }
            >
              {failed}
            </dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>

      <div className="hidden sm:block">
        <ScannerOrbit tiles={tiles} targetType={targetType} targetValue={targetValue} />
      </div>
      <ul aria-hidden className="grid grid-cols-6 gap-2.5 sm:hidden">
        {tiles.map((t) => (
          <li key={t.id} className="flex justify-center">
            <SourceTile tile={t} size="sm" />
          </li>
        ))}
      </ul>

      <Ticker items={ticker} findings={byId} />
    </div>
  );
}
