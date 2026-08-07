"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Icon } from "./_components/icon";
import { StatusBadge } from "./_components/status-badge";
import CaseActions from "./case-actions";

const TYPE_LABELS: Record<string, string> = {
  username: "username",
  email: "email",
  domain: "domain",
};

const TYPE_ICONS: Record<string, "at" | "mail" | "link"> = {
  username: "at",
  email: "mail",
  domain: "link",
};

interface CaseCardProps {
  caseRow: {
    id: string;
    identifiers: { type: string; value: string }[];
    status: string;
    created_at: string;
  };
  /** Pre-formatted "12h ago" string, computed on the server in page.tsx to
   *  avoid a hydration mismatch (calling Date.now() in a client component
   *  produces different values on the server vs. the client). */
  createdLabel: string;
}

/** Individual case card on the home page.
 * The card is a flex column with two parts:
 *   1. A <Link> covering the main content area — this is what navigates.
 *   2. A sibling action row (Run / +variations / Delete) — these buttons
 *      live OUTSIDE the Link, so clicks on them can never trigger navigation
 *      regardless of how the browser/Next.js dispatches click events.
 * Both parts sit inside a shared <div> that owns the hover styling. */
export default function CaseCard({ caseRow, createdLabel }: CaseCardProps) {
  const id = caseRow.id;
  const subject = caseRow.identifiers[0]?.value ?? "—";
  const subjectType = caseRow.identifiers[0]?.type ?? "username";
  const extraIdentifiers = caseRow.identifiers.slice(1);

  return (
    <div
      className="group relative rounded-lg border border-border/50 bg-card/60 backdrop-blur-sm transition-all duration-200 hover:border-accent/40 hover:bg-card/80 hover:shadow-[0_8px_24px_-12px_rgba(34,197,94,0.4)]"
    >
      <Link
        href={`/case/${id}`}
        className="block rounded-t-lg p-5 pb-4"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent border border-accent/20">
            <Icon name={TYPE_ICONS[subjectType] ?? "at"} size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[15px] font-semibold truncate text-foreground">
              {subject}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              {caseRow.identifiers.map((i, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-foreground/70"
                >
                  {TYPE_LABELS[i.type] ?? i.type}
                </span>
              ))}
              <StatusBadge status={caseRow.status} />
            </div>
            {extraIdentifiers.length > 0 && (
              <div className="mt-2 font-mono text-[11px] text-foreground/45 truncate">
                {extraIdentifiers.map((i) => i.value).join(" · ")}
              </div>
            )}
          </div>
          <ArrowUpRight className="h-4 w-4 shrink-0 text-foreground/30 transition-all group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </div>
      </Link>

      <div className="flex items-center justify-between border-t border-border/40 px-5 py-3 rounded-b-lg">
        <div className="text-[11px] text-foreground/45">
          <span className="font-mono">{id.slice(0, 8)}</span>
          <span className="mx-2 text-foreground/25">·</span>
          <span>{createdLabel}</span>
        </div>
        <CaseActions caseId={id} status={caseRow.status} compact />
      </div>
    </div>
  );
}
