"use client";

import { Search, Users } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useVisitors } from "@/lib/admin/hooks";
import { flagSummary, relativeTime, severityTone, topFlag } from "@/lib/admin/logic";
import type { SessionFilters } from "@/lib/admin/types";
import { SessionLabel } from "./admin-bits";

type Show = "all" | "flagged" | "blocked";
const PAGE = 20;

/** Every visitor session, most recently seen first. A row opens the visitor sheet. */
export function VisitorsTable({ onOpen }: { onOpen: (userId: string) => void }) {
  const [show, setShow] = useState<Show>("all");
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const filters: SessionFilters = {
    flagged: show === "flagged" ? true : undefined,
    blocked: show === "blocked" ? true : undefined,
    q: q.trim() || undefined,
    limit: PAGE,
    cursor,
  };
  const query = useVisitors(filters);
  const reset = () => {
    setCursor(null);
    setHistory([]);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          value={show}
          onValueChange={(v) => {
            if (v) {
              setShow(v as Show);
              reset();
            }
          }}
          aria-label="Which visitors"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="flagged">Flagged</ToggleGroupItem>
          <ToggleGroupItem value="blocked">Blocked</ToggleGroupItem>
        </ToggleGroup>
        <div className="relative min-w-0 flex-1 basis-48">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              reset();
            }}
            placeholder="Email, session id or origin"
            aria-label="Find a visitor"
            className="pl-8"
          />
        </div>
      </div>
      {query.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : query.isError ? (
        <ErrorState
          title="Could not load visitors"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.data.items.length === 0 ? (
        <EmptyState icon={Users} title="No visitors match">
          Visitors appear here after their first request to the scan service.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="p-3 font-medium">
                  Visitor
                </th>
                <th scope="col" className="p-3 font-medium">
                  First seen
                </th>
                <th scope="col" className="p-3 font-medium">
                  Last seen
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  Searches
                </th>
                <th scope="col" className="p-3 text-right font-medium">
                  Refused
                </th>
                <th scope="col" className="p-3 font-medium">
                  Warning signs
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((v) => {
                const top = topFlag(v.flags);
                return (
                  <tr key={v.user_id} className="hover:bg-muted/40">
                    <td className="max-w-[16rem] p-3">
                      <button
                        type="button"
                        onClick={() => onOpen(v.user_id)}
                        className="rounded-sm text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <SessionLabel session={v} userId={v.user_id} />
                      </button>
                    </td>
                    <td className="whitespace-nowrap p-3 text-muted-foreground">
                      {relativeTime(v.first_seen)}
                    </td>
                    <td className="whitespace-nowrap p-3 text-muted-foreground">
                      {relativeTime(v.last_seen)}
                    </td>
                    <td className="p-3 text-right tabular-nums">{v.search_count}</td>
                    <td className="p-3 text-right tabular-nums">{v.refused_count}</td>
                    <td className="p-3">
                      {top ? (
                        <Badge
                          variant={severityTone(top.severity)}
                          className="whitespace-normal"
                          title={flagSummary(v.flags)}
                        >
                          {flagSummary(v.flags)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {query.data && (history.length > 0 || query.data.next_cursor) ? (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={history.length === 0}
            onClick={() => {
              setCursor(history[history.length - 1] ?? null);
              setHistory((h) => h.slice(0, -1));
            }}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!query.data.next_cursor}
            onClick={() => {
              setHistory((h) => [...h, cursor]);
              setCursor(query.data.next_cursor);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}
