"use client";

import { cn } from "@/lib/utils";
import { TypewriterPlaceholder } from "./typewriter-placeholder";

const FALLBACK = "Username, email, website, IP, name…";

/** The text field of the search box, with the typed-out examples on the hero. */
export function SearchInput({
  id,
  hero,
  value,
  onChange,
  autoFocus,
  examples,
  describedBy,
}: {
  id: string;
  hero: boolean;
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  examples?: readonly string[];
  /** The error message's id while one is shown. */
  describedBy?: string;
}) {
  return (
    <div className="relative min-w-0 flex-1">
      <input
        id={id}
        aria-label="What do you want to look into?"
        aria-invalid={describedBy ? true : undefined}
        aria-describedby={describedBy}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={hero && examples ? "" : FALLBACK}
        className={cn(
          "w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0",
          hero ? "h-12 text-lg sm:text-xl" : "h-9 text-base",
        )}
      />
      {hero && examples && !value ? (
        <TypewriterPlaceholder
          examples={examples}
          fallback={FALLBACK}
          className="pointer-events-none absolute inset-y-0 left-0 flex items-center truncate text-lg text-muted-foreground/80 sm:text-xl"
        />
      ) : null}
    </div>
  );
}
