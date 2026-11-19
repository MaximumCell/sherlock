"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";

/** Inside the /demo sandbox, case links stay under /demo so the fixture data source is kept. */
export function caseHrefFor(pathname: string | null, id: string, tab?: string): string {
  const inDemo = pathname === "/demo" || pathname?.startsWith("/demo/");
  const params = new URLSearchParams();
  if (inDemo) params.set("case", id);
  if (tab) params.set("tab", tab);
  const query = params.toString();
  const base = inDemo ? "/demo" : `/case/${id}`;
  return query ? `${base}?${query}` : base;
}

export function useCaseHref() {
  const pathname = usePathname();
  return useCallback((id: string, tab?: string) => caseHrefFor(pathname, id, tab), [pathname]);
}
