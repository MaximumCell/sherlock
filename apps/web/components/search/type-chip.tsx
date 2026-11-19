"use client";

import { ChevronDown, HelpCircle, Lock } from "lucide-react";
import { useState } from "react";
import { TargetIcon } from "@/components/common/bits";
import { TargetTypePicker } from "@/components/cases/target-type-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DETECTION_LABEL } from "@/lib/detect-target";
import type { TargetType } from "@/lib/types";
import { TARGET_TYPE_META } from "@/lib/validation";

/**
 * Shows what the box thinks you typed ("Looks like an email · change") and lets you
 * correct it. `chosen` means the user picked the type by hand.
 */
export function TypeChip({
  type,
  chosen,
  onChange,
}: {
  type: TargetType | null;
  chosen: boolean;
  onChange: (type: TargetType) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = type ? DETECTION_LABEL[type] : null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            label
              ? `${chosen ? "Searching" : "Looks like"} ${label}. Change the type`
              : "Not sure what this is. Choose a type"
          }
          className="group inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-2 pr-2.5 text-sm shadow-soft transition-colors hover:border-input"
        >
          {type ? (
            <TargetIcon type={type} className="h-3.5 w-3.5 shrink-0 text-accent" />
          ) : (
            <HelpCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="truncate">
            {label ? (
              <>
                <span className="text-muted-foreground">{chosen ? "Searching as" : "Looks like"}</span>{" "}
                <span className="font-medium">{label}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Not sure what this is</span>
            )}
          </span>
          <span className="text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="inline-flex items-center gap-0.5 font-medium text-accent">
            {label ? "change" : "choose"}
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </span>
          {type && TARGET_TYPE_META[type].requiresSignIn ? (
            <Lock className="h-3 w-3 shrink-0 text-warning" aria-label="requires sign-in" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Search this as</p>
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
