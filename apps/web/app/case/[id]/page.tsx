import type { Metadata } from "next";
import { Suspense } from "react";
import { CasePage, CaseSkeleton } from "@/components/case/case-page";

export const metadata: Metadata = { title: "Investigation" };

// Thin server shell: it only unwraps the route param. All data is read in the browser.
export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<CaseSkeleton />}>
      <CasePage caseId={id} />
    </Suspense>
  );
}
