"use client";

import { PlatformIcon } from "@/components/common/platform-icon";
import { useModules } from "@/lib/query/hooks";

/** A few of the sites the sources look at; they light up in turn, like a sweep. */
const SAMPLE = ["github", "gitlab", "reddit", "hackernews", "bluesky", "gravatar", "devto", "keybase"];

/** "39 sources · live · public data only", with a quiet sweep across sample platform icons. */
export function SourceStrip() {
  const catalogue = useModules();
  const modules = catalogue.data?.modules ?? [];
  const live = modules.filter((m) => m.available).length;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <ul className="flex items-center gap-1" aria-hidden>
        {SAMPLE.map((p, i) => (
          <li
            key={p}
            className="motion-safe:animate-[sweep_4.8s_var(--ease-in-out)_infinite]"
            style={{ animationDelay: `${i * 0.22}s` }}
          >
            <PlatformIcon platform={p} size="sm" />
          </li>
        ))}
      </ul>
      <p className="flex flex-wrap items-center gap-x-2 font-mono text-xs uppercase tracking-[0.12em]">
        <span className="text-foreground">
          {modules.length ? `${modules.length} sources` : "Dozens of sources"}
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-ping" />
            <span className="relative h-1.5 w-1.5 rounded-full bg-success" />
          </span>
          {live ? `${live} live` : "live"}
        </span>
        <span aria-hidden>·</span>
        <span>public data only</span>
      </p>
    </div>
  );
}
