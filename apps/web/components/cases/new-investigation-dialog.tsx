"use client";

import { SmartSearch } from "@/components/search/smart-search";
import { useStartSearch } from "@/components/search/use-start-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TargetType } from "@/lib/types";

/** The smart search box in a dialog, reachable from the top bar, the palette and the N key. */
export function NewInvestigationDialog({
  open,
  onOpenChange,
  initialType = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: TargetType | null;
}) {
  const start = useStartSearch(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] max-w-xl translate-y-0">
        <DialogHeader>
          <DialogTitle>What do you want to look into?</DialogTitle>
          <DialogDescription>
            Type anything. We work out what it is, check public sources, and you confirm what is
            real.
          </DialogDescription>
        </DialogHeader>
        <SmartSearch
          size="compact"
          autoFocus
          initialType={initialType}
          pending={start.pending}
          onSubmit={start.submit}
        />
      </DialogContent>
    </Dialog>
  );
}
