"use client";

import { PauseCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSetPaused } from "@/lib/admin/hooks";
import { describeError } from "@/lib/data/gateway";
import { cn } from "@/lib/utils";

/** The prominent "Pause all searches" switch. Both directions ask for confirmation. */
export function PauseControl({ paused, disabled }: { paused: boolean; disabled?: boolean }) {
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const mutation = useSetPaused();

  const apply = (next: boolean) => {
    mutation.mutate(next, {
      onSuccess: (state) => {
        setConfirm(null);
        toast.success(state ? "Searches paused" : "Searches resumed", {
          description: state
            ? "New searches are refused until you resume them."
            : "Visitors can search again.",
        });
      },
      onError: (err) =>
        toast.error("Could not change the pause switch", { description: describeError(err) }),
    });
  };

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-3 py-2",
          paused ? "border-warning/40 bg-warning/10" : "border-border bg-card",
        )}
      >
        <Switch
          id="pause-searches"
          checked={paused}
          disabled={disabled || mutation.isPending}
          onCheckedChange={(next) => setConfirm(next)}
        />
        <Label htmlFor="pause-searches" className="cursor-pointer text-sm font-medium">
          Pause all searches
        </Label>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={confirm ? "Pause all searches?" : "Resume searches?"}
        description={
          confirm
            ? "Every new search is refused with “Searches are paused by the operator” until you resume. Existing cases stay readable and running scans finish."
            : "Visitors can start searches again, within the usual limits."
        }
        confirmLabel={confirm ? "Pause searches" : "Resume searches"}
        destructive={confirm === true}
        pending={mutation.isPending}
        onConfirm={() => confirm !== null && apply(confirm)}
      />
    </>
  );
}

/** Shown on every part of the panel while searches are paused. */
export function PausedBanner({ onResume }: { onResume?: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm sm:flex-row sm:items-center"
    >
      <PauseCircle className="h-5 w-5 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">Searches are paused.</strong> Visitors see “Searches are
        paused by the operator. Try again later.” Reading existing cases still works.
      </p>
      {onResume ? (
        <Button size="sm" variant="outline" onClick={onResume}>
          Resume
        </Button>
      ) : null}
    </div>
  );
}
