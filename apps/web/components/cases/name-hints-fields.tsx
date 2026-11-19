"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { NameHints } from "@/lib/types";

const FIELDS: { key: keyof NameHints; label: string; placeholder: string }[] = [
  { key: "city", label: "City", placeholder: "Port Ellery" },
  { key: "employer", label: "Employer", placeholder: "Example Robotics" },
  { key: "school", label: "School", placeholder: "Harrowgate Academy" },
  { key: "keywords", label: "Keywords", placeholder: "rust, firmware" },
];

/** Optional context that helps rank people who share a name. */
export function NameHintsFields({
  value,
  onChange,
  idPrefix,
}: {
  value: NameHints;
  onChange: (next: NameHints) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium">
        Hints <span className="font-normal text-muted-foreground">(optional, sharpen the ranking)</span>
      </legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={`${idPrefix}-${f.key}`} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={`${idPrefix}-${f.key}`}
              maxLength={120}
              autoComplete="off"
              placeholder={f.placeholder}
              value={value[f.key] ?? ""}
              onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
