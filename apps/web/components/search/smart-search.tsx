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
  const sources = useMemo(
    () => (type ? sourcesFor(catalogue.data?.modules ?? [], type) : []),
    [catalogue.data, type],
  );
  const needsSignIn = type !== null && TARGET_TYPE_META[type].requiresSignIn && (session.data?.anonymous ?? true);

  const setValue = (next: string) => {
    if (onValueChange) onValueChange(next);
    else setOwn(next);
    if (error) setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return setError("Type a username, email, website, IP, phone, wallet, image link or name.");
    if (!type) return setError("We could not tell what this is. Choose a type with the chip below the box.");
    const result = validateTarget(type, value);
    if (!result.ok) return setError(result.error);
    if (needsSignIn) return setError("Searching a person's name needs a signed-in account.");
    const included = sources.filter((m) => m.available && !options.excluded.includes(m.name));
    if (sources.length > 0 && included.length === 0) return setError("Pick at least one data source in More options.");
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
    <form onSubmit={submit} noValidate className="w-full space-y-3" role="search" aria-label="Start a search">
      <div
        className={cn(
          "flex items-center gap-2 border border-input bg-card shadow-lift transition-shadow focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15",
          hero ? "rounded-2xl p-2 pl-4" : "rounded-xl p-1.5 pl-3",
        )}
      >
        <Search className={cn("shrink-0 text-muted-foreground", hero ? "h-5 w-5" : "h-4 w-4")} aria-hidden />
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
          placeholder={hero ? "A username, email, website, IP, phone, wallet or name" : "Username, email, website…"}
          className={cn(
            "min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80 focus-visible:ring-0 focus-visible:ring-offset-0",
            hero ? "h-11 text-lg" : "h-9 text-base",
          )}
        />
        <Button type="submit" size={hero ? "lg" : "default"} disabled={pending} className={hero ? "rounded-xl" : "rounded-lg"}>
          <span className={cn(hero ? "" : "sr-only sm:not-sr-only")}>{pending ? "Starting…" : submitLabel}</span>
          <ArrowRight aria-hidden />
        </Button>
      </div>

      <div className={cn("flex flex-wrap items-center gap-2", hero && "justify-center")}>
        {value.trim() || chosen ? (
          <TypeChip
            type={type}
            chosen={chosen !== null}
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
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          More options
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", more && "rotate-180")} aria-hidden />
        </button>
      </div>

      {error ? (
        <p id={errorId} role="alert" className={cn("text-sm text-danger", hero && "text-center")}>
          {error}
        </p>
      ) : null}

      {type === "name" ? (
        <div className="space-y-3 text-left">
          {needsSignIn ? (
            <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm sm:flex-row sm:items-center">
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
