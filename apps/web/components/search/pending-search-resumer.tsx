"use client";

import { useRouter } from "next/navigation";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";
import { useData } from "@/components/providers/data-provider";
import { describeError } from "@/lib/data/gateway";
import { takePendingSearch, type PendingSearch } from "@/lib/pending-search";
import { useSession } from "@/lib/query/hooks";
import { hasAcknowledged, recordAcknowledgement } from "@/lib/storage";
import { useCaseHref } from "@/lib/use-case-href";
import { AckDialog } from "./ack-dialog";
import { useStartSearch } from "./use-start-search";

/**
 * Resumes the search a visitor started before signing in, once the session can run it
 * (after the OAuth or magic-link round trip, or at once in fixture mode). The one-time
 * authorisation acknowledgement is still asked first when it was never given.
 */
export function PendingSearchResumer() {
  const { ds } = useData();
  const session = useSession();
  const router = useRouter();
  const caseHref = useCaseHref();
  const { submit } = useStartSearch();
  /** Waiting for the acknowledgement before it runs. */
  const [pending, setPending] = useState<PendingSearch | null>(null);

  const run = (p: PendingSearch) => {
    setPending(null);
    if (p.caseId) {
      const caseId = p.caseId;
      ds.scan(caseId, {
        type: p.type,
        value: p.value,
        ...(p.modules ? { modules: p.modules } : {}),
      })
        .then(() => {
          toast.success(`Searching ${p.value}`);
          router.push(caseHref(caseId));
        })
        .catch((err: unknown) =>
          toast.error("Could not start the search", { description: describeError(err) }),
        );
      return;
    }
    submit({
      type: p.type,
      value: p.value,
      hints: p.hints,
      options: { title: p.title, tags: p.tags, excluded: p.excluded },
      modules: p.modules,
    });
  };

  const resume = useEffectEvent(() => {
    const taken = takePendingSearch(session.data, ds.searchNeedsAccount);
    if (!taken) return;
    if (hasAcknowledged()) run(taken);
    else setPending(taken);
  });
  useEffect(() => {
    // after the render settles; also keeps React's strict-mode double effect from taking it twice
    const timer = setTimeout(resume, 0);
    return () => clearTimeout(timer);
  }, [session.data, ds.searchNeedsAccount]);

  return (
    <AckDialog
      open={pending !== null && !hasAcknowledged()}
      onOpenChange={(open) => (open ? null : setPending(null))}
      onConfirm={() => {
        recordAcknowledgement();
        if (pending) run(pending);
      }}
    />
  );
}
