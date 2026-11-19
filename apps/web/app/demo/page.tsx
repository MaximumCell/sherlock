import type { Metadata } from "next";
import { Suspense } from "react";
import { CaseSkeleton } from "@/components/case/case-page";
import { DemoCase } from "@/components/case/demo-case";

export const metadata: Metadata = {
  title: "Demo investigation",
  description: "A complete, fictional investigation served from bundled demo data, with a guided tour.",
};

// Public demo: always backed by the in-memory fixture data source, never the real backend.
export default function DemoPage() {
  return (
    <Suspense fallback={<CaseSkeleton />}>
      <DemoCase />
    </Suspense>
  );
}
