"use client";

import { ChevronDown, CircleCheck, Radar, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { usePrefersReducedMotion } from "@/components/motion/hooks";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sourceProgressText, sourceProgress } from "@/lib/case-progress";
import { isActiveJob } from "@/lib/case-status";
import { useAdvanced } from "@/lib/preferences";
import { useModules } from "@/lib/query/hooks";
import { useCancelJob, useScan } from "@/lib/query/mutations";
import { SCAN_ANCHOR } from "@/lib/sections";
import { QUEUE_LABEL } from "@/lib/sources";
import { QUEUES, TARGET_TYPES, type Finding, type Job, type TargetType } from "@/lib/types";
import {
  deriveScanner,
  rankTiles,
  replayTiles,
  tileCounts,
  type TileState,
} from "@/lib/ui/scanner";
import { cn } from "@/lib/utils";
import { ScannerStage } from "./scanner-stage";
import { SourceRow } from "./source-row";

const isTargetType = (t: string): t is TargetType =>
  (TARGET_TYPES as readonly string[]).includes(t);

const REPLAY_MS = 3600;

/** 0 → 1 over a few seconds, once (the demo replays its scan). 1 straight away when off. */
function useReplay(enabled: boolean): number {
  const reduce = usePrefersReducedMotion();
  const [t, setT] = useState(0);
  const on = enabled && !reduce;
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    const start = performance.now() + 300;
    const tick = (now: number) => {
      const next = Math.min(1, Math.max(0, (now - start) / REPLAY_MS));
      setT(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on]);
  return on ? t : 1;
}

const DOT: Record<TileState, string> = {
  waiting: "bg-muted-foreground/30",
  checking: "bg-accent/60",
  found: "bg-accent",
  empty: "bg-success/70",
  failed: "bg-warning",
  stopped: "bg-muted-foreground/50",
};

/** Active first, then problems, then the most recent finished. */
function order(jobs: readonly Job[]): Job[] {
  const rank = (j: Job) =>
    j.status === "running" ? 0 : j.status === "queued" ? 1 : j.status === "failed" ? 2 : 3;
  return [...jobs].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (b.finished_at ?? b.created_at).localeCompare(a.finished_at ?? a.created_at),
  );
}

/**
 * Step 1 of the rail. While a scan runs (or the demo replays one) the scanner fills the top of
 * the page; once everything is done it folds into one summary line. The per-source checklist
 * (stop, retry, attempts, details) is always one click away.
 */
