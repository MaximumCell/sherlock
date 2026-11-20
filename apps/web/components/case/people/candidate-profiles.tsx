"use client";

import { ProfileAvatar } from "@/components/common/profile-avatar";
import { findingTitle, parseFinding } from "@/lib/findings";
import { findingPlatform } from "@/lib/profile";
import { resolvePlatform } from "@/lib/platforms";
import type { Finding } from "@/lib/types";

const MAX = 4;

/**
 * The candidate's profiles side by side: picture, platform badge and name, so photos can be
 * compared at a glance. Profiles with a picture or a name come first.
 */
export function CandidateProfiles({
  findings,
  onOpen,
}: {
  findings: readonly Finding[];
  onOpen: (findingId: string) => void;
}) {
  const items = findings
    .map((f) => ({ f, view: parseFinding(f), platform: findingPlatform(f) }))
    .filter((x) => x.view.avatarUrl || x.view.fullname)
    .sort((a, b) => Number(Boolean(b.view.avatarUrl)) - Number(Boolean(a.view.avatarUrl)))
    .slice(0, MAX);
  if (items.length === 0) return null;
  return (
    <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Profiles of this person">
      {items.map(({ f, view, platform }) => {
        const info = resolvePlatform(platform, view.url);
        const label = info.known ? info.label : findingTitle(f);
        const name = view.fullname ?? f.identifier_value;
        return (
          <li key={f.id} className="min-w-0">
            <button
              type="button"
              onClick={() => onOpen(f.id)}
              aria-label={`Open ${label} profile of ${name}`}
              className="flex w-full min-w-0 flex-col items-center gap-2 rounded-lg border border-border bg-surface/60 p-2.5 text-center transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ProfileAvatar
                src={view.avatarUrl}
                name={name}
                platform={info.known ? platform : null}
                url={view.url}
                size="md"
                decorative
              />
              <span className="w-full min-w-0">
                <span className="block truncate text-xs font-medium">{name}</span>
                <span className="block truncate text-2xs text-muted-foreground">{label}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
