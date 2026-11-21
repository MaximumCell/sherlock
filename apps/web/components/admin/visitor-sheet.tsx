"use client";

import { Ban, FolderOpen, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { TargetChip } from "@/components/common/bits";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  useBlockVisitor,
  useOperatorDeleteCase,
  useUnblockVisitor,
  useVisitor,
} from "@/lib/admin/hooks";
import { sessionName, userAgentLabel } from "@/lib/admin/logic";
import type { CaseMeta, SessionDetail } from "@/lib/admin/types";
import { describeError } from "@/lib/data/gateway";
import { useAdvanced } from "@/lib/preferences";
import {
  FlagBadge,
  OutcomeBadge,
  SensitiveTarget,
  SessionLabel,
  ViewCaseLink,
  formatTime,
} from "./admin-bits";

function BlockForm({ detail }: { detail: SessionDetail }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const block = useBlockVisitor();
  const unblock = useUnblockVisitor();
  const s = detail.session;

  if (s.blocked) {
    return (
      <div className="space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
        <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
          <Ban className="h-4 w-4" aria-hidden /> Blocked{" "}
          {s.blocked_at ? formatTime(s.blocked_at) : ""}
        </p>
        {s.blocked_reason ? (
          <p className="text-sm text-muted-foreground">Reason: {s.blocked_reason}</p>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={unblock.isPending}
          onClick={() =>
            unblock.mutate(s.user_id, {
              onSuccess: () => toast.success("Visitor unblocked"),
              onError: (err) =>
                toast.error("Could not unblock", { description: describeError(err) }),
            })
          }
        >
          <ShieldCheck aria-hidden />
          {unblock.isPending ? "Unblocking…" : "Unblock"}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return setError("Give a short reason, for your own records.");
        block.mutate(
          { userId: s.user_id, reason: reason.trim() },
          {
            onSuccess: () => {
              setReason("");
              toast.success("Visitor blocked", { description: "Their new searches are refused." });
            },
            onError: (err) => setError(describeError(err)),
          },
        );
      }}
    >
      <Label htmlFor="block-reason">Block this visitor from searching</Label>
      <Textarea
        id="block-reason"
        value={reason}
        maxLength={300}
        rows={2}
        placeholder="Reason, for example: looked up many people's emails"
        onChange={(e) => {
          setReason(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "block-error" : undefined}
      />
      {error ? (
        <p id="block-error" role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="destructive" size="sm" disabled={block.isPending}>
        <Ban aria-hidden />
        {block.isPending ? "Blocking…" : "Block"}
      </Button>
    </form>
  );
}

function CaseList({ cases }: { cases: CaseMeta[] }) {
  const [target, setTarget] = useState<CaseMeta | null>(null);
  const remove = useOperatorDeleteCase();
  if (cases.length === 0) return <p className="text-sm text-muted-foreground">No cases.</p>;
  return (
    <>
      <ul className="space-y-2">
        {cases.map((c) => (
          <li key={c.id} className="flex items-start gap-2 rounded-lg border border-border p-3">
            <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-medium">{c.title || "Untitled case"}</p>
              <div className="flex flex-wrap gap-1">
                {c.identifiers.map((i) => (
                  <TargetChip key={`${i.type}:${i.value}`} type={i.type} value={i.value} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {formatTime(c.created_at)} · {c.job_count} scans · {c.found_count} found
              </p>
            </div>
            <ViewCaseLink caseId={c.id} label={c.title ?? undefined} />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete case ${c.title ?? c.id}`}
              onClick={() => setTarget(c)}
            >
              <Trash2 aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title="Delete this case?"
        description="The case and everything found in it are removed for its owner. The search log keeps its entries. This cannot be undone."
        confirmLabel="Delete case"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          target &&
          remove.mutate(target.id, {
            onSuccess: () => {
              setTarget(null);
              toast.success("Case deleted");
            },
            onError: (err) =>
              toast.error("Could not delete the case", { description: describeError(err) }),
          })
        }
      />
    </>
  );
}

function Detail({ detail }: { detail: SessionDetail }) {
  const [advanced] = useAdvanced();
  const s = detail.session;
  return (
    <div className="space-y-6">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Browser</dt>
        <dd>{userAgentLabel(s.user_agent)}</dd>
        <dt className="text-muted-foreground">First seen</dt>
        <dd>{formatTime(s.first_seen)}</dd>
        <dt className="text-muted-foreground">Last seen</dt>
        <dd>{formatTime(s.last_seen)}</dd>
        <dt className="text-muted-foreground">Searches</dt>
        <dd>
          {s.search_count} accepted, {s.refused_count} refused
        </dd>
        {advanced ? (
          <>
            <dt className="text-muted-foreground">Session id</dt>
            <dd className="break-all font-mono text-xs">{s.user_id}</dd>
            <dt className="text-muted-foreground">Origin hash</dt>
            <dd className="break-all font-mono text-xs">{s.origin ?? "unknown"}</dd>
            <dt className="text-muted-foreground">User agent</dt>
            <dd className="break-all font-mono text-xs">{s.user_agent ?? "none"}</dd>
          </>
        ) : null}
      </dl>
      {s.flags.length > 0 ? (
        <section className="space-y-2" aria-label="Warning signs">
          <h3 className="text-sm font-semibold">Warning signs</h3>
          <div className="flex flex-wrap gap-1.5">
            {s.flags.map((f) => (
              <FlagBadge key={f.key} flag={f} />
            ))}
          </div>
        </section>
      ) : null}
      <BlockForm detail={detail} />
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Searches</h3>
        {detail.searches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No searches yet.</p>
        ) : (
          <ol className="space-y-2 border-l border-border pl-4">
            {detail.searches.map((r) => (
              <li key={r.id} className="space-y-0.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <SensitiveTarget
                    type={r.target_type}
                    value={r.target_value}
                    className="min-w-0"
                  />
                  <OutcomeBadge outcome={r.outcome} />
                </div>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={r.created_at}>{formatTime(r.created_at)}</time>
                  {r.detail && r.outcome !== "accepted" ? ` · ${r.detail}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Cases</h3>
        <p className="text-xs text-muted-foreground">
          Titles, targets and counts only. Findings are never shown here.
        </p>
        <CaseList cases={detail.cases} />
      </section>
    </div>
  );
}

/** Side sheet for one visitor: timeline, cases as metadata, block / unblock, delete a case. */
export function VisitorSheet({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const query = useVisitor(userId);
  const s = query.data?.session;
  return (
    <Sheet open={userId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader className="pr-8">
          <SheetTitle className="break-all">{s ? sessionName(s) : "Visitor"}</SheetTitle>
          <SheetDescription asChild>
            <div>{s ? <SessionLabel session={s} userId={s.user_id} /> : "Loading…"}</div>
          </SheetDescription>
        </SheetHeader>
        {query.isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : query.isError ? (
          <ErrorState
            title="Could not load this visitor"
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <Detail detail={query.data} />
        )}
      </SheetContent>
    </Sheet>
  );
}
