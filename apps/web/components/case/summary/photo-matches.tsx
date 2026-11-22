"use client";

import { Clock, ExternalLink } from "lucide-react";
import type { EngineLink, PhotoMatch } from "@/lib/photo-results";

/** Pages showing a copy of the same image (Google Lens via SerpApi). Never "the same face". */
export function PhotoMatchList({
  matches,
  searched,
}: {
  matches: PhotoMatch[];
  searched: boolean;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Where this image appears</h4>
      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {searched
            ? "No copies of this image were found on the web."
            : "No matches yet. They appear here when the search finishes, if reverse image search is set up on this server."}
        </p>
      ) : (
        <ul
          className="divide-y divide-border rounded-lg border border-border"
          aria-label="Reverse image matches"
        >
          {matches.slice(0, 10).map((m) => (
            <li key={m.id}>
              <a
                href={m.link}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex min-w-0 items-center gap-3 p-2.5 transition-colors duration-1 hover:bg-muted/50"
              >
                {m.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element -- third-party thumbnail, never proxied
                  <img
                    src={m.thumbnail}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-11 w-11 shrink-0 rounded border border-border object-cover"
                  />
                ) : (
                  <span
                    className="h-11 w-11 shrink-0 rounded border border-border bg-muted"
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{m.source}</span>
                </span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        Matches are copies of the same picture, not the same face. Sherlock does no face
        recognition.
      </p>
    </div>
  );
}

/** Ready-made searches on other engines; for an uploaded photo they expire after an hour. */
export function EngineLinks({ links, note }: { links: EngineLink[]; note: string | null }) {
  if (links.length === 0) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">Search it yourself</h4>
      <ul className="flex flex-wrap gap-2" aria-label="Reverse image search links">
        {links.map((l) => (
          <li key={l.key}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-sm transition-colors duration-1 hover:bg-muted"
            >
              {l.label}
              <ExternalLink className="h-3 w-3 text-muted-foreground" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
      {note ? (
        <p
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
          data-testid="links-note"
        >
          <Clock className="h-3 w-3 shrink-0" aria-hidden />
          {note}
        </p>
      ) : null}
    </div>
  );
}
