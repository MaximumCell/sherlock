"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useStartInvestigation } from "@/lib/query/mutations";
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
