"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SignInDialog } from "@/components/shell/sign-in-dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/lib/query/hooks";
import { useCreateCase } from "@/lib/query/mutations";
import { hasAcknowledged, recordAcknowledgement } from "@/lib/storage";
import type { TargetType } from "@/lib/types";
import { useCaseHref } from "@/lib/use-case-href";
import { TARGET_TYPE_META, parseTags, validateTarget } from "@/lib/validation";
import { TargetTypePicker } from "./target-type-picker";

export function NewInvestigationDialog({
  open,
  onOpenChange,
  initialType = "username",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialType?: TargetType;
}) {
  const router = useRouter();
  const caseHref = useCaseHref();
  const session = useSession();
  const create = useCreateCase();
  const [type, setType] = useState<TargetType>(initialType);
  const [value, setValue] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [needsAck] = useState(() => !hasAcknowledged());
  const [ack, setAck] = useState(false);
  const [valueError, setValueError] = useState<string | null>(null);
  const [ackError, setAckError] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const meta = TARGET_TYPE_META[type];
  const blockedBySignIn = meta.requiresSignIn && (session.data?.anonymous ?? true);

  const changeType = (next: TargetType) => {
    setType(next);
    setValueError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateTarget(type, value);
    setValueError(result.ok ? null : result.error);
    const ackMissing = needsAck && !ack;
    setAckError(ackMissing);
    if (!result.ok || ackMissing || blockedBySignIn) return;
    if (needsAck) recordAcknowledgement();
    create.mutate(
      {
        title: title.trim() || undefined,
        tags: parseTags(tags),
        identifiers: [{ type, value: result.value }],
        scan: true,
      },
      {
        onSuccess: ({ case: created, jobs }) => {
          toast.success("Investigation started", {
            description: `${jobs.length} module${jobs.length === 1 ? "" : "s"} queued for ${result.value}.`,
          });
          onOpenChange(false);
          router.push(caseHref(created.id));
        },
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New investigation</DialogTitle>
            <DialogDescription>
              Pick one starting point. You can add more targets and pivot from the workspace.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} noValidate className="space-y-4">
            <TargetTypePicker value={type} onChange={changeType} />

            <div className="space-y-1.5">
              <Label htmlFor="target-value">{meta.label}</Label>
              <Input
                id="target-value"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
                placeholder={meta.placeholder}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (valueError) setValueError(null);
                }}
                aria-invalid={valueError ? true : undefined}
                aria-describedby={valueError ? "target-error" : "target-hint"}
              />
              {valueError ? (
                <p id="target-error" role="alert" className="text-sm text-danger">
                  {valueError}
                </p>
              ) : (
                <p id="target-hint" className="text-xs text-muted-foreground">
                  {meta.hint}
                </p>
              )}
            </div>

            {blockedBySignIn ? (
              <div className="flex flex-col gap-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm sm:flex-row sm:items-center">
                <p className="flex-1">
                  Name search requires a signed-in account. It is rate-limited to prevent misuse.
                </p>
                <Button type="button" size="sm" variant="outline" onClick={() => setSignInOpen(true)}>
                  Sign in
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="case-title">
                  Title <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="case-title"
                  maxLength={120}
                  placeholder="Self-exposure audit"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="case-tags">
                  Tags <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="case-tags"
                  placeholder="client-a, self-audit"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                />
              </div>
            </div>

            {needsAck ? (
              <div className="space-y-1.5">
                <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface p-3">
                  <Checkbox
                    id="authorised"
                    className="mt-0.5"
                    checked={ack}
                    onCheckedChange={(checked) => {
                      setAck(checked === true);
                      setAckError(false);
                    }}
                    aria-describedby={ackError ? "ack-error" : undefined}
                  />
                  <Label htmlFor="authorised" className="text-sm font-normal leading-snug">
                    I am authorised to investigate this target, or it is my own data. I will only
                    use public information and follow the responsible-use policy.
                  </Label>
                </div>
                {ackError ? (
                  <p id="ack-error" role="alert" className="text-sm text-danger">
                    Confirm that you are authorised before starting.
                  </p>
                ) : null}
              </div>
            ) : null}

            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending || blockedBySignIn}>
                {create.isPending ? "Starting…" : "Start investigation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </>
  );
}
