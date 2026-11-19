"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { getDataSource, modeForPath, type DataSource } from "@/lib/data";
import type { DataMode } from "@/lib/env";

interface DataContextValue {
  ds: DataSource;
  mode: DataMode;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used inside <DataProvider>");
  return value;
}

/** Test and storybook entry point: inject any DataSource. */
export function DataSourceProvider({ ds, children }: { ds: DataSource; children: ReactNode }) {
  const value = useMemo(() => ({ ds, mode: ds.mode }), [ds]);
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const mode = modeForPath(pathname);
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  const value = useMemo(() => ({ ds: getDataSource(mode), mode }), [mode]);
  return (
    <QueryClientProvider client={queryClient}>
      <DataContext.Provider value={value}>{children}</DataContext.Provider>
    </QueryClientProvider>
  );
}
