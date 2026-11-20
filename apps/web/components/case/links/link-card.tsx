"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accountsInLink, type AccountIndex } from "@/lib/accounts";
import { percent } from "@/lib/format";
import { AccountSide } from "./account-side";
import { ConfidenceMeter } from "./confidence-meter";
import { describeRule, evidenceLabel } from "@/lib/rules";
import type { Correlation, EvidenceRef, ReviewDecision } from "@/lib/types";
import { cn } from "@/lib/utils";

export const STATUS_BADGE = {
  pending: { label: "To check", variant: "warning" },
  approved: { label: "Confirmed", variant: "success" },
  rejected: { label: "Rejected", variant: "muted" },
} as const;

export interface ReviewCardProps {
  correlation: Correlation;
  index: AccountIndex;
  selected: boolean;
  pending?: boolean;
  onSelect: () => void;
  onDecide: (decision: ReviewDecision, note?: string) => void;
  onOpenFinding: (id: string) => void;
  advanced: boolean;
}

export function ReviewCard({
  correlation: c,
  index,
  selected,
  pending = false,
  onSelect,
  onDecide,
  onOpenFinding,
  advanced,
}: ReviewCardProps) {
  const [note, setNote] = useState("");
  const rule = describeRule(c.type);
  const badge = STATUS_BADGE[c.status];
  const linked = accountsInLink(c, index);
  const missing = c.entities_involved.filter((id) => !index.byFinding.has(id)).length;
  const refs = c.evidence.filter((e): e is EvidenceRef => typeof e !== "string");
  const notes = c.evidence.filter((e): e is string => typeof e === "string");
  const orphanRefs = refs.filter((r) => !index.byFinding.has(r.finding_id));
  const decide = (decision: ReviewDecision) => onDecide(decision, note.trim() || undefined);

  return (
    <article
      data-selected={selected}
      aria-current={selected ? "true" : undefined}
      aria-label={`${rule.title}, ${percent(c.confidence)} confidence, ${badge.label}`}
      onClick={onSelect}
      onFocus={onSelect}
      className={cn(
        "space-y-3 rounded-xl border bg-card p-4 transition-colors duration-2",
        selected ? "border-accent ring-1 ring-accent/30" : "border-border",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="text-base font-semibold">{rule.title}</h3>
          <p className="text-sm text-muted-foreground">{rule.summary}</p>
          {c.matched_value ? (
            <p className="break-all pt-1 text-sm">
              <span className="text-muted-foreground">Both share </span>
              <span className="font-mono text-xs">{c.matched_value}</span>
            </p>
          ) : null}
          {advanced ? (
            <p className="pt-1 font-mono text-2xs text-muted-foreground">
              rule {c.type} · priority {c.priority} · key {c.corr_key}
            </p>
          ) : null}
        </div>
        <div className="w-full space-y-2 sm:w-48">
          <ConfidenceMeter confidence={c.confidence} />
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Accounts in this link">
        {linked.map((acc) => (
          <AccountSide
            key={acc.key}
            account={acc}
            refs={refs}
            compact
            onOpen={() => onOpenFinding(acc.primary.id)}
          />
        ))}
      </ul>
      {missing > 0 ? (
        <p className="text-xs text-muted-foreground">
          {missing} result{missing === 1 ? " in this link is" : "s in this link are"} no longer in
          this investigation.
        </p>
      ) : null}

      {notes.length + orphanRefs.length > 0 ? (
        <ul
          className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground"
          aria-label="Evidence"
        >
          {notes.map((text) => (
            <li key={text}>{text}</li>
          ))}
          {orphanRefs.map((r, i) => (
            <li key={`orphan-${i}`}>
              {evidenceLabel(r.field)}: <span className="font-mono text-xs">{r.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {c.review_note ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Your note: </span>
          {c.review_note}
        </p>
      ) : null}

      <footer className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
        <Input
          aria-label="Note for this decision (optional)"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 min-w-0 flex-1"
        />
        <div className="flex gap-2">
          {c.status !== "approved" ? (
            <Button size="sm" disabled={pending} onClick={() => decide("approve")}>
              <Check aria-hidden />
              Yes, same
            </Button>
          ) : null}
          {c.status !== "rejected" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("reject")}>
              <X aria-hidden />
              No
            </Button>
          ) : null}
          {c.status !== "pending" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide("reset")}>
              <RotateCcw aria-hidden />
              Undo decision
            </Button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
