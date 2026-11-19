"use client";

import {
  AtSign,
  Briefcase,
  CheckCircle2,
  ExternalLink,
  Link2,
  MapPin,
  UserCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { safeUrl } from "@/lib/findings";
import type { Candidate } from "@/lib/types";
import { useUrlState } from "@/lib/use-url-state";
import { cn } from "@/lib/utils";
import { goToSection } from "../section-nav";

function strength(score: number): {
  label: string;
  bar: string;
  badge: "success" | "warning" | "muted";
} {
  if (score >= 0.7) return { label: "Strong match", bar: "bg-success", badge: "success" };
  if (score >= 0.4) return { label: "Possible match", bar: "bg-warning", badge: "warning" };
  return { label: "Weak match", bar: "bg-muted-foreground/60", badge: "muted" };
}

function Facts({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">{label}: </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function CandidateCard({
  candidate,
  rank,
  anyConfirmed,
  pending,
  onConfirm,
}: {
  candidate: Candidate;
  rank: number;
  anyConfirmed: boolean;
  pending: boolean;
  onConfirm: () => void;
}) {
  const { set } = useUrlState();
  const s = strength(candidate.score);
  const pct = Math.round(candidate.score * 100);
  const { employers, locations, handles, links, sources } = candidate.attributes;

  return (
    <article
      aria-labelledby={`cand-${candidate.candidate_id}`}
      className={cn(
        "rounded-xl border bg-card p-5 shadow-soft transition-colors",
        candidate.confirmed ? "border-success/60 ring-1 ring-success/30" : "border-border",
        anyConfirmed && !candidate.confirmed && "opacity-70",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs text-muted-foreground">Candidate {rank}</p>
          <h3 id={`cand-${candidate.candidate_id}`} className="break-words text-base font-semibold">
            {candidate.label}
          </h3>
        </div>
        {candidate.confirmed ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden />
            Confirmed
          </Badge>
        ) : (
          <Badge variant={s.badge}>{s.label}</Badge>
        )}
      </header>

      <div className="mt-3 flex items-center gap-3">
        <div
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Match score"
        >
          <div
            className={cn("h-full rounded-full", s.bar)}
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <span className="w-10 text-right text-xs tabular-nums">{pct}%</span>
      </div>

      {candidate.evidence.length ? (
        <div className="mt-4">
          <h4 className="mb-1.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
            Why we think so
          </h4>
          <ul className="space-y-1 text-sm">
            {candidate.evidence.map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                <span className="min-w-0 break-words">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {employers.length ? (
          <Facts icon={Briefcase} label="Employers">
            {employers.join(", ")}
          </Facts>
        ) : null}
        {locations.length ? (
          <Facts icon={MapPin} label="Locations">
            {locations.join(", ")}
          </Facts>
        ) : null}
        {handles.length ? (
          <Facts icon={AtSign} label="Handles">
            <ul className="flex flex-wrap gap-1.5">
              {handles.map((h) => {
                const url = safeUrl(h.url);
                const text = (
                  <>
                    <span className="font-mono">{h.handle}</span>
                    {h.platform ? (
                      <span className="text-muted-foreground"> · {h.platform}</span>
                    ) : null}
                  </>
                );
                return (
                  <li
                    key={`${h.platform}-${h.handle}`}
                    className="max-w-full truncate rounded border border-border px-1.5 py-0.5 text-xs"
                  >
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="hover:text-accent"
                      >
                        {text}
                      </a>
                    ) : (
                      text
                    )}
                  </li>
                );
              })}
            </ul>
          </Facts>
        ) : null}
        {links.length ? (
          <Facts icon={Link2} label="Links">
            <ul className="space-y-0.5">
              {links.map((link) => {
                const url = safeUrl(link);
                return (
                  <li key={link} className="truncate text-xs">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        {link}
                        <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    ) : (
                      link
                    )}
                  </li>
                );
              })}
            </ul>
          </Facts>
        ) : null}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {sources.length ? `Seen on: ${sources.join(", ")}` : "No sources listed"}
          {candidate.finding_ids.length ? (
            <>
              {" · "}
              <button
                type="button"
                className="rounded text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => set({ finding: candidate.finding_ids[0] ?? null }, "push")}
              >
                {candidate.finding_ids.length} result{candidate.finding_ids.length === 1 ? "" : "s"}
              </button>
            </>
          ) : null}
        </p>
        {candidate.confirmed ? (
          <Button variant="outline" size="sm" onClick={() => goToSection("next")}>
            See suggested searches
          </Button>
        ) : (
          <Button
            size="sm"
            variant={rank === 1 && !anyConfirmed ? "default" : "outline"}
            disabled={pending}
            onClick={onConfirm}
          >
            <UserCheck aria-hidden />
            {pending ? "Confirming…" : "This is the person"}
          </Button>
        )}
      </footer>
    </article>
  );
}
