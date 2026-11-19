"use client";

import { Lock } from "lucide-react";
import { TargetIcon } from "@/components/common/bits";
import { TARGET_TYPES, type TargetType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { TARGET_TYPE_META } from "@/lib/validation";

export function TargetTypePicker({
  value,
  onChange,
}: {
  value: TargetType;
  onChange: (type: TargetType) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Target type" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TARGET_TYPES.map((type) => {
        const meta = TARGET_TYPE_META[type];
        const selected = type === value;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(type)}
            className={cn(
              "flex flex-col items-start gap-1 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
              selected
                ? "border-accent bg-accent/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="flex w-full items-center gap-1.5 font-medium">
              <TargetIcon type={type} className={cn("h-3.5 w-3.5", selected && "text-accent")} />
              {meta.label}
            </span>
            {meta.requiresSignIn ? (
              <span className="flex items-center gap-1 text-2xs text-warning">
                <Lock className="h-3 w-3" aria-hidden />
                requires sign-in
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
