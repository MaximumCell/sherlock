"use client";

import { CircleCheckBig, CornerUpLeft, Link2, List, MessageCircleQuestion } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import { useMemo, useState } from "react";
import { EmptyState, ErrorState } from "@/components/common/states";
import { InfoHint } from "@/components/common/info-hint";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdvanced } from "@/lib/preferences";
import { useReview } from "@/lib/query/mutations";
import { buildAccounts, isSameAccount, linkRows } from "@/lib/accounts";
import { countByStatus, filterQueue } from "@/lib/review";
import type { Correlation, CorrelationStatus, Finding, ReviewDecision } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { CaseSection } from "../section";
import { LinkList } from "./link-list";
import { LinkQuestion } from "./link-question";
import { useLinkKeys } from "./use-link-keys";

/** The answered card flies off to its side with a tint; the next one rises in. */
const CARD_MOTION = {
  enter: { opacity: 0, y: 16, scale: 0.98 },
  center: { opacity: 1, y: 0, x: 0, rotate: 0, scale: 1, transition: { duration: 0.3 } },
  leave: (dir: number) => ({
    opacity: 0,
    x: dir * 240,
    y: dir === 0 ? -12 : 0,
    rotate: dir * 4,
    transition: { duration: 0.32 },
  }),
};

const UNDO: Record<CorrelationStatus, ReviewDecision> = {
  pending: "reset",
  approved: "approve",
  rejected: "reject",
};

function LinksHint() {
  return (
    <InfoHint label="What are possible links?" title="Possible links">
      <p>
        After each search, a set of rules looks for results that seem to belong to the same person:
        the same handle, email, profile picture or website.
      </p>
      <p>
        Each one is only a suggestion. Your yes or no decides what goes into the score and the
        report.
      </p>
      <p>
        When several sources report the same account, it is shown once instead of being asked about.
        Those are listed under Merged automatically, where you can split them.
      </p>
    </InfoHint>
  );
}

/** Possible links, asked one question at a time, with the full list one click away. */
export function LinksSection({
  caseId,
  correlations,
  findings,
  loading,
  error,
  onRetry,
  active,
  scanning,
}: {
  caseId: string;
  correlations: Correlation[];
  findings: Finding[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  active: boolean;
  scanning: boolean;
}) {
  const { params, set } = useUrlState();
  const review = useReview(caseId);
  const [advanced] = useAdvanced();
  const [listMode, setListMode] = useState(() => params.get("status") !== null);
  const [index, setIndex] = useState(0);
  const [decided, setDecided] = useState(0);
  const [history, setHistory] = useState<{ id: string; previous: CorrelationStatus }[]>([]);
  // which way the answered card leaves: right for yes, left for no, up for skip
  const [leaving, setLeaving] = useState<-1 | 0 | 1>(0);

  // automatic same_account merges are never questions and never count as "to check"
  const links = useMemo(() => linkRows(correlations), [correlations]);
  const merges = useMemo(() => correlations.filter(isSameAccount), [correlations]);
  const accounts = useMemo(() => buildAccounts(findings, correlations), [findings, correlations]);
  const queue = useMemo(() => filterQueue(links, "pending"), [links]);
  const counts = useMemo(
    () => ({ ...countByStatus(links), merged: merges.length }),
    [links, merges],
  );
  const byId = useMemo(() => new Map(findings.map((f) => [f.id, f])), [findings]);
  const current = queue.length ? queue[index % queue.length] : undefined;
  const dialogOpen = Boolean(params.get("finding"));

  const decide = (c: Correlation, decision: ReviewDecision, note?: string) => {
    setLeaving(decision === "approve" ? 1 : decision === "reject" ? -1 : 0);
    setHistory((h) => [...h, { id: c.id, previous: c.status }]);
    if (c.status === "pending" && decision !== "reset") setDecided((d) => d + 1);
    review.mutate({ id: c.id, decision, note });
  };
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    if (last.previous === "pending") setDecided((d) => Math.max(0, d - 1));
    review.mutate({ id: last.id, decision: UNDO[last.previous] });
  };
  const move = (delta: number) => {
    setLeaving(0);
    stepIndex(delta);
  };
  const stepIndex = (delta: number) =>
    setIndex((i) => (queue.length ? (i + delta + queue.length) % queue.length : 0));

  useLinkKeys({
    enabled: active && !listMode && !dialogOpen && current !== undefined,
    onYes: () => current && decide(current, "approve"),
    onNo: () => current && decide(current, "reject"),
    onNext: () => move(1),
    onPrev: () => move(-1),
    onUndo: undo,
  });

  const toggle = (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={listMode}
      onClick={() => setListMode((v) => !v)}
    >
      {listMode ? <MessageCircleQuestion aria-hidden /> : <List aria-hidden />}
      {listMode ? "One at a time" : `See all links (${counts.all + counts.merged})`}
    </Button>
  );

  return (
    <CaseSection
      id="links"
      title="Possible links"
      hint={<LinksHint />}
      description="Accounts that may belong to the same person. Nothing is treated as connected until you say so."
      actions={correlations.length ? toggle : null}
    >
      {error ? (
        <ErrorState title="Could not load the links" error={error} onRetry={onRetry} />
      ) : loading ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : links.length === 0 && !listMode ? (
        <EmptyState icon={Link2} title={scanning ? "Looking for links" : "No possible links yet"}>
          {scanning
            ? "Links are suggested as results arrive. Questions will appear here when there is something to check."
            : "Nothing here looks connected yet. Searching another identifier from Next steps can surface links."}
          {merges.length
            ? ` ${merges.length} account${merges.length === 1 ? " was" : "s were"} merged automatically; see all links to check them.`
            : ""}
        </EmptyState>
      ) : listMode ? (
        <LinkList
          correlations={links}
          merges={merges}
          accounts={accounts}
          findings={byId}
          counts={counts}
          filter={params.get("status")}
          onFilter={(status) => set({ status: status === "pending" ? null : status })}
          onDecide={decide}
          onOpenFinding={(id) => set({ finding: id })}
          keysEnabled={active && listMode && !dialogOpen}
          advanced={advanced}
          pendingId={review.isPending ? review.variables?.id : undefined}
        />
      ) : current ? (
        <AnimatePresence mode="popLayout" initial={false} custom={leaving}>
          <m.div
            key={current.id}
            custom={leaving}
            variants={CARD_MOTION}
            initial="enter"
            animate="center"
            exit="leave"
          >
            <LinkQuestion
              correlation={current}
              index={accounts}
              position={decided + (index % queue.length) + 1}
              total={decided + queue.length}
              pending={review.isPending}
              advanced={advanced}
              canUndo={history.length > 0}
              onDecide={(d, note) => decide(current, d, note)}
              onSkip={() => move(1)}
              onUndo={undo}
              onOpenFinding={(id) => set({ finding: id })}
            />
          </m.div>
        </AnimatePresence>
      ) : (
        <EmptyState
          icon={CircleCheckBig}
          title="All links checked"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {history.length ? (
                <Button variant="outline" onClick={undo}>
                  <CornerUpLeft aria-hidden />
                  Undo last decision
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setListMode(true)}>
                <List aria-hidden />
                Review your decisions
              </Button>
            </div>
          }
        >
          {counts.approved} confirmed and {counts.rejected} rejected. Your report and score use
          these decisions.
        </EmptyState>
      )}
    </CaseSection>
  );
}
