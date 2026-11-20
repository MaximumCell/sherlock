"use client";

import { ChevronDown, HelpCircle, Lock } from "lucide-react";
import { useState } from "react";
import { TargetIcon } from "@/components/common/bits";
import { TargetTypePicker } from "@/components/cases/target-type-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ChipState } from "@/lib/ui/search-hints";
import type { TargetType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TARGET_TYPE_META } from "@/lib/validation";

/**
 * Shows what the box thinks you typed ("Looks like an email address · change") and lets you
 * correct it. It re-enters with a short animation each time the guess changes.
 */
export function TypeChip({
  chip,
  onChange,
}: {
  chip: ChipState;
  onChange: (type: TargetType) => void;
}) {
  const [open, setOpen] = useState(false);
  const { type } = chip;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          key={`${chip.kind}:${type ?? "none"}`}
          type="button"
          aria-label={`${chip.phrase}. ${chip.action === "choose" ? "Choose" : "Change"} the type`}
          className={cn(
            "group inline-flex max-w-full animate-chip-in items-center gap-1.5 rounded-md border bg-popover/80 py-1 pl-2 pr-2.5 text-sm backdrop-blur transition-colors duration-1 hover:border-input",
            chip.kind === "unsure" ? "border-dashed border-input" : "border-accent/35",
          )}
        >
          {type ? (
            <TargetIcon type={type} className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className={cn("truncate", chip.kind === "unsure" && "text-muted-foreground")}>
            {chip.phrase}
          </span>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="inline-flex items-center gap-0.5 font-medium text-accent">
            {chip.action}
            <ChevronDown
              className="h-3.5 w-3.5 transition-transform duration-2 group-data-[state=open]:rotate-180"
              aria-hidden
            />
          </span>
          {type && TARGET_TYPE_META[type].requiresSignIn ? (
            <Lock className="h-3 w-3 shrink-0 text-warning" aria-label="requires sign-in" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
        <p className="eyebrow mb-2">Search this as</p>
        <TargetTypePicker
          value={type ?? "username"}
          onChange={(next) => {
            onChange(next);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
