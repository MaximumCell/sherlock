import { Skeleton } from "@/components/ui/skeleton";

/** Loading state for the case detail page.
 * Mirrors the case hero + manual scan + filter bar + findings layout so the
 * page doesn't blink from a blank screen to a fully-populated dashboard. */
export default function Loading() {
  return (
    <div className="space-y-6">
      {/* SUBJECT HERO skeleton */}
      <section
        className="rounded-xl border border-border/50 p-6 sm:p-7"
        style={{
          background: "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--tertiary)) 100%)",
        }}
      >
        <div className="grid grid-cols-[auto_1fr_auto] gap-5 items-center">
          {/* Avatar */}
          <Skeleton className="h-[72px] w-[72px] rounded-2xl" />

          {/* Subject identity */}
          <div className="space-y-3 min-w-0">
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-7 sm:h-8 w-2/3 max-w-[480px]" />
            <Skeleton className="h-3 w-44" />
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24 rounded-md" />
            <Skeleton className="h-9 w-24 rounded-md" />
          </div>
        </div>

        {/* Inline stats row */}
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-2 pt-5 border-t border-border/40">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Skeleton className="h-3 w-3" />
                <Skeleton className="h-2.5 w-16" />
              </div>
              <Skeleton className="h-7 w-14" />
              <Skeleton className="h-2.5 w-20" />
            </div>
          ))}
        </div>
      </section>

      {/* Investigation workbench heading */}
      <div className="space-y-1">
        <Skeleton className="h-2.5 w-40" />
      </div>

      {/* Manual scan panel skeleton */}
      <div className="rounded-lg border border-border/50 bg-card/60 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-6 rounded-md" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56 ml-2" />
        </div>
        <div className="grid grid-cols-[120px_1fr_auto] gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-10 w-28" />
        </div>
      </div>

      {/* Filter bar skeleton */}
      <div className="rounded-lg border border-border/50 bg-card/60 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-24 rounded-full" />
          ))}
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <div className="ml-auto">
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-2 border-b border-border/40 pb-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-32 rounded-t-md" />
        ))}
      </div>

      {/* Findings grid skeleton — the bulk of the case page */}
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border/50 bg-card/60 overflow-hidden">
            {/* Card head */}
            <div className="px-4 py-3 bg-black/15 border-b border-border/40 flex items-center gap-2.5">
              <Skeleton className="h-7 w-7 rounded-md" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-2.5 w-12" />
              </div>
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
            {/* Card body */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <div className="flex gap-1.5">
                    <Skeleton className="h-4 w-14 rounded" />
                    <Skeleton className="h-4 w-10 rounded" />
                  </div>
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
            </div>
            {/* Card foot */}
            <div className="px-4 py-2 bg-black/10 border-t border-border/40">
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
