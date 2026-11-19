"use client";

import { CircleCheck, ExternalLink, KeyRound } from "lucide-react";
import { TargetChip } from "@/components/common/bits";
import { ErrorState, PageHeader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { safeUrl } from "@/lib/findings";
import { useModules } from "@/lib/query/hooks";
import { QUEUES, type ModuleInfo, type Queue } from "@/lib/types";

const QUEUE_META: Record<Queue, { title: string; description: string }> = {
  identity: {
    title: "Identity queue",
    description: "Usernames, emails, phone numbers and names.",
  },
  infra: { title: "Infrastructure queue", description: "Domains, IP addresses and wallets." },
  media: { title: "Media queue", description: "Images: hashing and metadata." },
};

function ModuleCard({ module: m }: { module: ModuleInfo }) {
  const source = safeUrl(m.source_url);
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{m.title}</h3>
          <p className="font-mono text-xs text-muted-foreground">{m.name}</p>
        </div>
        {m.available ? (
          <Badge variant="success">
            <CircleCheck className="h-3 w-3" aria-hidden />
            Available
          </Badge>
        ) : (
          <Badge variant="warning">
            <KeyRound className="h-3 w-3" aria-hidden />
            Needs key
          </Badge>
        )}
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{m.description}</p>
      {!m.available && m.requires_env.length > 0 ? (
        <p className="text-xs text-warning">
          Missing:{" "}
          {m.requires_env.map((key) => (
            <code key={key} className="mr-1 rounded bg-warning/10 px-1 py-0.5 font-mono">
              {key}
            </code>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1" aria-label="Accepted input types">
          {m.inputs.map((input) => (
            <TargetChip key={input} type={input} value={input} />
          ))}
        </div>
        {source ? (
          <a
            href={source}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 rounded-sm text-xs text-accent underline-offset-4 hover:underline"
          >
            Source
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        ) : null}
      </div>
    </li>
  );
}

export function ModulesView() {
  const catalogue = useModules();
  const modules = catalogue.data?.modules ?? [];
  const available = modules.filter((m) => m.available).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Modules"
        description="Every data source is a plugin: one class that declares its inputs, queue and required keys. The registry below is what the gateway uses to plan a scan."
      />
      {catalogue.isPending ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : catalogue.isError ? (
        <ErrorState error={catalogue.error} onRetry={() => void catalogue.refetch()} />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono text-foreground">{available}</span> of{" "}
            <span className="font-mono text-foreground">{modules.length}</span> modules available
            {catalogue.data?.bundled
              ? " · showing the bundled catalogue (the scan service was not queried)"
              : " · live from the scan service"}
          </p>
          {QUEUES.map((queue) => {
            const list = modules.filter((m) => m.queue === queue);
            if (list.length === 0) return null;
            return (
              <section key={queue} aria-labelledby={`queue-${queue}`} className="space-y-3">
                <div>
                  <h2 id={`queue-${queue}`} className="text-lg font-semibold">
                    {QUEUE_META[queue].title}
                    <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
                      {list.length}
                    </span>
                  </h2>
                  <p className="text-sm text-muted-foreground">{QUEUE_META[queue].description}</p>
                </div>
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((m) => (
                    <ModuleCard key={m.name} module={m} />
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
