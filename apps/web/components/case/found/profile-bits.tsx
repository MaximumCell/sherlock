"use client";

import { Briefcase, CalendarDays, GraduationCap, Link2, MapPin, Users } from "lucide-react";
import { useState, type ReactNode } from "react";
import { PlatformIcon } from "@/components/common/platform-icon";
import { safeUrl, type FindingView } from "@/lib/findings";
import { compactNumber, formatDate } from "@/lib/format";
import { resolvePlatform } from "@/lib/platforms";
import { cn } from "@/lib/utils";

/** "github.com/ada" for a link chip (no scheme, no trailing slash, no "www."). */
export function shortLink(href: string): string {
  return href
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

/** A profile's outbound links as tidy chips, each with its own platform icon. */
export function LinkChips({ links, max = 4 }: { links: readonly string[]; max?: number }) {
  const shown = links.slice(0, max);
  if (shown.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Links on the profile">
      {shown.map((link) => {
        const url = safeUrl(link);
        const platform = resolvePlatform(null, link);
        const body = (
          <>
            {platform.known ? (
              <PlatformIcon platform={platform.key} size="xs" />
            ) : (
              <Link2 className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className="truncate">{shortLink(link)}</span>
          </>
        );
        const chip =
          "relative z-10 inline-flex max-w-[14rem] items-center gap-1.5 rounded-[5px] border border-border bg-surface px-1.5 py-0.5 text-2xs";
        return (
          <li key={link} className="min-w-0">
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className={cn(chip, "hover:border-input hover:text-foreground")}
              >
                {body}
              </a>
            ) : (
              <span className={chip}>{body}</span>
            )}
          </li>
        );
      })}
      {links.length > max ? (
        <li className="self-center text-2xs text-muted-foreground">+{links.length - max} more</li>
      ) : null}
    </ul>
  );
}

function Fact({ icon: Icon, children }: { icon: typeof MapPin; children: ReactNode }) {
  return (
    <li className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-[5px] bg-muted px-1.5 py-0.5">
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{children}</span>
    </li>
  );
}

/** Location, followers, joined date and, for professional profiles, headline and employer. */
export function ProfileFacts({ view, extra = [] }: { view: FindingView; extra?: string[] }) {
  const items: ReactNode[] = [];
  if (view.headline && view.headline !== view.bio)
    items.push(
      <Fact key="headline" icon={Briefcase}>
        {view.headline}
      </Fact>,
    );
  if (view.employer)
    items.push(
      <Fact key="employer" icon={Briefcase}>
        {view.employer}
      </Fact>,
    );
  if (view.education)
    items.push(
      <Fact key="education" icon={GraduationCap}>
        {view.education}
      </Fact>,
    );
  if (view.location)
    items.push(
      <Fact key="location" icon={MapPin}>
        {view.location}
      </Fact>,
    );
  if (view.followers !== null)
    items.push(
      <Fact key="followers" icon={Users}>
        {compactNumber(view.followers)} followers
      </Fact>,
    );
  if (view.createdAt)
    items.push(
      <Fact key="joined" icon={CalendarDays}>
        Joined {formatDate(view.createdAt)}
      </Fact>,
    );
  for (const e of extra)
    items.push(
      <li key={e} className="rounded-[5px] bg-muted px-1.5 py-0.5">
        {e}
      </li>,
    );
  if (items.length === 0) return null;
  return <ul className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">{items}</ul>;
}

/** Bio clamped to three lines, with a "More" toggle when it is long. */
export function ClampedText({ text, lines = 3 }: { text: string; lines?: 2 | 3 }) {
  const [open, setOpen] = useState(false);
  const long = text.length > (lines === 2 ? 90 : 140);
  return (
    <div className="text-sm text-muted-foreground">
      <p
        className={cn(
          "whitespace-pre-line break-words",
          !open && (lines === 2 ? "line-clamp-2" : "line-clamp-3"),
        )}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="relative z-10 mt-0.5 text-xs font-medium text-accent hover:underline"
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}
