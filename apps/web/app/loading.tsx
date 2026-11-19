import { Skeleton } from "@/components/ui/skeleton";

/** Loading state for the home page. Mirrors the hero + stats + case-grid layout. */
export default function Loading() {
  return (
    <div className="space-y-16 sm:space-y-20">
      {/* Hero skeleton */}
      <section className="relative pt-4 sm:pt-8 pb-2">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-10 lg:gap-16 items-start">
          <div className="max-w-2xl pt-2 sm:pt-6 space-y-7">
            <Skeleton className="h-6 w-44 rounded-full" />
            <div className="space-y-3">
              <Skeleton className="h-14 sm:h-20 w-full max-w-[640px]" />
              <Skeleton className="h-14 sm:h-20 w-3/4 max-w-[480px]" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-full max-w-[520px]" />
              <Skeleton className="h-4 w-2/3 max-w-[420px]" />
            </div>
            <div className="flex gap-7 pt-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/60 p-6 sm:p-7 space-y-5">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-4 w-44" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-4 w-16" />
              <div className="grid grid-cols-[120px_1fr_auto] gap-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-28" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats strip skeleton */}
      <section>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="relative rounded-lg border border-border/50 bg-card/60 p-4 sm:p-5 overflow-hidden"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-3 w-20" />
              </div>
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))}
        </div>
      </section>

      {/* Recent cases skeleton */}
      <section>
        <div className="mb-7 space-y-2">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border/50 bg-card/60 overflow-hidden">
              <div className="p-5 pb-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <div className="flex gap-1.5">
                      <Skeleton className="h-4 w-14 rounded" />
                      <Skeleton className="h-4 w-16 rounded" />
                    </div>
                  </div>
                  <Skeleton className="h-4 w-4 rounded" />
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-border/40 px-5 py-3">
                <Skeleton className="h-3 w-40" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-7 w-7 rounded-md" />
                  <Skeleton className="h-7 w-7 rounded-md" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
