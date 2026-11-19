"use client";

import { CircleCheck, ExternalLink, KeyRound } from "lucide-react";
import { TargetIcon } from "@/components/common/bits";
import { ErrorState, PageHeader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeUrl } from "@/lib/findings";
import { useAdvanced } from "@/lib/preferences";
import { useModules } from "@/lib/query/hooks";
import { SOURCE_GROUPS } from "@/lib/sources";
import type { ModuleInfo } from "@/lib/types";

function SourceCard({ module: m, advanced }: { module: ModuleInfo; advanced: boolean }) {
  const source = safeUrl(m.source_url);
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium leading-snug">{m.title}</h3>
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
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{m.description}</p>
      {!m.available ? (
        <p className="text-sm text-warning">
          Needs an API key on the server before it can run.
          {advanced && m.requires_env.length ? (
            <span className="mt-1 block">
              {m.requires_env.map((key) => (
                <code key={key} className="mr-1 rounded bg-warning/10 px-1 py-0.5 font-mono text-xs">
                  {key}
                </code>
              ))}
            </span>
          ) : null}
        </p>
      ) : null}
      {advanced || source ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs">
          {advanced ? (
            <span className="font-mono text-muted-foreground">
              {m.name} · queue {m.queue} · inputs {m.inputs.join(", ")}
            </span>
          ) : (
            <span />
          )}
          {source ? (
            <a
              href={source}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 rounded-sm text-accent underline-offset-4 hover:underline"
            >
              About this source
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The data-source catalogue, grouped by what you can search with it. */
export function ModulesView() {
  const catalogue = useModules();
  const [advanced] = useAdvanced();
  const modules = catalogue.data?.modules ?? [];
  const available = modules.filter((m) => m.available).length;

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <PageHeader
        title="Data sources"
        description="Every place Sherlock can check, grouped by what you search. All of them read public data only. A source that searches several kinds of target is listed under each."
      />
      {catalogue.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : catalogue.isError ? (
        <ErrorState title="Could not load the data sources" error={catalogue.error} onRetry={() => void catalogue.refetch()} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {available} of {modules.length} sources are ready.{" "}
            {catalogue.data?.bundled
              ? "This is the built-in list; the scan service was not asked."
              : "Live from the scan service."}
          </p>
          <nav aria-label="Jump to a kind of search" className="flex flex-wrap gap-1.5">
            {SOURCE_GROUPS.map((g) => (
              <a
                key={g.id}
                href={`#sources-${g.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground hover:text-foreground"
              >
                <TargetIcon type={g.types[0] ?? "username"} className="h-3.5 w-3.5" />
                {g.title}
              </a>
            ))}
          </nav>
          {SOURCE_GROUPS.map((g) => {
            const list = modules.filter((m) => g.types.some((t) => m.inputs.includes(t)));
            return (
              <section key={g.id} id={`sources-${g.id}`} aria-labelledby={`sources-${g.id}-title`} className="scroll-mt-24 space-y-3">
                <div>
                  <h2 id={`sources-${g.id}-title`} className="flex items-center gap-2 text-xl font-semibold">
                    <TargetIcon type={g.types[0] ?? "username"} className="h-5 w-5 text-muted-foreground" />
                    {g.title}
                    <span className="text-sm font-normal text-muted-foreground">{list.length}</span>
                  </h2>
                  <p className="text-sm text-muted-foreground">{g.description}</p>
                </div>
                {list.length ? (
                  <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {list.map((m) => (
                      <SourceCard key={m.name} module={m} advanced={advanced} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No source can search this yet.</p>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
