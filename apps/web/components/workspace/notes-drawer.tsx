"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateCase } from "@/lib/query/mutations";
import type { Case } from "@/lib/types";

function NotesForm({ c, onClose }: { c: Case; onClose: () => void }) {
  const update = useUpdateCase(c.id);
  const [notes, setNotes] = useState(c.notes);
  const dirty = notes !== c.notes;
  return (
    <>
      <Textarea
        aria-label="Case notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Hypotheses, open questions, what to check next…"
        className="min-h-64 flex-1 resize-none font-mono text-sm leading-relaxed"
      />
      <SheetFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={!dirty || update.isPending}
          onClick={() =>
            update.mutate({ notes }, { onSuccess: () => toast.success("Notes saved") })
          }
        >
          {update.isPending ? "Saving…" : dirty ? "Save notes" : "Saved"}
        </Button>
      </SheetFooter>
    </>
  );
}

export function NotesDrawer({
  c,
  open,
  onOpenChange,
}: {
  c: Case;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Notes</SheetTitle>
          <SheetDescription>Private working notes for this case. Plain text.</SheetDescription>
        </SheetHeader>
        {open ? <NotesForm c={c} onClose={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}
