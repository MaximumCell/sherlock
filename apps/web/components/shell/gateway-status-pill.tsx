"use client";

import { LoaderCircle } from "lucide-react";
import { useSyncExternalStore } from "react";
import { gatewayStatus } from "@/lib/data/gateway-status";

/**
 * Non-blocking notice for slow commands. The scan service sleeps when idle and
 * can take up to a minute to wake; the command keeps retrying in the background.
 */
export function GatewayStatusPill() {
  const activity = useSyncExternalStore(
    gatewayStatus.subscribe,
    gatewayStatus.getSnapshot,
    gatewayStatus.getServerSnapshot,
  );
  if (!activity.waking) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-fade-in items-center gap-2.5 rounded-lg border border-border bg-popover px-4 py-2 text-sm shadow-lift"
    >
      <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden />
      <span>
        Waking the scan service…{" "}
        <span className="text-muted-foreground">
          {activity.attempt > 1
            ? `still trying (attempt ${activity.attempt + 1})`
            : "this can take up to a minute"}
        </span>
      </span>
    </div>
  );
}
