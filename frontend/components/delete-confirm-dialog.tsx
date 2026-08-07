"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Trash2 } from "lucide-react";

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display label for what's being deleted (e.g. case subject or identifier). */
  itemName: string;
  /** Secondary detail shown under the title (e.g. case id, full identifier). */
  itemDetail?: string;
  /** Description of what will be wiped — written to the user. */
  consequences: string[];
  /** Whether the action is currently running. */
  busy?: boolean;
  /** Called when user confirms delete. */
  onConfirm: () => void;
  /** Override the default title/copy. */
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

/** Modal confirmation dialog for destructive actions.
 * Replaces the browser's `window.confirm()` with a proper shadcn-styled dialog
 * so it matches the rest of the app's UI. */
export function DeleteConfirmDialog({
  open,
  onOpenChange,
  itemName,
  itemDetail,
  consequences,
  busy = false,
  onConfirm,
  title = "Delete this case?",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
}: DeleteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-destructive/30 sm:max-w-[440px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive border border-destructive/30">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base">{title}</DialogTitle>
              <DialogDescription className="mt-1.5">
                <span className="block">
                  You&rsquo;re about to permanently delete{" "}
                  <span className="font-semibold text-foreground break-all">{itemName}</span>.
                </span>
                {itemDetail && (
                  <span className="mt-1 block font-mono text-[11px] text-muted-foreground break-all">
                    {itemDetail}
                  </span>
                )}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="rounded-md border border-border/50 bg-muted/40 p-3 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            This will permanently remove
          </div>
          <ul className="space-y-1.5 text-foreground/80">
            {consequences.map((c, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-destructive" />
                <span className="leading-relaxed">{c}</span>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            {busy ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
