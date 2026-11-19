"use client";

import { SmartSearch } from "@/components/search/smart-search";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useScan } from "@/lib/query/mutations";
import { cleanHints } from "@/lib/validation";

/** Search one more identifier inside this investigation (same smart box). */
export function AddTargetDialog({
  caseId,
  open,
  onOpenChange,
}: {
  caseId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const scan = useScan(caseId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[12%] max-w-xl translate-y-0">
        <DialogHeader>
          <DialogTitle>Add another target</DialogTitle>
          <DialogDescription>
            Search one more username, email, website or other identifier as part of this
            investigation. Its results join the ones you already have.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <SmartSearch
            size="compact"
            autoFocus
            showCaseFields={false}
            submitLabel="Add"
            pending={scan.isPending}
            onSubmit={({ type, value, hints, modules }) =>
              scan.mutate(
                {
                  type,
                  value,
                  ...(modules ? { modules } : {}),
                  ...(type === "name" ? { hints: cleanHints(hints) } : {}),
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
