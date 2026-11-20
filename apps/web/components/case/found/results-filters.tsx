"use client";

import { Pin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { FINDING_GROUP_IDS, FINDING_GROUP_META, type FindingGroupId } from "@/lib/finding-groups";
import type { Facet } from "@/lib/findings";
import type { ParamPatch } from "@/lib/use-url-state";

const ALL = "__all__";

export type ResultStatusFilter = "found" | "all" | "not_found" | "error";

export interface ResultFilterState {
  query: string;
  group: FindingGroupId | null;
  module: string | null;
  platform: string | null;
  category: string | null;
  pinnedOnly: boolean;
  show: ResultStatusFilter;
}

const SHOW_LABEL: Record<ResultStatusFilter, string> = {
  found: "Found only",
  all: "Everything checked",
  not_found: "Not found",
  error: "Errors",
};

function FacetSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string | null;
  options: { value: string; label: string; count?: number }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
      <SelectTrigger className="sm:w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {o.count !== undefined ? ` (${o.count})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Every filter of the full results list: text, group, source, category, platform, status, pinned. */
export function ResultsFilters({
  filters,
  facets,
  counts,
  sourceLabel,
  onChange,
}: {
  filters: ResultFilterState;
  facets: { modules: Facet[]; platforms: Facet[]; categories: Facet[] };
  counts: Record<ResultStatusFilter, number>;
  sourceLabel: (name: string) => string;
  onChange: (patch: ParamPatch) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search results"
          placeholder="Search by site, handle, bio, anything"
          className="pl-9"
          defaultValue={filters.query}
          onChange={(e) => onChange({ q: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <FacetSelect
          label="Filter by group"
          allLabel="All groups"
          value={filters.group}
          options={FINDING_GROUP_IDS.map((id) => ({
            value: id,
            label: FINDING_GROUP_META[id].title,
          }))}
          onChange={(v) => onChange({ group: v })}
        />
        <FacetSelect
          label="Filter by data source"
          allLabel="All data sources"
          value={filters.module}
          options={facets.modules.map((f) => ({
            value: f.value,
            label: sourceLabel(f.value),
            count: f.count,
          }))}
          onChange={(v) => onChange({ module: v })}
        />
        <FacetSelect
          label="Filter by category"
          allLabel="All categories"
          value={filters.category}
          options={facets.categories.map((f) => ({
            value: f.value,
            label: f.value,
            count: f.count,
          }))}
          onChange={(v) => onChange({ category: v })}
        />
        <FacetSelect
          label="Filter by site"
          allLabel="All sites"
          value={filters.platform}
          options={facets.platforms.map((f) => ({
            value: f.value,
            label: f.value,
            count: f.count,
          }))}
          onChange={(v) => onChange({ platform: v })}
        />
        <Select
          value={filters.show}
          onValueChange={(v) => onChange({ show: v === "found" ? null : v, misses: null })}
        >
          <SelectTrigger className="sm:w-48" aria-label="Which results to show">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SHOW_LABEL) as ResultStatusFilter[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SHOW_LABEL[key]} ({counts[key]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Toggle
          variant="outline"
          size="sm"
          className="h-9 justify-start"
          pressed={filters.pinnedOnly}
          onPressedChange={(pressed) => onChange({ curated: pressed ? "1" : null })}
          aria-label="Show pinned results only"
        >
          <Pin aria-hidden />
          Pinned only
        </Toggle>
      </div>
    </div>
  );
}
