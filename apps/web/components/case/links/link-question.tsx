"use client";

import { Check, CornerUpLeft, SkipForward, X } from "lucide-react";
import { useState } from "react";
import { Avatar, Kbd } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findingTitle, parseFinding } from "@/lib/findings";
import { describeRule } from "@/lib/rules";
import type { Correlation, EvidenceRef, Finding, ReviewDecision } from "@/lib/types";
import { ConfidenceMeter } from "./confidence-meter";

function Side({
  finding,
  evidence,
  onOpen,
}: {
  finding: Finding;
  evidence: EvidenceRef[];
  onOpen: () => void;
}) {
  const view = parseFinding(finding);
  const title = findingTitle(finding);
  return (
    <li className="min-w-0 rounded-xl border border-border bg-surface/60 p-4">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-3 rounded-md text-left"
        aria-label={`Open ${title} for ${finding.identifier_value}`}
      >
        <Avatar src={view.avatarUrl} name={title} className="h-11 w-11 rounded-lg" />
        <span className="min-w-0">
          <span className="block truncate font-medium">{title}</span>
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {finding.identifier_value}
          </span>
        </span>
      </button>
      {view.fullname || view.bio ? (
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
          {view.fullname ? <span className="text-foreground">{view.fullname}. </span> : null}
          {view.bio}
        </p>
      ) : null}
      {evidence.length > 0 ? (
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3">
          {evidence.map((item, i) => (
            <div key={`${item.field}-${i}`} className="text-sm">
              <dt className="text-xs text-muted-foreground">{item.field.replace(/_/g, " ")}</dt>
              <dd className="break-all rounded bg-warning/10 px-1.5 py-0.5 font-mono text-xs">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

/** One link as a yes / no question: the items side by side, the reason in plain words. */
export function LinkQuestion({
  correlation: c,
  findings,
  position,
  total,
  pending,
  advanced,
  canUndo,
  onDecide,
  onSkip,
  onUndo,
  onOpenFinding,
}: {
  correlation: Correlation;
  findings: ReadonlyMap<string, Finding>;
  position: number;
  total: number;
  pending: boolean;
  advanced: boolean;
  canUndo: boolean;
  onDecide: (decision: ReviewDecision, note?: string) => void;
  onSkip: () => void;
  onUndo: () => void;
  onOpenFinding: (id: string) => void;
}) {
  const [note, setNote] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const rule = describeRule(c.type);
  const linked = c.entities_involved
    .map((id) => findings.get(id))
    .filter((f): f is Finding => f !== undefined);
  const missing = c.entities_involved.length - linked.length;
  const refs = c.evidence.filter((e): e is EvidenceRef => typeof e !== "string");
  const notes = c.evidence.filter((e): e is string => typeof e === "string");
  const decide = (d: ReviewDecision) => onDecide(d, note.trim() || undefined);

  return (
    <article
      aria-labelledby={`q-${c.id}`}
      data-tour="link-question"
      className="animate-rise-in space-y-5 rounded-2xl border border-border bg-card p-5 shadow-lift sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Link {position} of {total}
          </p>
          <h3 id={`q-${c.id}`} className="text-xl font-semibold tracking-tight sm:text-2xl">
            Do these belong to the same person?
          </h3>
        </div>
        <ConfidenceMeter confidence={c.confidence} />
      </header>

      <ul
        className={linked.length > 2 ? "grid gap-3 md:grid-cols-3" : "grid gap-3 md:grid-cols-2"}
        aria-label="Results in this link"
      >
        {linked.map((f) => (
          <Side
            key={f.id}
            finding={f}
            evidence={refs.filter((r) => r.finding_id === f.id)}
            onOpen={() => onOpenFinding(f.id)}
          />
        ))}
      </ul>
      {missing > 0 ? (
        <p className="text-sm text-muted-foreground">
          {missing} result{missing === 1 ? " in this link is" : "s in this link are"} no longer in
          this investigation.
        </p>
      ) : null}

      <div className="rounded-xl bg-muted/50 p-4">
        <p className="text-sm font-medium">Why we think so: {rule.title.toLowerCase()}</p>
        <p className="text-sm text-muted-foreground">{rule.summary}</p>
        {c.matched_value ? (
          <p className="mt-1 text-sm">
            Both share <span className="break-all font-mono text-xs">{c.matched_value}</span>
          </p>
        ) : null}
        {notes.length ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}
        {advanced ? (
          <p className="mt-2 font-mono text-2xs text-muted-foreground">
            rule {c.type} · priority {c.priority} · key {c.corr_key} · id {c.id}
          </p>
        ) : null}
      </div>

      {noteOpen ? (
        <Input
          autoFocus
          aria-label="Note for this decision (optional)"
          placeholder="Why you decided this (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      ) : null}

      <footer className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            size="lg"
            disabled={pending}
            onClick={() => decide("approve")}
            className="bg-success text-background hover:bg-success/90"
          >
            <Check aria-hidden />
            Yes, same
          </Button>
          <Button size="lg" variant="outline" disabled={pending} onClick={() => decide("reject")}>
            <X aria-hidden />
            No
          </Button>
          <Button size="lg" variant="ghost" onClick={onSkip}>
            <SkipForward aria-hidden />
            Skip
          </Button>
          {canUndo ? (
            <Button size="lg" variant="ghost" onClick={onUndo} disabled={pending}>
              <CornerUpLeft aria-hidden />
              Undo
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto">
          {!noteOpen ? (
            <button
              type="button"
              className="text-sm font-medium text-accent hover:underline"
              onClick={() => setNoteOpen(true)}
            >
              Add a note
            </button>
          ) : null}
          <p className="hidden items-center gap-1 text-xs text-muted-foreground lg:flex">
            <Kbd>Y</Kbd> yes <Kbd>N</Kbd> no <Kbd>J</Kbd> skip <Kbd>U</Kbd> undo
          </p>
        </div>
      </footer>
    </article>
  );
}
