"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useStartInvestigation } from "@/lib/query/mutations";
import { useCaseHref } from "@/lib/use-case-href";
import { cleanHints, parseTags } from "@/lib/validation";
import type { SmartSearchSubmit } from "./smart-search";

/** Turns a smart-search submission into a new case and lands on its page, scan running. */
export function useStartSearch(onStarted?: () => void) {
  const router = useRouter();
  const caseHref = useCaseHref();
  const start = useStartInvestigation();

  const submit = ({ type, value, hints, options, modules }: SmartSearchSubmit) => {
    start.mutate(
      {
        body: {
          title: options.title.trim() || undefined,
          tags: parseTags(options.tags),
          identifiers: [{ type, value }],
          ...(type === "name" ? { hints: cleanHints(hints) } : {}),
        },
        modules,
      },
      {
        onSuccess: ({ case: created, jobs }) => {
          toast.success("Search started", {
            description: `Checking ${jobs.length} data source${jobs.length === 1 ? "" : "s"} for ${value}.`,
          });
          onStarted?.();
          router.push(`${caseHref(created.id)}#scan`);
        },
      },
    );
  };

  return { submit, pending: start.isPending };
}
