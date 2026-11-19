"use client";

import { Archive, ArchiveRestore, Ellipsis, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { caseDisplayTitle } from "@/lib/case-status";
import { useDeleteCase, useUpdateCase } from "@/lib/query/mutations";
import type { Case } from "@/lib/types";

export function CaseMenu({ c, afterDeleteHref }: { c: Case; afterDeleteHref: string }) {
  const router = useRouter();
  const update = useUpdateCase(c.id);
  const remove = useDeleteCase();
  const [confirm, setConfirm] = useState<"archive" | "delete" | null>(null);
  const archived = Boolean(c.archived_at);

  const setArchived = (value: boolean) =>
    update.mutate(
      { archived: value },
      {
        onSuccess: () => {
          setConfirm(null);
          toast.success(value ? "Case archived" : "Case restored");
        },
      },
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="Case actions">
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {archived ? (
            <DropdownMenuItem onSelect={() => setArchived(false)}>
              <ArchiveRestore aria-hidden />
              Restore from archive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirm("archive")}>
              <Archive aria-hidden />
              Archive case
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-danger focus:text-danger" onSelect={() => setConfirm("delete")}>
            <Trash2 aria-hidden />
            Delete case
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Archive this case?"
        description="It is hidden from the cases list until you turn on “Show archived”. Nothing is deleted."
        confirmLabel="Archive"
        pending={update.isPending}
        onConfirm={() => setArchived(true)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this case?"
        description={
          <>
            <span className="font-medium text-foreground">{caseDisplayTitle(c)}</span> and all of its
            findings, correlations and jobs are removed permanently. This cannot be undone.
          </>
        }
        confirmLabel="Delete case"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(c.id, {
            onSuccess: () => {
              toast.success("Case deleted");
              router.push(afterDeleteHref);
            },
          })
        }
      />
    </>
  );
}
