import type { Metadata } from "next";
import { Suspense } from "react";
import { StartView } from "@/components/start/start-view";
import { RecentSkeleton } from "@/components/start/recent-investigations";

export const metadata: Metadata = { title: { absolute: "Sherlock · What do you want to look into?" } };

// Thin server shell: the data view renders on the client and never waits on the gateway.
export default function StartPage() {
  return (
    <Suspense fallback={<RecentSkeleton />}>
      <StartView />
    </Suspense>
  );
}
