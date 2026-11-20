"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdvanced } from "@/lib/preferences";
import type { ModuleInfo } from "@/lib/types";

export interface SearchOptionsValue {
  title: string;
  tags: string;
  /** Data sources the user switched off. */
  excluded: string[];
}

/** "More options": title and tags (new investigations only) and which data sources to ask. */
export function SearchOptions({
  idPrefix,
  value,
  onChange,
  sources,
  showCaseFields,
}: {
  idPrefix: string;
  value: SearchOptionsValue;
  onChange: (next: SearchOptionsValue) => void;
  sources: ModuleInfo[];
  showCaseFields: boolean;
}) {
  const [advanced] = useAdvanced();
  const toggle = (name: string, on: boolean) =>
    onChange({
      ...value,
      excluded: on ? value.excluded.filter((n) => n !== name) : [...value.excluded, name],
    });

  return (
    <div className="space-y-5 rounded-lg border border-border bg-popover/80 p-4 text-left backdrop-blur">
      {showCaseFields ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-title`}>
              Title <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id={`${idPrefix}-title`}
              maxLength={120}
              placeholder="Self-exposure check"
              value={value.title}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-tags`}>
              Tags{" "}
              <span className="font-normal text-muted-foreground">(optional, comma-separated)</span>
            </Label>
            <Input
              id={`${idPrefix}-tags`}
              placeholder="client-a, self-check"
              value={value.tags}
              onChange={(e) => onChange({ ...value, tags: e.target.value })}
            />
          </div>
        </div>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Data sources to check</legend>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Type something first. The sources that can search it appear here.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {sources.map((m) => {
              const id = `${idPrefix}-src-${m.name}`;
              return (
                <li key={m.name} className="flex items-start gap-2">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    disabled={!m.available}
                    checked={m.available && !value.excluded.includes(m.name)}
                    onCheckedChange={(on) => toggle(m.name, on === true)}
                  />
                  <Label htmlFor={id} className="text-sm font-normal leading-snug">
                    {m.title}
                    {!m.available ? (
                      <span className="text-muted-foreground"> · not set up</span>
                    ) : null}
                    {advanced ? (
                      <span className="block font-mono text-2xs text-muted-foreground">
                        {m.name}
                      </span>
                    ) : null}
                  </Label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
    </div>
  );
}
