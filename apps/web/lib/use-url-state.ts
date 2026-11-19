"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";

export type ParamPatch = Record<string, string | null | undefined>;

/** Merge a patch into a query string. Null, undefined and "" remove the key. */
export function patchSearch(current: string, patch: ParamPatch): string {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, value);
  }
  return params.toString();
}

/** View state that lives in the URL (tabs, filters, sort), without scroll jumps. */
export function useUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Router updates are asynchronous: two quick changes must build on each other,
  // not on the query string of the last committed render.
  const latest = useRef(params.toString());
  useEffect(() => {
    latest.current = params.toString();
  }, [params]);

  const set = useCallback(
    (patch: ParamPatch, mode: "replace" | "push" = "replace") => {
      const query = patchSearch(latest.current, patch);
      latest.current = query;
      const href = query ? `${pathname}?${query}` : pathname;
      if (mode === "push") router.push(href, { scroll: false });
      else router.replace(href, { scroll: false });
    },
    [router, pathname],
  );

  return { params, set, pathname };
}
