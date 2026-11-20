"use client";

import { Archive, ArchiveRestore, Ellipsis, Plus, RotateCw, Trash2 } from "lucide-react";
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

export function CaseMenu({
  c,
  afterDeleteHref,
  onAddTarget,
  onRescan,
}: {
  c: Case;
  afterDeleteHref: string;
  onAddTarget: () => void;
  onRescan: () => void;
}) {
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
          toast.success(value ? "Investigation archived" : "Investigation restored");
        },
      },
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="More actions">
            <Ellipsis aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={onAddTarget}>
            <Plus aria-hidden />
            Add another target
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onRescan}>
            <RotateCw aria-hidden />
            Search again
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {archived ? (
            <DropdownMenuItem onSelect={() => setArchived(false)}>
              <ArchiveRestore aria-hidden />
              Restore from archive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setConfirm("archive")}>
              <Archive aria-hidden />
              Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-danger focus:text-danger"
            onSelect={() => setConfirm("delete")}
          >
            <Trash2 aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={confirm === "archive"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Archive this investigation?"
        description="It is hidden from Recent investigations until you turn on Show archived. Nothing is deleted."
        confirmLabel="Archive"
        pending={update.isPending}
        onConfirm={() => setArchived(true)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title="Delete this investigation?"
        description={
          <>
            <span className="font-medium text-foreground">{caseDisplayTitle(c)}</span> and all of
            its results, links and scan history are removed permanently. This cannot be undone.
          </>
        }
        confirmLabel="Delete for good"
        destructive
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(c.id, {
            onSuccess: () => {
              toast.success("Investigation deleted");
              router.push(afterDeleteHref);
            },
          })
        }
      />
    </>
  );
}
