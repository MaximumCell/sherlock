"use client";

import { ChevronDown, ExternalLink } from "lucide-react";
import { useState } from "react";
import { PlatformIcon } from "@/components/common/platform-icon";
import { Button } from "@/components/ui/button";
import type { UncheckedSite } from "@/lib/unchecked";

const SHOWN = 8;

/**
 * "Couldn't check automatically": platforms the search could not answer for, each with the
 * reason in plain words and the exact profile link to open by hand. Never counted as accounts.
 */
export function UncheckedSection({ sites }: { sites: readonly UncheckedSite[] }) {
  const [all, setAll] = useState(false);
  if (sites.length === 0) return null;
  const shown = all ? sites : sites.slice(0, SHOWN);
  return (
    <section aria-labelledby="group-unchecked" className="space-y-3">
      <div className="min-w-0">
        <h3 id="group-unchecked" className="text-xl font-semibold tracking-tight">
          Couldn&apos;t check automatically
          <span className="ml-2 font-mono text-sm font-normal tabular-nums text-muted-foreground">
            {sites.length}
          </span>
        </h3>
        <p className="text-sm text-muted-foreground">
          These sites did not give a clear answer, so we are not saying yes or no. Open the profile
          link yourself to see whether the account exists.
        </p>
      </div>
      <ul
        className="grid grid-cols-1 gap-2 lg:grid-cols-2"
        aria-label="Couldn't check automatically"
      >
        {shown.map((s) => (
          <li
            key={s.key}
            className="flex min-w-0 items-center gap-3 rounded-lg border border-dashed border-border bg-card px-3 py-2"
          >
            <PlatformIcon platform={s.platform} url={s.url} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.text}</p>
            </div>
            {s.url ? (
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  aria-label={`Open the ${s.label} profile in a new tab`}
                >
                  Open profile
                  <ExternalLink aria-hidden />
                </a>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {sites.length > SHOWN ? (
        <Button variant="ghost" size="sm" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${sites.length}`}
          <ChevronDown className={all ? "rotate-180" : undefined} aria-hidden />
        </Button>
      ) : null}
    </section>
  );
}
