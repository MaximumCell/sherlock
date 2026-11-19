import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoWorkspace } from "@/components/workspace/demo-workspace";
import { WorkspaceSkeleton } from "@/components/workspace/workspace";

export const metadata: Metadata = {
  title: "Live demo",
  description: "A complete, fictional investigation served from bundled fixture data.",
};

// Public demo: always backed by the in-memory fixture data source, never the real backend.
export default function DemoPage() {
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <DemoWorkspace />
    </Suspense>
  );
}
