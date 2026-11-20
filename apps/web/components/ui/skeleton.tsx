import { cn } from "@/lib/utils";

/** A shimmering placeholder; give it the shape of the content it stands in for. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("shimmer rounded-md", className)} {...props} />;
}

export { Skeleton };
