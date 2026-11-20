"use client";

import { CircleCheck, ExternalLink, KeyRound } from "lucide-react";
import { useState } from "react";
import { TargetIcon } from "@/components/common/bits";
import { PlatformIcon } from "@/components/common/platform-icon";
import { ErrorState, PageHeader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeUrl } from "@/lib/findings";
import { useAdvanced } from "@/lib/preferences";
import { useModules } from "@/lib/query/hooks";
import { SOURCE_GROUPS } from "@/lib/sources";
import type { ModuleInfo } from "@/lib/types";
import {
  matchesAvailability,
  SourceConstellation,
  sourceIconKey,
  type Availability,
} from "./source-constellation";

function SourceRow({
  module: m,
  advanced,
  anchor,
}: {
  module: ModuleInfo;
  advanced: boolean;
  anchor: boolean;
}) {
  const source = safeUrl(m.source_url);
  return (
    <li
      id={anchor ? `source-${m.name}` : undefined}
      className="grid scroll-mt-40 grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 p-4 target:bg-accent/[0.06] sm:grid-cols-[auto_minmax(0,1fr)_auto]"
    >
      <PlatformIcon platform={sourceIconKey(m.name)} size="lg" />
      <div className="min-w-0 space-y-1">
        <h3 className="font-medium leading-snug">{m.title}</h3>
        <p className="text-sm text-muted-foreground">{m.description}</p>
        {!m.available ? (
          <p className="text-sm text-warning">
            Needs an API key on the server before it can run.
            {advanced && m.requires_env.length ? (
              <span className="mt-1 block">
                {m.requires_env.map((key) => (
                  <code
                    key={key}
                    className="mr-1 rounded bg-warning/10 px-1 py-0.5 font-mono text-xs"
                  >
                    {key}
                  </code>
                ))}
              </span>
            ) : null}
          </p>
        ) : null}
        {advanced ? (
          <p className="font-mono text-2xs text-muted-foreground">
            {m.name} · queue {m.queue} · inputs {m.inputs.join(", ")}
          </p>
        ) : null}
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-start-3 sm:flex-col sm:items-end">
        {m.available ? (
          <Badge variant="success">
            <CircleCheck className="h-3 w-3" aria-hidden />
            Ready
          </Badge>
        ) : (
          <Badge variant="warning">
            <KeyRound className="h-3 w-3" aria-hidden />
            Needs setup
          </Badge>
        )}
        {source ? (
          <a
            href={source}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-sm text-xs text-accent underline-offset-4 hover:underline"
          >
            About this source
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  );
}

/** The data-source catalogue, grouped by what you can search with it. */
export function ModulesView() {
  const catalogue = useModules();
  const [advanced] = useAdvanced();
  const modules = catalogue.data?.modules ?? [];
  const available = modules.filter((m) => m.available).length;
  const [group, setGroup] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Availability>("all");
  const anchored = new Set<string>();

  return (
    <div className="mx-auto max-w-6xl space-y-10">
      <PageHeader
        eyebrow="Catalogue"
        title="Data sources"
        description="Every place Sherlock can check, grouped by what you search. All of them read public data only. A source that searches several kinds of target is listed under each."
      />
      {catalogue.isPending ? (
        <div className="panel grid gap-2 p-5 sm:grid-cols-3 xl:grid-cols-4" aria-busy="true">
          {Array.from({ length: 16 }, (_, i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
      ) : catalogue.isError ? (
        <ErrorState
          title="Could not load the data sources"
          error={catalogue.error}
          onRetry={() => void catalogue.refetch()}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {available} of {modules.length} sources are ready.{" "}
            {catalogue.data?.bundled
              ? "This is the built-in list; the scan service was not asked."
              : "Live from the scan service."}
          </p>
          <aside
            aria-labelledby="profiles-note"
            className="space-y-2 border-l-2 border-accent/50 py-1 pl-4 text-sm"
          >
            <h2 id="profiles-note" className="font-medium">
              Profile pictures, previews and LinkedIn
            </h2>
            <p className="text-muted-foreground">
              When an account is found, Sherlock also reads the preview its public profile page
              shows anyone (name, picture, short bio), the same data a link preview uses. Results
              based on it are labelled “From the public profile page”. Some sites do not show
              profile details to visitors who are not signed in, so many accounts can only be
              confirmed to exist.
            </p>
            <p className="text-muted-foreground">
              LinkedIn does not allow direct lookups, so LinkedIn profiles come from public search
              results (title, snippet and link) and are labelled “From search results”. linkedin.com
              itself is never visited.
            </p>
          </aside>
          <SourceConstellation
            modules={modules}
            group={group}
            onGroup={setGroup}
            availability={availability}
            onAvailability={setAvailability}
          />
          <nav aria-label="Jump to a kind of search" className="flex flex-wrap gap-1">
            {SOURCE_GROUPS.map((g) => (
              <a
                key={g.id}
                href={`#sources-${g.id}`}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <TargetIcon type={g.types[0] ?? "username"} className="h-3.5 w-3.5" />
                {g.title}
              </a>
            ))}
          </nav>
          {SOURCE_GROUPS.filter((g) => !group || g.id === group).map((g) => {
            const list = modules.filter(
              (m) =>
                g.types.some((t) => m.inputs.includes(t)) && matchesAvailability(m, availability),
            );
            return (
              <section
                key={g.id}
                id={`sources-${g.id}`}
                aria-labelledby={`sources-${g.id}-title`}
                className="scroll-mt-24 space-y-3"
              >
                <div>
                  <h2
                    id={`sources-${g.id}-title`}
                    className="flex items-center gap-2 font-display text-3xl tracking-tight"
                  >
                    <TargetIcon
                      type={g.types[0] ?? "username"}
                      className="h-5 w-5 text-muted-foreground"
                    />
                    {g.title}
                    <span className="font-mono text-sm text-muted-foreground">{list.length}</span>
                  </h2>
                  <p className="text-sm text-muted-foreground">{g.description}</p>
                </div>
                {list.length ? (
                  <ul className="panel divide-y divide-border">
                    {list.map((m) => {
                      const anchor = !anchored.has(m.name);
                      anchored.add(m.name);
                      return (
                        <SourceRow key={m.name} module={m} advanced={advanced} anchor={anchor} />
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {availability === "all"
                      ? "No source can search this yet."
                      : "No source matches this filter."}
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
