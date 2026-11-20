"use client";

import { ArrowRight, ChevronDown, LogIn, Search } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";
import { NameHintsFields } from "@/components/cases/name-hints-fields";
import { Button } from "@/components/ui/button";
import { detectTarget } from "@/lib/detect-target";
import { useModules, useSession } from "@/lib/query/hooks";
import { requestSignIn } from "@/lib/sign-in-prompt";
import { sourcesFor } from "@/lib/sources";
import { hasAcknowledged, recordAcknowledgement } from "@/lib/storage";
import type { NameHints, TargetType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TARGET_TYPE_META, validateTarget } from "@/lib/validation";
import { AckDialog } from "./ack-dialog";
import { SearchOptions, type SearchOptionsValue } from "./search-options";
import { TypeChip } from "./type-chip";
import { TypewriterPlaceholder } from "./typewriter-placeholder";
import { chipState } from "@/lib/ui/search-hints";

export interface SmartSearchSubmit {
  type: TargetType;
  value: string;
  hints: NameHints;
  options: SearchOptionsValue;
  /** Only set when the user switched some data sources off. */
  modules?: string[];
}

/**
 * The one search box. It guesses the kind of target as you type, shows the guess as a chip
 * you can change, asks for the one-time acknowledgement, and hands a validated value to
 * `onSubmit` (which creates a case or adds a target).
 */
export function SmartSearch({
  size = "hero",
  value: controlled,
  onValueChange,
  initialType = null,
  autoFocus = false,
  showCaseFields = true,
  submitLabel = "Search",
  pending = false,
  examples,
  onSubmit,
}: {
  size?: "hero" | "compact";
  value?: string;
  onValueChange?: (value: string) => void;
  initialType?: TargetType | null;
  autoFocus?: boolean;
  showCaseFields?: boolean;
  submitLabel?: string;
  pending?: boolean;
  /** Fictional examples the hero placeholder types out. */
  examples?: readonly string[];
  onSubmit: (input: SmartSearchSubmit) => void;
}) {
  const id = useId();
  const session = useSession();
  const catalogue = useModules();
  const [own, setOwn] = useState("");
  const value = controlled ?? own;
  const [chosen, setChosen] = useState<TargetType | null>(initialType);
  const [hints, setHints] = useState<NameHints>({});
  const [more, setMore] = useState(false);
  const [options, setOptions] = useState<SearchOptionsValue>({ title: "", tags: "", excluded: [] });
  const [error, setError] = useState<string | null>(null);
  const [ackOpen, setAckOpen] = useState(false);
  const [queued, setQueued] = useState<SmartSearchSubmit | null>(null);

  const detected = useMemo(() => detectTarget(value), [value]);
  const type: TargetType | null = chosen ?? detected?.type ?? null;
  const chip = chipState(value, chosen, detected?.type ?? null);
  const sources = useMemo(
    () => (type ? sourcesFor(catalogue.data?.modules ?? [], type) : []),
    [catalogue.data, type],
  );
  const needsSignIn =
    type !== null && TARGET_TYPE_META[type].requiresSignIn && (session.data?.anonymous ?? true);

  const setValue = (next: string) => {
    if (onValueChange) onValueChange(next);
    else setOwn(next);
    if (error) setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim())
      return setError("Type a username, email, website, IP, phone, wallet, image link or name.");
    if (!type)
      return setError("We could not tell what this is. Choose a type with the chip below the box.");
    const result = validateTarget(type, value);
    if (!result.ok) return setError(result.error);
    if (needsSignIn) return setError("Searching a person's name needs a signed-in account.");
    const included = sources.filter((m) => m.available && !options.excluded.includes(m.name));
    if (sources.length > 0 && included.length === 0)
      return setError("Pick at least one data source in More options.");
    const narrowed = included.length < sources.filter((m) => m.available).length;
    const input: SmartSearchSubmit = {
      type,
      value: result.value,
      hints,
      options,
      modules: narrowed ? included.map((m) => m.name) : undefined,
    };
    if (!hasAcknowledged()) {
      setQueued(input);
      setAckOpen(true);
      return;
    }
    onSubmit(input);
  };

  const hero = size === "hero";
  const errorId = `${id}-error`;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="group/search w-full space-y-3"
      role="search"
      aria-label="Start a search"
    >
      <div
        data-pending={pending || undefined}
        className={cn(
          "relative flex items-center gap-2 border transition-[border-color,box-shadow,transform] duration-3 ease-out",
          hero
            ? "glass rounded-xl border-input p-2 pl-5 shadow-lift focus-within:border-accent/70 focus-within:shadow-glow data-[pending]:scale-[0.99] data-[pending]:border-accent data-[pending]:shadow-glow"
            : "rounded-lg border-input bg-background/60 p-1.5 pl-3 focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-ring/25",
        )}
      >
        {hero ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent opacity-0 transition-opacity duration-3 group-focus-within/search:opacity-100"
          />
        ) : null}
        <Search
          className={cn("shrink-0 text-muted-foreground", hero ? "h-5 w-5" : "h-4 w-4")}
          aria-hidden
        />
        <div className="relative min-w-0 flex-1">
          <input
            id={`${id}-input`}
            aria-label="What do you want to look into?"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            autoFocus={autoFocus}
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={hero && examples ? "" : "Username, email, website, IP, name…"}
            className={cn(
              "w-full min-w-0 bg-transparent outline-none placeholder:text-muted-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0",
              hero ? "h-12 text-lg sm:text-xl" : "h-9 text-base",
            )}
          />
          {hero && examples && !value ? (
            <TypewriterPlaceholder
              examples={examples}
              fallback="Username, email, website, IP, name…"
              className="pointer-events-none absolute inset-y-0 left-0 flex items-center truncate text-lg text-muted-foreground/80 sm:text-xl"
            />
          ) : null}
        </div>
        <Button
          type="submit"
          size={hero ? "lg" : "default"}
          disabled={pending}
          className={hero ? "rounded-lg px-5" : "rounded-md"}
        >
          <span className={cn(hero ? "" : "sr-only sm:not-sr-only")}>
            {pending ? "Starting…" : submitLabel}
          </span>
          <ArrowRight aria-hidden />
        </Button>
      </div>

      <div className="flex min-h-8 flex-wrap items-center gap-2" aria-live="polite">
        {chip.kind !== "empty" ? (
          <TypeChip
            chip={chip}
            onChange={(next) => {
              setChosen(next);
              setError(null);
            }}
          />
        ) : null}
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm text-muted-foreground transition-colors duration-1 hover:bg-muted hover:text-foreground"
        >
          More options
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")}
            aria-hidden
          />
        </button>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {type === "name" ? (
        <div className="space-y-3 text-left">
          {needsSignIn ? (
            <div className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/[0.08] p-3 text-sm sm:flex-row sm:items-center">
              <p className="flex-1">
                Name search needs a signed-in account. It is rate-limited to prevent misuse.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => requestSignIn()}>
                <LogIn aria-hidden />
                Sign in
              </Button>
            </div>
          ) : null}
          <NameHintsFields value={hints} onChange={setHints} idPrefix={`${id}-hint`} />
        </div>
      ) : null}

      {more ? (
        <SearchOptions
          idPrefix={id}
          value={options}
          onChange={setOptions}
          sources={sources}
          showCaseFields={showCaseFields}
        />
      ) : null}

      <AckDialog
        open={ackOpen}
        onOpenChange={setAckOpen}
        onConfirm={() => {
          recordAcknowledgement();
          setAckOpen(false);
          if (queued) onSubmit(queued);
        }}
      />
    </form>
  );
}
