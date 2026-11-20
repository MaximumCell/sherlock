"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/** The one-time authorised-use acknowledgement, asked before the very first search. */
export function AckDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <DialogTitle>Before your first search</DialogTitle>
          <DialogDescription>
            Sherlock only reads public sources. Use it on your own data, or on a target you are
            authorised to investigate. We ask once per browser.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
            <Checkbox
              id="authorised"
              className="mt-0.5"
              checked={checked}
              onCheckedChange={(value) => {
                setChecked(value === true);
                setError(false);
              }}
              aria-describedby={error ? "ack-error" : undefined}
            />
            <Label htmlFor="authorised" className="text-sm font-normal leading-snug">
              I am authorised to investigate this target, or it is my own data. I will only use
              public information and follow the{" "}
              <Link
                href="/about#responsible-use"
                className="text-accent underline underline-offset-2"
              >
                responsible-use policy
              </Link>
              .
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Searches are logged with an anonymised origin and reviewed by the operator to prevent
            misuse. The log is kept for 90 days.
          </p>
          {error ? (
            <p id="ack-error" role="alert" className="text-sm text-danger">
              Tick the box to confirm, then start the search.
            </p>
          ) : null}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!checked) return setError(true);
              onConfirm();
            }}
          >
            Agree and search
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
