"use client";

import { MapPin, Pin } from "lucide-react";
import { Avatar } from "@/components/common/bits";
import { findingTitle, parseFinding, type FindingView } from "@/lib/findings";
import { compactNumber, formatDate } from "@/lib/format";
import type { Finding } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The two or three facts that make a result worth a look, by kind. */
export function keyFacts(view: FindingView): string[] {
  if (view.breach) {
    return [
      view.breach.date ? `Breached ${formatDate(view.breach.date)}` : "Breach listing",
      view.breach.dataClasses.slice(0, 3).join(", "),
    ].filter(Boolean);
  }
  if (view.network) {
    return [
      `${view.network.ports.length} open port${view.network.ports.length === 1 ? "" : "s"}`,
      view.network.vulns.length ? `${view.network.vulns.length} known vulnerabilities` : "",
    ].filter(Boolean);
  }
  if (view.dns) {
    return [
      `${Object.keys(view.dns.records).join(", ")} records`,
      view.dns.dmarc === false ? "No DMARC policy" : view.dns.spf === false ? "No SPF record" : "",
    ].filter(Boolean);
  }
  if (view.wallet) {
    return [
      view.wallet.balance ? `${view.wallet.balance} ${view.wallet.unit}` : "",
      view.wallet.txCount !== null ? `${compactNumber(view.wallet.txCount)} transactions` : "",
    ].filter(Boolean);
  }
  if (view.image) {
    return [
      view.image.gpsPresent ? "Carries GPS location" : "",
      view.image.camera ?? "",
      view.image.width && view.image.height ? `${view.image.width} × ${view.image.height}` : "",
    ].filter(Boolean);
  }
  if (view.activity?.offsetLabel) return [`Active hours suggest ${view.activity.offsetLabel}`];
  return [
    view.followers !== null ? `${compactNumber(view.followers)} followers` : "",
    view.createdAt ? `Since ${formatDate(view.createdAt)}` : "",
    view.emails.length
      ? `${view.emails.length} email${view.emails.length === 1 ? "" : "s"} shown`
      : "",
  ].filter(Boolean);
}

/** A rich, clickable result card used in the "What we found" highlights. */
export function ResultCard({
  finding,
  onOpen,
  onPin,
}: {
  finding: Finding;
  onOpen: () => void;
  onPin: (pinned: boolean) => void;
}) {
  const view = parseFinding(finding);
  const title = findingTitle(finding);
  const facts = keyFacts(view);
  const snippet = view.bio ?? view.error ?? null;

  return (
    <li className="group relative flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-soft transition-[border-color,box-shadow] hover:border-input hover:shadow-lift">
      <div className="flex items-start gap-3">
        <Avatar src={view.avatarUrl} name={title} className="h-10 w-10 rounded-lg" />
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onOpen}
            className="block max-w-full truncate text-left font-medium after:absolute after:inset-0 after:rounded-xl"
          >
            {title}
          </button>
          <p className="truncate text-sm text-muted-foreground">
            {view.fullname ? <span className="text-foreground/80">{view.fullname} · </span> : null}
            <span className="font-mono text-xs">{finding.identifier_value}</span>
          </p>
        </div>
        <button
          type="button"
          aria-pressed={finding.curated}
          aria-label={`${finding.curated ? "Unpin" : "Pin"} ${title}`}
          onClick={() => onPin(!finding.curated)}
          className={cn(
            "relative z-10 rounded-md p-1.5 transition-colors hover:bg-muted",
            finding.curated
              ? "text-accent"
              : "text-muted-foreground opacity-60 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Pin className={cn("h-4 w-4", finding.curated && "fill-current")} aria-hidden />
        </button>
      </div>
      {snippet ? <p className="line-clamp-2 text-sm text-muted-foreground">{snippet}</p> : null}
      {facts.length || view.location ? (
        <ul className="mt-auto flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {view.location ? (
            <li className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
              <MapPin className="h-3 w-3" aria-hidden />
              {view.location}
            </li>
          ) : null}
          {facts.map((fact) => (
            <li key={fact} className="rounded-full bg-muted px-2 py-0.5">
              {fact}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
