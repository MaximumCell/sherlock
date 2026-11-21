"use client";

import { Inbox, Pause, Play, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FEED_REFRESH_MS, useSearchFeed } from "@/lib/admin/hooks";
import { OUTCOME_LABELS, newRowIds, relativeTime } from "@/lib/admin/logic";
import { SEARCH_OUTCOMES, type SearchLogRow, type SearchOutcome } from "@/lib/admin/types";
import { TARGET_TYPES } from "@/lib/types";
import { cn } from "@/lib/utils";
import { OutcomeBadge, SensitiveTarget, SessionLabel, ViewCaseLink, formatTime } from "./admin-bits";

const ALL = "all";

function FeedRow({
  row,
  fresh,
  onOpen,
}: {
  row: SearchLogRow;
  fresh: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <li
      className={cn(
        "relative flex flex-col gap-1.5 p-3 transition-colors duration-1000 sm:flex-row sm:items-center sm:gap-3",
        fresh && "animate-rise-in bg-accent/[0.07] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
      )}
    >
      <time
        dateTime={row.created_at}
        title={formatTime(row.created_at)}
        className="w-20 shrink-0 font-mono text-2xs tabular-nums text-muted-foreground"
      >
        {relativeTime(row.created_at)}
      </time>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SensitiveTarget type={row.target_type} value={row.target_value} className="min-w-0" />
        <OutcomeBadge outcome={row.outcome} />
        {fresh ? <span className="sr-only">New</span> : null}
        {row.case_id ? <ViewCaseLink caseId={row.case_id} /> : null}
      </div>
      <button
        type="button"
        onClick={() => onOpen(row.user_id)}
        className="min-w-0 rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-[45%]"
        aria-label="Open this visitor"
      >
        <SessionLabel session={row.session} userId={row.user_id} />
      </button>
    </li>
  );
}

/** Live feed of search attempts: refreshes every 10 s (pausable), new rows highlighted. */
export function ActivityFeed({ onOpen }: { onOpen: (userId: string) => void }) {
  const [live, setLive] = useState(true);
  const [outcome, setOutcome] = useState<SearchOutcome | typeof ALL>(ALL);
  const [type, setType] = useState<string>(ALL);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [limit, setLimit] = useState(25);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const feed = useSearchFeed(
    {
      outcome: outcome === ALL ? undefined : outcome,
      type: type === ALL ? undefined : type,
      q: debounced || undefined,
      limit,
    },
    live,
  );
  const previous = useRef<SearchLogRow[] | undefined>(undefined);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const rows = feed.data?.items;
  useEffect(() => {
    if (!rows) return;
    setFresh(newRowIds(previous.current, rows));
    previous.current = rows;
    const t = setTimeout(() => setFresh(new Set()), 4000);
    return () => clearTimeout(t);
  }, [rows]);
  useEffect(() => {
    previous.current = undefined; // a new filter is not "new activity"
  }, [outcome, type, debounced]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search targets"
            aria-label="Search targets"
            className="pl-8"
          />
        </div>
        <Select value={outcome} onValueChange={(v) => setOutcome(v as SearchOutcome | typeof ALL)}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Filter by outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All outcomes</SelectItem>
            {SEARCH_OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {OUTCOME_LABELS[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-[8.5rem]" aria-label="Filter by target type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {TARGET_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t[0]?.toUpperCase() + t.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLive((v) => !v)}
          aria-pressed={!live}
          className="h-9"
        >
          {live ? <Pause aria-hidden /> : <Play aria-hidden />}
          {live ? "Pause updates" : "Resume updates"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {live ? `Updates every ${FEED_REFRESH_MS / 1000} seconds.` : "Updates paused."}
        {feed.isFetching && !feed.isPending ? " Refreshing…" : ""}
      </p>
      {feed.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : feed.isError ? (
        <ErrorState
          title="Could not load the activity feed"
          error={feed.error}
          onRetry={() => void feed.refetch()}
        />
      ) : feed.data.items.length === 0 ? (
        <EmptyState icon={Inbox} title="No searches match">
          {q || outcome !== ALL || type !== ALL
            ? "Try clearing the filters."
            : "No one has searched yet."}
        </EmptyState>
      ) : (
        <>
          <ul
            className="panel divide-y divide-border overflow-hidden"
            aria-label="Recent searches"
          >
            {feed.data.items.map((row) => (
              <FeedRow key={row.id} row={row} fresh={fresh.has(row.id)} onOpen={onOpen} />
            ))}
          </ul>
          {feed.data.next_cursor ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLimit((l) => Math.min(200, l + 25))}
              disabled={limit >= 200}
            >
              Show more
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
