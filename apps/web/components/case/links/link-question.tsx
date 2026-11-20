"use client";

import { Check, CornerUpLeft, SkipForward, X } from "lucide-react";
import { m, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useRef, useState } from "react";
import { Kbd } from "@/components/common/bits";
import { useTouchDevice } from "@/components/motion/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { accountsInLink, type AccountIndex } from "@/lib/accounts";
import { describeRule } from "@/lib/rules";
import type { Correlation, EvidenceRef, ReviewDecision } from "@/lib/types";
import { swipeDecision } from "@/lib/ui/swipe";
import { cn } from "@/lib/utils";
import { AccountSide } from "./account-side";
import { ConfidenceMeter } from "./confidence-meter";

const PICTURE_RULES = new Set(["avatar_match", "shared_avatar"]);

/** What the two sides share, drawn as the line between them. */
function Connector({ value, rule }: { value: string | null; rule: string }) {
  return (
    <div className="relative flex min-w-0 flex-col items-center justify-center gap-2 py-2 md:w-44 md:py-0">
      <svg
        aria-hidden
        className="absolute inset-y-0 left-1/2 h-full w-px -translate-x-1/2 overflow-visible md:inset-x-0 md:left-0 md:top-1/2 md:h-px md:w-full md:-translate-y-1/2 md:translate-x-0"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          pathLength={1}
          strokeDasharray="1"
          className="hidden stroke-warning animate-[draw_600ms_var(--ease-out)_both] md:block"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="50"
          y1="0"
          x2="50"
          y2="100"
          className="stroke-warning/70 md:hidden"
          strokeWidth="2"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="relative z-10 rounded-md border border-warning/40 bg-popover px-2 py-1 text-center text-2xs text-muted-foreground">
        {rule}
      </span>
      {value ? (
        <span className="relative z-10 max-w-full break-all rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-center font-mono text-xs text-foreground">
          {value}
        </span>
      ) : null}
    </div>
  );
}

/**
 * One link as a yes / no question: the accounts face each other, the shared evidence sits on
 * the line between them. Buttons, keys (Y, N, J, U) or, on touch screens, a swipe right/left.
 */
export function LinkQuestion({
  correlation: c,
  index,
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
  index: AccountIndex;
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
  const touch = useTouchDevice();
  const cardRef = useRef<HTMLElement>(null);
  const x = useMotionValue(0);
  const yesHint = useTransform(x, [0, 110], [0, 1]);
  const noHint = useTransform(x, [-110, 0], [1, 0]);
  const rule = describeRule(c.type);
  const linked = accountsInLink(c, index);
  const missing = c.entities_involved.filter((id) => !index.byFinding.has(id)).length;
  const refs = c.evidence.filter((e): e is EvidenceRef => typeof e !== "string");
  const notes = c.evidence.filter((e): e is string => typeof e === "string");
  const pictureMatch = PICTURE_RULES.has(c.type);
  const decide = (d: ReviewDecision) => onDecide(d, note.trim() || undefined);
  const pair = linked.length === 2;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const width = cardRef.current?.offsetWidth ?? 360;
    const decision = swipeDecision(info.offset.x, info.velocity.x, width);
    if (decision && !pending) decide(decision);
  };

  return (
    <m.article
      ref={cardRef}
      aria-labelledby={`q-${c.id}`}
      data-tour="link-question"
      drag={touch ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      dragSnapToOrigin
      onDragEnd={onDragEnd}
      style={{ x }}
      className="panel relative space-y-6 overflow-hidden p-5 shadow-lift sm:p-7"
    >
      {touch ? (
        <>
          <m.span
            aria-hidden
            style={{ opacity: yesHint }}
            className="pointer-events-none absolute inset-0 rounded-xl border-2 border-success bg-success/5"
          />
          <m.span
            aria-hidden
            style={{ opacity: noHint }}
            className="pointer-events-none absolute inset-0 rounded-xl border-2 border-danger bg-danger/5"
          />
        </>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="eyebrow" aria-live="polite">
            Link {position} of {total}
          </p>
          <ol aria-hidden className="flex gap-1">
            {Array.from({ length: Math.min(total, 24) }, (_, i) => (
              <li
                key={i}
                className={cn(
                  "h-1 w-5 rounded-full transition-colors duration-3",
                  i < position - 1
                    ? "bg-accent"
                    : i === position - 1
                      ? "bg-foreground"
                      : "bg-muted",
                )}
              />
            ))}
          </ol>
          <h3 id={`q-${c.id}`} className="font-display text-3xl tracking-tight sm:text-4xl">
            {rule.question}
          </h3>
        </div>
        <ConfidenceMeter confidence={c.confidence} />
      </header>

      <ul
        className={cn(
          "grid gap-3",
          pair
            ? "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
            : linked.length > 2
              ? "md:grid-cols-3"
              : "md:grid-cols-2",
        )}
        aria-label="Accounts in this link"
      >
        {linked.map((acc, i) => (
          <AccountSideWithConnector key={acc.key} showConnector={pair && i === 1}>
            <Connector value={c.matched_value ?? null} rule={rule.title} />
            <AccountSide
              account={acc}
              refs={refs}
              onOpen={() => onOpenFinding(acc.primary.id)}
              pictureMatch={pictureMatch}
            />
          </AccountSideWithConnector>
        ))}
      </ul>
      {pictureMatch ? (
        <p className="text-sm text-muted-foreground">
          Compare the two pictures. A match means the same image was used, not that it shows the
          same face: Sherlock does no face recognition.
        </p>
      ) : null}
      {missing > 0 ? (
        <p className="text-sm text-muted-foreground">
          {missing} result{missing === 1 ? " in this link is" : "s in this link are"} no longer in
          this investigation.
        </p>
      ) : null}

      <div className="rounded-lg border border-border bg-surface/70 p-4">
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
            <kbd className="ml-1 hidden rounded border border-background/30 px-1 font-mono text-2xs lg:inline">
              Y
            </kbd>
          </Button>
          <Button size="lg" variant="outline" disabled={pending} onClick={() => decide("reject")}>
            <X aria-hidden />
            No
            <kbd className="ml-1 hidden rounded border border-border px-1 font-mono text-2xs text-muted-foreground lg:inline">
              N
            </kbd>
          </Button>
          <Button size="lg" variant="ghost" onClick={onSkip}>
            <SkipForward aria-hidden />
            Skip
            <kbd className="ml-1 hidden rounded border border-border px-1 font-mono text-2xs lg:inline">
              J
            </kbd>
          </Button>
          {canUndo ? (
            <Button size="lg" variant="ghost" onClick={onUndo} disabled={pending}>
              <CornerUpLeft aria-hidden />
              Undo
              <kbd className="ml-1 hidden rounded border border-border px-1 font-mono text-2xs lg:inline">
                U
              </kbd>
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
          {touch ? (
            <p className="text-xs text-muted-foreground">Swipe right for yes, left for no</p>
          ) : (
            <p className="hidden items-center gap-1 text-xs text-muted-foreground lg:flex">
              <Kbd>K</Kbd> previous
            </p>
          )}
        </div>
      </footer>
    </m.article>
  );
}

/** The second account of a pair gets the connector in front of it (between the two). */
function AccountSideWithConnector({
  showConnector,
  children,
}: {
  showConnector: boolean;
  children: [React.ReactNode, React.ReactNode];
}) {
  const [connector, side] = children;
  return (
    <>
      {showConnector ? <li className="list-none">{connector}</li> : null}
      {side}
    </>
  );
}
