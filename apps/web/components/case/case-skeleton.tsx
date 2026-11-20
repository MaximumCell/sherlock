import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the case page: title, chips, rail, section nav and the first panels. */
export function CaseSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading investigation">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-11 w-[28rem] max-w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-6 w-44" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <div className="hidden space-y-3 lg:block">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-28" />
          ))}
        </div>
        <div className="space-y-6">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-8 w-2/3" />
          <div className="grid gap-4 md:grid-cols-3">
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl md:col-span-2" />
          </div>
        </div>
      </div>
    </div>
  );
}
