"use client";

import { Hourglass, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { onActiveSearchRequest } from "@/lib/active-search-prompt";
import type { ActiveSearch } from "@/lib/data/gateway";
import { useCancelSearch } from "@/lib/query/mutations";
import { useCaseHref } from "@/lib/use-case-href";

/**
 * Shown when a new search is refused because the session's previous search is still running
 * (one unfinished search per session). Offers to open it or stop it.
 */
export function ActiveSearchDialog() {
  const router = useRouter();
  const caseHref = useCaseHref();
  const stop = useCancelSearch();
  const [search, setSearch] = useState<ActiveSearch | null>(null);
  useEffect(() => onActiveSearchRequest(setSearch), []);

  const close = () => setSearch(null);
  const open = () => {
    if (!search) return;
    router.push(caseHref(search.caseId));
    close();
  };
  const stopIt = () => {
    if (!search) return;
    stop.mutate(search, {
      onSuccess: () => {
        toast.success("Search stopped", { description: "You can start a new search now." });
        close();
      },
    });
  };

  return (
    <Dialog open={search !== null} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 text-accent">
            <Hourglass className="h-5 w-5" aria-hidden />
          </span>
          <DialogTitle>Your previous search is still running</DialogTitle>
          <DialogDescription>
            You can start another when it finishes, or stop it. One search at a time keeps Sherlock
            quick for everyone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          {search && search.batchIds.length > 0 ? (
            <Button variant="outline" disabled={stop.isPending} onClick={stopIt}>
              <Square className="!size-3 fill-current" aria-hidden />
              {stop.isPending ? "Stopping…" : "Stop it"}
            </Button>
          ) : null}
          <Button onClick={open}>Open my running search</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
