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
import { useAudit, useCaseSummaries } from "@/lib/query/hooks";
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Every scan, correlation run, review decision and report is recorded. Entries are append-only."
        actions={
          <Select value={caseId ?? ALL} onValueChange={(v) => set({ case: v === ALL ? null : v })}>
            <SelectTrigger className="w-64 max-w-full" aria-label="Filter by case">
              <SelectValue placeholder="All cases" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All cases</SelectItem>
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
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries">
          {caseId ? "Nothing has been recorded for this case yet." : "Activity is logged here as soon as you run a scan."}
        </EmptyState>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Time</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Case</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {formatDateTime(entry.created_at)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entry.action.includes("fail") ? "danger" : "outline"} className="font-mono">
                        {entry.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{entry.actor}</TableCell>
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
                    <TableCell className="max-w-md break-words font-mono text-xs text-muted-foreground">
                      {detailText(entry)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="grid grid-cols-1 gap-2 md:hidden">
            {entries.map((entry) => (
              <li key={entry.id} className="space-y-1.5 rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={entry.action.includes("fail") ? "danger" : "outline"} className="font-mono">
                    {entry.action}
                  </Badge>
                  <span className="font-mono text-2xs text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </span>
                </div>
                <p className="text-sm">
                  <span className="font-mono text-xs">{entry.actor}</span>
                  {entry.case_id ? (
                    <span className="text-muted-foreground"> · {titles.get(entry.case_id) ?? entry.case_id.slice(0, 8)}</span>
                  ) : null}
                </p>
                <p className="break-words font-mono text-xs text-muted-foreground">{detailText(entry)}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {entries.length} entr{entries.length === 1 ? "y" : "ies"}
            {caseId ? ` for ${titles.get(caseId) ?? "this case"}` : ""}
          </p>
        </>
      )}
    </div>
  );
}
