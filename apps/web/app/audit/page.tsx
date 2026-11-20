import type { Metadata } from "next";
import { Suspense } from "react";
import { AuditView } from "@/components/audit/audit-view";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Activity log" };

export default function AuditPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
      <AuditView />
    </Suspense>
  );
}
