"use client";

import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { useMemo, useState } from "react";
import { ErrorState } from "@/components/common/states";
import { CasePage, CaseSkeleton } from "@/components/case/case-page";
import { DataSourceProvider, useData } from "@/components/providers/data-provider";
import { ReadOnlyProvider } from "@/components/providers/read-only";
import { createReadOnlyDataSource } from "@/lib/data/read-only-source";

export const OPERATOR_BANNER = "Viewing as operator · read-only · this view is logged";

/**
 * `/admin/cases/[id]`: one visitor's case for abuse review. The case is fetched once through
 * the operator API (which logs the opening on the case itself) and shown with the ordinary
 * investigation page in read-only mode, on its own query cache and a data source that refuses
 * every write.
 */
export function AdminCaseView({ caseId }: { caseId: string }) {
  const { ds, mode } = useData();
  const view = useQuery({
    queryKey: [mode, "admin", "case-view", caseId],
    queryFn: () => ds.admin.viewCase(caseId),
    // every fetch is logged on the visitor's case: fetch once per opening
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const readOnly = useMemo(
    () => (view.data ? createReadOnlyDataSource(ds, view.data) : null),
    [ds, view.data],
  );
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );

  if (view.isPending) return <CaseSkeleton />;
  if (view.isError || !readOnly) {
    return (
      <ErrorState
        title="Could not open this case"
        error={view.error}
        onRetry={() => void view.refetch()}
      />
    );
  }
  return (
    <>
      <div
        role="status"
        data-print="hide"
        className="mb-6 flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/[0.08] px-4 py-2.5 text-sm font-medium"
      >
        <Eye className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        {OPERATOR_BANNER}
      </div>
      <QueryClientProvider client={client}>
        <DataSourceProvider ds={readOnly}>
          <ReadOnlyProvider>
            <CasePage caseId={caseId} />
          </ReadOnlyProvider>
        </DataSourceProvider>
      </QueryClientProvider>
    </>
  );
}
