"use client";

import { Star } from "lucide-react";
import { Avatar } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { findingTitle, parseFinding } from "@/lib/findings";
import { timeAgo } from "@/lib/format";
import type { Finding, FindingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_BADGE: Record<FindingStatus, { label: string; variant: "success" | "muted" | "danger" }> = {
  found: { label: "Found", variant: "success" },
  not_found: { label: "Not found", variant: "muted" },
  error: { label: "Error", variant: "danger" },
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  const meta = STATUS_BADGE[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function StarButton({
  finding,
  onCurate,
}: {
  finding: Finding;
  onCurate: (id: string, curated: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={finding.curated}
      aria-label={`${finding.curated ? "Remove" : "Add"} ${findingTitle(finding)} ${finding.curated ? "from" : "to"} shortlist`}
      onClick={(e) => {
        e.stopPropagation();
        onCurate(finding.id, !finding.curated);
      }}
      className="relative z-10 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Star className={cn("h-4 w-4", finding.curated && "fill-warning text-warning")} aria-hidden />
    </button>
  );
}

function summaryLine(finding: Finding): string {
  const view = parseFinding(finding);
  if (view.breach) return view.breach.dataClasses.join(", ") || "Breach exposure";
  if (view.error) return view.error;
  return (
    view.fullname ?? view.bio ?? view.other.slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(" · ")
  );
}

interface Props {
  rows: Finding[];
  onOpen: (id: string) => void;
  onCurate: (id: string, curated: boolean) => void;
}

/** Table on desktop, cards on small screens. The row opens the detail sheet. */
export function FindingsTable({ rows, onOpen, onCurate }: Props) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <span className="sr-only">Shortlist</span>
              </TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Identifier</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Collected</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => {
              const view = parseFinding(f);
              return (
                <TableRow key={f.id} className="relative cursor-pointer" onClick={() => onOpen(f.id)}>
                  <TableCell className="pr-0">
                    <StarButton finding={f} onCurate={onCurate} />
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(f.id);
                      }}
                      className="flex items-center gap-2.5 rounded-sm text-left font-medium"
                    >
                      <Avatar src={view.avatarUrl} name={findingTitle(f)} className="h-7 w-7" />
                      <span>
                        {findingTitle(f)}
                        <span className="block text-2xs font-normal text-muted-foreground">
                          {view.category}
                        </span>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs" title={f.identifier_value}>
                    {f.identifier_value}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">
                    {summaryLine(f)}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {f.module ?? f.source_tool}
                  </TableCell>
                  <TableCell>
                    <FindingStatusBadge status={f.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                    {timeAgo(f.collected_at)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="grid grid-cols-1 gap-2 md:hidden">
        {rows.map((f) => {
          const view = parseFinding(f);
          return (
            <li key={f.id} className="relative flex items-start gap-3 rounded-lg border border-border bg-card p-3">
              <Avatar src={view.avatarUrl} name={findingTitle(f)} />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onOpen(f.id)}
                    className="min-w-0 truncate rounded-sm text-left font-medium after:absolute after:inset-0"
                  >
                    {findingTitle(f)}
                  </button>
                  <FindingStatusBadge status={f.status} />
                </div>
                <p className="truncate font-mono text-xs text-muted-foreground">{f.identifier_value}</p>
                <p className="line-clamp-2 text-xs text-muted-foreground">{summaryLine(f)}</p>
              </div>
              <StarButton finding={f} onCurate={onCurate} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
