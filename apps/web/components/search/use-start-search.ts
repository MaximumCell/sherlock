"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { savePendingSearch } from "@/lib/pending-search";
import { useStartInvestigation } from "@/lib/query/mutations";
import { classifyRefusal } from "@/lib/search-refusal";
import { useCaseHref } from "@/lib/use-case-href";
import { cleanHints, parseTags } from "@/lib/validation";
import type { SmartSearchSubmit } from "./smart-search";

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

/**
 * Turns a smart-search submission into a new case and lands on its page, scan running.
 * `launchMs` holds the navigation for a short launch animation (skipped for reduced motion).
 */
export function useStartSearch(onStarted?: () => void, launchMs = 0) {
  const router = useRouter();
  const caseHref = useCaseHref();
  const start = useStartInvestigation();
  const [launching, setLaunching] = useState(false);

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
        onError: (err) => {
          // The gateway asked for sign-in (e.g. the app did not know it was required): keep the
          // search so it resumes after signing in. The sign-in dialog itself is opened by the mutation.
          if (classifyRefusal(err)?.kind === "sign_in") {
            savePendingSearch({
              type,
              value,
              hints,
              title: options.title,
              tags: options.tags,
              excluded: options.excluded,
              ...(modules ? { modules } : {}),
            });
          }
        },
        onSuccess: ({ case: created, jobs }) => {
          toast.success("Search started", {
            description: `Checking ${jobs.length} data source${jobs.length === 1 ? "" : "s"} for ${value}.`,
          });
          onStarted?.();
          const go = () => router.push(caseHref(created.id));
          if (launchMs > 0 && !prefersReducedMotion()) {
            setLaunching(true);
            window.setTimeout(go, launchMs);
          } else go();
        },
      },
    );
  };

  return { submit, pending: start.isPending || launching };
}
