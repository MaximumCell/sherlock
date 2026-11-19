"use client";

import { Check, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { Avatar, ProgressBar } from "@/components/common/bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findingTitle, parseFinding } from "@/lib/findings";
import { percent } from "@/lib/format";
import { confidenceBand, describeRule } from "@/lib/rules";
import type { Correlation, EvidenceRef, Finding, ReviewDecision } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_BADGE = {
  pending: { label: "Pending", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  rejected: { label: "Rejected", variant: "muted" },
} as const;

const BAND_TONE = { high: "success", medium: "warning", low: "muted" } as const;

export interface ReviewCardProps {
  correlation: Correlation;
  findings: ReadonlyMap<string, Finding>;
  selected: boolean;
  pending?: boolean;
  onSelect: () => void;
  onDecide: (decision: ReviewDecision, note?: string) => void;
  onOpenFinding: (id: string) => void;
}

function LinkedFinding({
  finding,
  evidence,
  onOpen,
}: {
  finding: Finding;
  evidence: EvidenceRef[];
  onOpen: () => void;
}) {
  const view = parseFinding(finding);
  return (
    <li className="min-w-0 rounded-md border border-border bg-surface p-2.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left"
        aria-label={`Open ${findingTitle(finding)} finding for ${finding.identifier_value}`}
      >
        <Avatar src={view.avatarUrl} name={findingTitle(finding)} className="h-7 w-7" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{findingTitle(finding)}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {finding.identifier_value}
          </span>
        </span>
      </button>
      {evidence.length > 0 ? (
        <dl className="mt-2 space-y-1 border-t border-border pt-2">
          {evidence.map((item, i) => (
            <div key={`${item.field}-${i}`} className="text-xs">
              <dt className="text-muted-foreground">{item.field.replace(/_/g, " ")}</dt>
              <dd className="break-all font-mono">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

export function ReviewCard({
  correlation: c,
  findings,
  selected,
  pending = false,
  onSelect,
  onDecide,
  onOpenFinding,
}: ReviewCardProps) {
  const [note, setNote] = useState("");
  const rule = describeRule(c.type);
  const badge = STATUS_BADGE[c.status];
  const linked = c.entities_involved
    .map((id) => findings.get(id))
    .filter((f): f is Finding => f !== undefined);
  const missing = c.entities_involved.length - linked.length;
  const refs = c.evidence.filter((e): e is EvidenceRef => typeof e !== "string");
  const notes = c.evidence.filter((e): e is string => typeof e === "string");
  const orphanRefs = refs.filter((r) => !findings.has(r.finding_id));
  const decide = (decision: ReviewDecision) => onDecide(decision, note.trim() || undefined);

  return (
    <article
      data-selected={selected}
      aria-current={selected ? "true" : undefined}
      aria-label={`${rule.title}, ${percent(c.confidence)} confidence, ${badge.label}`}
      onClick={onSelect}
      onFocus={onSelect}
      className={cn(
        "space-y-3 rounded-lg border bg-card p-4 transition-colors",
        selected ? "border-accent shadow-panel" : "border-border",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="text-base font-semibold">{rule.title}</h3>
          <p className="text-sm text-muted-foreground">{rule.summary}</p>
          {c.matched_value ? (
            <p className="break-all pt-1 font-mono text-xs">
              <span className="text-muted-foreground">matched </span>
              {c.matched_value}
            </p>
          ) : null}
        </div>
        <div className="w-full space-y-1 sm:w-40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Confidence</span>
            <span className="font-mono font-semibold">{percent(c.confidence)}</span>
          </div>
          <ProgressBar
            value={c.confidence * 100}
            tone={BAND_TONE[confidenceBand(c.confidence)]}
            label="Confidence"
          />
          <Badge variant={badge.variant} className="mt-1">
            {badge.label}
          </Badge>
        </div>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Linked findings">
        {linked.map((finding) => (
          <LinkedFinding
            key={finding.id}
            finding={finding}
            evidence={refs.filter((r) => r.finding_id === finding.id)}
            onOpen={() => onOpenFinding(finding.id)}
          />
        ))}
      </ul>
      {missing > 0 ? (
        <p className="text-xs text-muted-foreground">
          {missing} linked finding{missing === 1 ? " is" : "s are"} no longer in this case.
        </p>
      ) : null}

      {notes.length + orphanRefs.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground" aria-label="Evidence">
          {notes.map((text) => (
            <li key={text}>{text}</li>
          ))}
          {orphanRefs.map((r, i) => (
            <li key={`orphan-${i}`}>
              {r.field}: <span className="font-mono text-xs">{r.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {c.review_note ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Reviewer note: </span>
          {c.review_note}
        </p>
      ) : null}

      <footer className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
        <Input
          aria-label="Review note (optional)"
          placeholder="Optional note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="h-8 min-w-0 flex-1"
        />
        <div className="flex gap-2">
          {c.status !== "approved" ? (
            <Button size="sm" disabled={pending} onClick={() => decide("approve")}>
              <Check aria-hidden />
              Approve
            </Button>
          ) : null}
          {c.status !== "rejected" ? (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => decide("reject")}>
              <X aria-hidden />
              Reject
            </Button>
          ) : null}
          {c.status !== "pending" ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide("reset")}>
              <RotateCcw aria-hidden />
              Reset
            </Button>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
