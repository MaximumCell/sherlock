"use client";

import { ScrollText } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { EmptyState, ErrorState, PageHeader } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { caseDisplayTitle } from "@/lib/case-status";
import { formatDateTime } from "@/lib/format";
import { useAdvanced } from "@/lib/preferences";
import { useAudit, useCaseSummaries } from "@/lib/query/hooks";
import { describeAudit } from "@/lib/timeline";
import type { AuditEntry } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";

const ALL = "__all__";

function detailText(entry: AuditEntry): string {
  return Object.entries(entry.detail)
    .map(([k, v]) => `${k}=${typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}`)
    .join("  ");
}

export function AuditView() {
  const { params, set } = useUrlState();
  const caseId = params.get("case");
  const cases = useCaseSummaries();
  const audit = useAudit(caseId);
  const titles = useMemo(
    () => new Map((cases.data ?? []).map((s) => [s.case.id, caseDisplayTitle(s.case)])),
    [cases.data],
  );
  const entries = audit.data ?? [];
  const [advanced] = useAdvanced();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Record"
        title="Activity log"
        description="Every search, link check, decision and report is recorded here, newest first. Entries can never be edited or removed."
        actions={
          <Select value={caseId ?? ALL} onValueChange={(v) => set({ case: v === ALL ? null : v })}>
            <SelectTrigger className="w-64 max-w-full" aria-label="Filter by investigation">
              <SelectValue placeholder="All investigations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All investigations</SelectItem>
              {(cases.data ?? []).map((s) => (
                <SelectItem key={s.case.id} value={s.case.id}>
                  {caseDisplayTitle(s.case)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {audit.isPending ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex gap-6">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nothing recorded yet">
          {caseId
            ? "Nothing has happened in this investigation yet."
            : "Activity is recorded here as soon as you run a search."}
        </EmptyState>
      ) : (
        <>
          <div className="panel hidden overflow-hidden md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>What happened</TableHead>
                  <TableHead>By</TableHead>
                  <TableHead>Investigation</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap font-mono text-2xs tabular-nums text-muted-foreground">
                      {formatDateTime(entry.created_at)}
                    </TableCell>
                    <TableCell>
                      <span className={entry.action.includes("fail") ? "text-danger" : undefined}>
                        {describeAudit(entry).title}
                      </span>
                      {advanced ? (
                        <Badge variant="outline" className="ml-2 font-mono">
                          {entry.action}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm">{describeAudit(entry).by}</TableCell>
                    <TableCell className="max-w-48 truncate">
                      {entry.case_id ? (
                        <Link
                          href={`/case/${entry.case_id}`}
                          className="rounded-sm text-accent underline-offset-4 hover:underline"
                        >
                          {titles.get(entry.case_id) ?? entry.case_id.slice(0, 8)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="max-w-md break-words text-sm text-muted-foreground">
                      {describeAudit(entry).detail ?? "—"}
                      {advanced ? (
                        <span className="block font-mono text-xs">{detailText(entry)}</span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="panel space-y-1.5 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={
                      entry.action.includes("fail") ? "font-medium text-danger" : "font-medium"
                    }
                  >
                    {describeAudit(entry).title}
                  </span>
                  <span className="text-2xs text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </span>
                </div>
                <p className="text-sm">
                  <span>{describeAudit(entry).by}</span>
                  {entry.case_id ? (
                    <span className="text-muted-foreground">
                      {" "}
                      · {titles.get(entry.case_id) ?? entry.case_id.slice(0, 8)}
                    </span>
                  ) : null}
                </p>
                <p className="break-words text-sm text-muted-foreground">
                  {describeAudit(entry).detail}
                </p>
                {advanced ? (
                  <p className="break-words font-mono text-xs text-muted-foreground">
                    {entry.action} · {detailText(entry)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {entries.length} event{entries.length === 1 ? "" : "s"}
            {caseId ? ` for ${titles.get(caseId) ?? "this investigation"}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
