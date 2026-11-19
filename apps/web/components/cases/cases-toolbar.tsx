"use client";

import { Search } from "lucide-react";
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
import type { CaseListQuery, CaseSort } from "@/lib/case-list";
import type { ParamPatch } from "@/lib/use-url-state";

const SORT_LABELS: Record<CaseSort, string> = {
  updated: "Recently updated",
  created: "Newest first",
  title: "Title A to Z",
  findings: "Most findings",
};

const ALL = "__all__";

export function CasesToolbar({
  query,
  tags,
  onChange,
}: {
  query: CaseListQuery;
  tags: string[];
  onChange: (patch: ParamPatch) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1 sm:min-w-56">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search cases"
          placeholder="Search by title, target or tag"
          className="pl-8"
          defaultValue={query.q}
          onChange={(e) => onChange({ q: e.target.value })}
        />
      </div>
      <Select
        value={query.tag ?? ALL}
        onValueChange={(value) => onChange({ tag: value === ALL ? null : value })}
      >
        <SelectTrigger className="sm:w-40" aria-label="Filter by tag">
          <SelectValue placeholder="All tags" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All tags</SelectItem>
          {tags.map((tag) => (
            <SelectItem key={tag} value={tag}>
              {tag}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={query.sort}
        onValueChange={(value) => onChange({ sort: value === "updated" ? null : value })}
      >
        <SelectTrigger className="sm:w-48" aria-label="Sort cases">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(SORT_LABELS) as CaseSort[]).map((sort) => (
            <SelectItem key={sort} value={sort}>
              {SORT_LABELS[sort]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2 px-1">
        <Switch
          id="show-archived"
          checked={query.showArchived}
          onCheckedChange={(checked) => onChange({ archived: checked ? "1" : null })}
        />
        <Label htmlFor="show-archived" className="text-sm font-normal text-muted-foreground">
          Show archived
        </Label>
      </div>
    </div>
  );
}
