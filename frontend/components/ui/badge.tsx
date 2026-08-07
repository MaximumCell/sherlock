import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        // OSINT semantic variants
        accent: "border-transparent bg-accent/15 text-accent border-accent/30",
        muted: "border-border/50 bg-muted text-foreground/60",
        found: "border-status-found-border bg-status-found-bg text-status-found",
        error: "border-status-error-border bg-status-error-bg text-status-error",
        warn: "border-status-warning-border bg-status-warning-bg text-status-warning",
        info: "border-status-info-border bg-status-info-bg text-status-info",
        cyan: "border-cyan/30 bg-cyan/10 text-cyan",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
