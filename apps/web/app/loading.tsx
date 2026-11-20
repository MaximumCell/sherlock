import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-11 w-80 max-w-full" />
      <Skeleton className="h-4 w-[32rem] max-w-full" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
