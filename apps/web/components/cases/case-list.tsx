"use client";

import Link from "next/link";
import { TargetChip } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { CaseRow } from "@/lib/case-list";
import { formatDateTime, timeAgo } from "@/lib/format";
import { useCaseHref } from "@/lib/use-case-href";
import { CaseStatusBadge } from "./case-status-badge";

function Targets({ row, max }: { row: CaseRow; max: number }) {
  const shown = row.case.identifiers.slice(0, max);
  const hidden = row.case.identifiers.length - shown.length;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {shown.map((idf) => (
        <TargetChip key={`${idf.type}:${idf.value}`} type={idf.type} value={idf.value} />
      ))}
      {hidden > 0 ? <span className="text-xs text-muted-foreground">+{hidden}</span> : null}
    </div>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag} variant="muted">
          {tag}
        </Badge>
      ))}
    </div>
  );
}

/** Table on desktop, cards below `md`. Each row is one link to the workspace. */
export function CaseList({ rows }: { rows: CaseRow[] }) {
  const caseHref = useCaseHref();
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Case</TableHead>
              <TableHead>Targets</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Found</TableHead>
              <TableHead className="text-right">Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.case.id} className="relative">
                <TableCell className="max-w-64 font-medium">
                  <Link
                    href={caseHref(row.case.id)}
                    className="block truncate rounded-sm after:absolute after:inset-0"
                  >
                    {row.title}
                  </Link>
                </TableCell>
                <TableCell className="max-w-72">
                  <Targets row={row} max={2} />
                </TableCell>
                <TableCell>
                  <Tags tags={row.case.tags} />
                </TableCell>
                <TableCell>
                  <CaseStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{row.foundCount}</TableCell>
                <TableCell
                  className="whitespace-nowrap text-right text-muted-foreground"
                  title={formatDateTime(row.updatedAt)}
                >
                  {timeAgo(row.updatedAt)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid grid-cols-1 gap-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.case.id}
            className="relative space-y-3 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                href={caseHref(row.case.id)}
                className="min-w-0 break-words font-medium after:absolute after:inset-0"
              >
                {row.title}
              </Link>
              <span className="shrink-0 text-xs text-muted-foreground">
                {timeAgo(row.updatedAt)}
              </span>
            </div>
            <Targets row={row} max={3} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CaseStatusBadge status={row.status} />
              <span className="text-xs text-muted-foreground">
                <span className="font-mono text-foreground">{row.foundCount}</span> found
              </span>
            </div>
            {row.case.tags.length > 0 ? <Tags tags={row.case.tags} /> : null}
          </li>
        ))}
      </ul>
    </>
  );
}
