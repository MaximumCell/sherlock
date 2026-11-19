"use client";

import { Search, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import type { Facet, FindingFilters } from "@/lib/findings";
import type { ParamPatch } from "@/lib/use-url-state";

const ALL = "__all__";

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: Facet[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className="sm:w-44" aria-label={`Filter by ${label.toLowerCase()}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All {label.toLowerCase()}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.value} ({option.count})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FindingsFilters({
  filters,
  facets,
  hiddenMisses,
  onChange,
}: {
  filters: FindingFilters;
  facets: { modules: Facet[]; platforms: Facet[]; categories: Facet[] };
  hiddenMisses: number;
  onChange: (patch: ParamPatch) => void;
}) {
  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="relative min-w-0 flex-1 lg:min-w-56">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search findings"
          placeholder="Search platform, handle, bio…"
          className="pl-8"
          defaultValue={filters.query}
          onChange={(e) => onChange({ q: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:flex">
        <FacetSelect
          label="Modules"
          value={filters.module}
          options={facets.modules}
          onChange={(v) => onChange({ module: v })}
        />
        <FacetSelect
          label="Categories"
          value={filters.category}
          options={facets.categories}
          onChange={(v) => onChange({ category: v })}
        />
        <FacetSelect
          label="Platforms"
          value={filters.platform}
          options={facets.platforms}
          onChange={(v) => onChange({ platform: v })}
        />
      </div>
      <div className="flex items-center gap-3">
        <Toggle
          variant="outline"
          size="sm"
          pressed={filters.curatedOnly}
          onPressedChange={(pressed) => onChange({ curated: pressed ? "1" : null })}
          aria-label="Show shortlisted findings only"
        >
          <Star aria-hidden />
          Shortlist
        </Toggle>
        <div className="flex items-center gap-2">
          <Switch
            id="show-misses"
            checked={filters.includeMisses}
            onCheckedChange={(checked) => onChange({ misses: checked ? "1" : null })}
          />
          <Label htmlFor="show-misses" className="text-sm font-normal text-muted-foreground">
            Not found / errors ({hiddenMisses})
          </Label>
        </div>
      </div>
    </div>
  );
}
