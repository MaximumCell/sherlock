import type { Metadata } from "next";
import { Suspense } from "react";
import { CasesSkeleton, CasesView } from "@/components/cases/cases-view";

export const metadata: Metadata = { title: { absolute: "Cases · Sherlock" } };

// Thin server shell: the data view renders on the client and never waits on the gateway.
export default function CasesPage() {
  return (
    <Suspense fallback={<CasesSkeleton />}>
      <CasesView />
    </Suspense>
  );
}
