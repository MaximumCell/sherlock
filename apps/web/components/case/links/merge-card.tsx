"use client";

import { Combine, Split } from "lucide-react";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { mergeExplanation } from "@/lib/accounts";
import { findingTitle, parseFinding } from "@/lib/findings";
import { bestPlatformLabel } from "@/lib/platforms";
import { sourceTitle } from "@/lib/sources";
import type { Correlation, EvidenceRef, Finding, ReviewDecision } from "@/lib/types";

/**
 * An account the engine merged automatically because several sources or lookups
 * describe it. Not a question: the user can split it, and merge it again.
 */
export function MergeCard({
  merge: m,
  findings,
  pending,
  advanced,
  onDecide,
  onOpenFinding,
}: {
  merge: Correlation;
  findings: ReadonlyMap<string, Finding>;
  pending: boolean;
  advanced: boolean;
  onDecide: (decision: ReviewDecision) => void;
  onOpenFinding: (id: string) => void;
}) {
  const members = m.entities_involved
    .map((id) => findings.get(id))
    .filter((f): f is Finding => f !== undefined);
  const contributions = new Map(
    m.evidence
      .filter((e): e is EvidenceRef => typeof e !== "string")
      .map((e) => [e.finding_id, e.value]),
  );
  const split = m.status === "rejected";
  const label = bestPlatformLabel(members.map((f) => f.platform)) || "Account";
  const handle = m.matched_value?.split(":")[1] ?? "";
  const avatar = members.map((f) => parseFinding(f).avatarUrl).find(Boolean) ?? null;
  const reason = mergeExplanation(m.evidence, label, handle || null);

  return (
    <article
      aria-label={`${label} ${handle}, ${split ? "split by you" : "merged automatically"}`}
      className="panel space-y-3 p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProfileAvatar
            src={avatar}
            name={label}
            platform={members[0]?.platform ?? null}
            size="sm"
            decorative
          />
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold">
              {label} <span className="font-mono text-sm font-normal">{handle}</span>
            </h3>
            <p className="text-sm text-muted-foreground">
              {split
                ? `Split by you: shown as ${members.length} separate results.`
                : `${members.length} results shown as one account.`}
            </p>
          </div>
        </div>
        <Badge variant={split ? "muted" : "success"}>
          {split ? "Split by you" : "Merged automatically"}
        </Badge>
      </header>
      {reason ? <p className="text-sm">{reason}</p> : null}
      <ul className="space-y-1 text-sm" aria-label="Sources in this account">
        {members.map((f) => (
          <li key={f.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <button
              type="button"
              onClick={() => onOpenFinding(f.id)}
              className="font-medium text-accent hover:underline"
            >
              {sourceTitle(f.module ?? f.source_tool)}
            </button>
            <span className="min-w-0 break-words text-muted-foreground">
              {findingTitle(f)}, searched {f.identifier_type}{" "}
              <span className="font-mono text-xs">{f.identifier_value}</span>
              {contributions.get(f.id) ? ` · ${contributions.get(f.id)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {m.review_note ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          <span className="text-muted-foreground">Your note: </span>
          {m.review_note}
        </p>
      ) : null}
      {advanced ? (
        <p className="font-mono text-2xs text-muted-foreground">
          rule {m.type} · key {m.matched_value} · id {m.id}
        </p>
      ) : null}
      <footer className="flex justify-end border-t border-border pt-3">
        {split ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onDecide("reset")}>
            <Combine aria-hidden />
            Merge again
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => onDecide("reject")}>
            <Split aria-hidden />
            Split these
          </Button>
        )}
      </footer>
    </article>
  );
}
