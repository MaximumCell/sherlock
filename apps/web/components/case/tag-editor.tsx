"use client";

import { Tag } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUpdateCase } from "@/lib/query/mutations";
import type { Case } from "@/lib/types";
import { parseTags } from "@/lib/validation";

function TagForm({ c, onDone }: { c: Case; onDone: () => void }) {
  const update = useUpdateCase(c.id);
  const [value, setValue] = useState(c.tags.join(", "));
  const save = (event: FormEvent) => {
    event.preventDefault();
    update.mutate({ tags: parseTags(value) }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={save} className="space-y-2">
      <Label htmlFor="edit-tags">Tags</Label>
      <Input
        id="edit-tags"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="client-a, self-audit"
      />
      <p className="text-xs text-muted-foreground">Comma-separated. Up to 12 tags.</p>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save tags"}
        </Button>
      </div>
    </form>
  );
}

export function TagEditor({ c }: { c: Case }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs"
          data-print="hide"
          aria-label="Edit tags"
        >
          <Tag className="!size-3" aria-hidden />
          {c.tags.length === 0 ? "Add tags" : "Edit"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        {open ? <TagForm c={c} onDone={() => setOpen(false)} /> : null}
      </PopoverContent>
    </Popover>
  );
}