export function ScanPanel({
  caseId,
  jobs,
  findings,
  loading,
  replay = false,
  target,
}: {
  caseId: string;
  jobs: Job[];
  findings: Finding[];
  loading: boolean;
  replay?: boolean;
  target: { type: string; value: string } | null;
}) {
  const [advanced] = useAdvanced();
  const catalogue = useModules();
  const cancel = useCancelJob(caseId);
  const scan = useScan(caseId);
  const [listChoice, setListChoice] = useState<boolean | null>(null);
  const p = sourceProgress(jobs);
  const state = useMemo(() => deriveScanner(jobs, findings), [jobs, findings]);
  const t = useReplay(replay && jobs.length > 0 && !loading);
  const replaying = t < 1;
  const tiles = useMemo(
    () => (replaying ? replayTiles(state.tiles, t) : state.tiles),
    [state.tiles, replaying, t],
  );
  const counts = replaying ? tileCounts(tiles) : state;
  const stage = !loading && jobs.length > 0 && (p.scanning || replaying);
  const listOpen = listChoice ?? false;
  const active = jobs.filter(isActiveJob);
  const groups = useMemo(
    () =>
      QUEUES.map((q) => ({ queue: q, jobs: order(jobs.filter((j) => j.queue === q)) })).filter(
        (g) => g.jobs.length,
      ),
    [jobs],
  );

  const headline = loading
    ? "Loading scan progress…"
    : jobs.length === 0
      ? "No search has run yet"
      : p.scanning
        ? `Scanning · ${sourceProgressText(p)}`
        : `Scan finished · ${jobs.length} source${jobs.length === 1 ? "" : "s"} checked · ${state.found} found${p.failed ? ` · ${p.failed} could not be checked` : ""}`;

  const actions = (
    <>
      {active.length > 0 ? (
        <Button
          variant="outline"
          size="sm"
          disabled={cancel.isPending}
          onClick={() => active.forEach((j) => cancel.mutate(j.id))}
        >
          <Square className="!size-3 fill-current" aria-hidden />
          Stop scan
        </Button>
      ) : null}
      {jobs.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={listOpen}
          aria-controls="scan-sources"
          onClick={() => setListChoice(!listOpen)}
        >
          {listOpen ? "Hide sources" : "Show sources"}
          <ChevronDown
            className={cn("transition-transform duration-2", listOpen && "rotate-180")}
            aria-hidden
          />
        </Button>
      ) : null}
    </>
  );

  return (
    <section
      id={SCAN_ANCHOR}
      aria-labelledby="scan-title"
      className={cn(
        "relative scroll-mt-36 overflow-hidden rounded-xl border bg-card transition-[border-color,box-shadow] duration-4",
        stage ? "border-accent/30 shadow-[0_0_60px_-30px_hsl(var(--glow)/0.6)]" : "border-border",
      )}
    >
      <h2 id="scan-title" className="sr-only">
        Scan progress
      </h2>
      <p className="sr-only" aria-live="polite">
        {headline}
      </p>
      {loading ? (
        <div className="flex items-center gap-3 p-4">
          <Skeleton className="h-5 w-5 rounded-full" />
          <Skeleton className="h-4 w-64" />
        </div>
      ) : stage ? (
        <ScannerStage
          tiles={tiles}
          done={counts.done}
          found={counts.found}
          failed={counts.failed}
          ticker={state.ticker}
          findings={findings}
          targetType={target?.type ?? "username"}
          targetValue={target?.value ?? ""}
          actions={actions}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
          {jobs.length ? (
            <CircleCheck className="h-5 w-5 shrink-0 text-success" aria-hidden />
          ) : (
            <Radar className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" aria-hidden>
              {jobs.length ? "Scan finished" : "No search has run yet"}
            </p>
            {jobs.length ? (
              <p className="text-sm text-muted-foreground" aria-hidden>
                {jobs.length} source{jobs.length === 1 ? "" : "s"} checked · {state.found} found
                {p.failed ? (
                  <span className="text-warning"> · {p.failed} could not be checked</span>
                ) : null}
              </p>
            ) : null}
          </div>
          <ul aria-hidden className="hidden max-w-[16rem] flex-wrap gap-1 md:flex">
            {rankTiles(state.tiles).map((tile) => (
              <li key={tile.id} className={cn("h-1.5 w-1.5 rounded-full", DOT[tile.state])} />
            ))}
          </ul>
          <div className="flex items-center gap-2">{actions}</div>
        </div>
      )}
      {stage && p.scanning ? (
        <div className="h-px bg-border" aria-hidden>
          <div
            className="h-px bg-accent transition-[width] duration-4 ease-out"
            style={{ width: `${p.total ? (counts.done / p.total) * 100 : 0}%` }}
          />
        </div>
      ) : null}
      {listOpen && jobs.length > 0 ? (
        <div id="scan-sources" className="animate-fade-in border-t border-border">
          {groups.map((g) => {
            const running = g.jobs.filter(isActiveJob).length;
            return (
              <div key={g.queue}>
                <h3 className="flex items-center justify-between bg-surface px-4 py-2 font-mono text-2xs uppercase tracking-[0.12em] text-muted-foreground sm:px-5">
                  <span>
                    {QUEUE_LABEL[g.queue]}
                    {advanced ? <span className="ml-2 normal-case">queue: {g.queue}</span> : null}
                  </span>
                  <span className="tabular-nums">
                    {g.jobs.length} source{g.jobs.length === 1 ? "" : "s"}
                    {running ? ` · ${running} still running` : ""}
                  </span>
                </h3>
                <ul className="divide-y divide-border">
                  {g.jobs.map((job) => (
                    <SourceRow
                      key={job.id}
                      job={job}
                      modules={catalogue.data?.modules}
                      advanced={advanced}
                      busy={
                        (cancel.isPending && cancel.variables === job.id) ||
                        (scan.isPending && scan.variables?.modules?.[0] === job.module)
                      }
                      onCancel={() => cancel.mutate(job.id)}
                      onRetry={() => {
                        if (!isTargetType(job.target_type)) return;
                        scan.mutate({
                          type: job.target_type,
                          value: job.target_value,
                          modules: [job.module],
                        });
                      }}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
