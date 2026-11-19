import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      {/* Heading row */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      {/* Report content — markdown-style blocks */}
      <div className="rounded-lg border border-border/50 bg-card/60 p-7 space-y-6 max-w-[820px]">
        {/* Title */}
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-3.5 w-24" />

        {/* Section */}
        <div className="space-y-2 pt-2">
          <Skeleton className="h-2.5 w-32" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
          </div>
        </div>

        {/* Section */}
        <div className="space-y-2 pt-4">
          <Skeleton className="h-2.5 w-40" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
        </div>

        {/* Code block */}
        <div className="rounded-md bg-muted/60 p-3 space-y-1.5">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>

        {/* More sections */}
        <div className="space-y-2 pt-4">
          <Skeleton className="h-2.5 w-36" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        </div>
      </div>
    </div>
  );
}
