"use client";

import { Pin } from "lucide-react";
import { ProfileAvatar } from "@/components/common/profile-avatar";
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
import { resolvePlatform } from "@/lib/platforms";
import { findingPlatform } from "@/lib/profile";
import { cn } from "@/lib/utils";

function RowAvatar({ finding, avatarUrl }: { finding: Finding; avatarUrl: string | null }) {
  const platform = findingPlatform(finding);
  return (
    <ProfileAvatar
      src={avatarUrl}
      name={findingTitle(finding)}
      platform={resolvePlatform(platform).known ? platform : null}
      size="xs"
      decorative
    />
  );
}

const STATUS_BADGE: Record<
  FindingStatus,
  { label: string; variant: "success" | "muted" | "danger" }
> = {
  found: { label: "Found", variant: "success" },
  not_found: { label: "Not found", variant: "muted" },
  error: { label: "Error", variant: "danger" },
};

export function FindingStatusBadge({ status }: { status: FindingStatus }) {
  const meta = STATUS_BADGE[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

function PinButton({
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
      aria-label={`${finding.curated ? "Unpin" : "Pin"} ${findingTitle(finding)}`}
      onClick={(e) => {
        e.stopPropagation();
        onCurate(finding.id, !finding.curated);
      }}
      className={cn(
        "relative z-10 rounded-md p-1.5 hover:bg-muted hover:text-foreground",
        finding.curated ? "text-accent" : "text-muted-foreground",
      )}
    >
      <Pin className={cn("h-4 w-4", finding.curated && "fill-current")} aria-hidden />
    </button>
  );
}

function summaryLine(finding: Finding): string {
  const view = parseFinding(finding);
  if (view.breach) return view.breach.dataClasses.join(", ") || "Breach exposure";
  if (view.error) return view.error;
  if (view.wallet) {
    return [
      view.wallet.balance ? `${view.wallet.balance} ${view.wallet.unit}` : null,
      view.wallet.txCount !== null ? `${view.wallet.txCount} transactions` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (view.network) {
    return `${view.network.ports.length} open port${view.network.ports.length === 1 ? "" : "s"}${view.network.vulns.length ? ` · ${view.network.vulns.length} CVEs` : ""}`;
  }
  if (view.dns) return Object.keys(view.dns.records).join(", ") + " records";
  if (view.activity?.offsetLabel) return `Activity suggests ${view.activity.offsetLabel}`;
  if (view.image) {
    return [
      view.image.camera,
      view.image.width && view.image.height ? `${view.image.width}×${view.image.height}` : null,
      view.image.gpsPresent ? "GPS present" : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return (
    view.fullname ??
    view.bio ??
    view.other
      .slice(0, 2)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" · ")
  );
}

interface Props {
  rows: Finding[];
  /** Per-row note, e.g. "Same account as above" when rows are grouped by account. */
  notes?: ReadonlyMap<string, string>;
  onOpen: (id: string) => void;
  onCurate: (id: string, curated: boolean) => void;
  sourceLabel: (name: string) => string;
  advanced: boolean;
}

/** Table on desktop, cards on small screens. The row opens the detail sheet. */
export function ResultsTable({ rows, notes, onOpen, onCurate, sourceLabel, advanced }: Props) {
  return (
    <>
      <div className="panel hidden overflow-hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <span className="sr-only">Pinned</span>
              </TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Searched for</TableHead>
              <TableHead>Details</TableHead>
              <TableHead>Data source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => {
              const view = parseFinding(f);
              return (
                <TableRow
                  key={f.id}
                  className="relative cursor-pointer"
                  onClick={() => onOpen(f.id)}
                >
                  <TableCell className="pr-0">
                    <PinButton finding={f} onCurate={onCurate} />
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
                      <RowAvatar finding={f} avatarUrl={view.avatarUrl} />
                      <span>
                        {findingTitle(f)}
                        <span className="block text-2xs font-normal text-muted-foreground">
                          {notes?.get(f.id) ?? view.category}
                        </span>
                      </span>
                    </button>
                  </TableCell>
                  <TableCell
                    className="max-w-48 truncate font-mono text-xs"
                    title={f.identifier_value}
                  >
                    {f.identifier_value}
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground">
                    {summaryLine(f)}
                  </TableCell>
                  <TableCell className="max-w-40 text-xs text-muted-foreground">
                    <span className="block truncate">{sourceLabel(f.module ?? f.source_tool)}</span>
                    {advanced ? (
                      <span className="block truncate font-mono text-2xs">
                        {f.module ?? f.source_tool}
                      </span>
                    ) : null}
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
            <li key={f.id} className="panel relative flex animate-rise-in items-start gap-3 p-3">
              <RowAvatar finding={f} avatarUrl={view.avatarUrl} />
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
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {f.identifier_value}
                </p>
                {notes?.get(f.id) ? (
                  <p className="text-2xs text-muted-foreground">{notes.get(f.id)}</p>
                ) : null}
                <p className="line-clamp-2 text-xs text-muted-foreground">{summaryLine(f)}</p>
              </div>
              <PinButton finding={f} onCurate={onCurate} />
            </li>
          );
        })}
      </ul>
    </>
  );
}
