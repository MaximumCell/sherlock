import type { Metadata } from "next";
import { Suspense } from "react";
import { Workspace, WorkspaceSkeleton } from "@/components/workspace/workspace";

export const metadata: Metadata = { title: "Case" };

// Thin server shell: it only unwraps the route param. All data is read in the browser.
export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Workspace caseId={id} />
    </Suspense>
  );
}
