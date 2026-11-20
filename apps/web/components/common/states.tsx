import type { LucideIcon } from "lucide-react";
import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Nothing here yet: a node waiting for its first connection, and the next thing to do. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="relative flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
        <span
          aria-hidden
          className="absolute -right-6 top-1/2 h-px w-5 bg-gradient-to-r from-border to-transparent"
        />
        <span
          aria-hidden
          className="absolute -left-6 top-1/2 h-px w-5 bg-gradient-to-l from-border to-transparent"
        />
      </span>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold">{title}</h3>
        {children ? (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{children}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Could not load this",
  error,
  onRetry,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-danger/30 bg-danger/[0.06] p-4 sm:flex-row sm:items-center"
    >
      <AlertTriangle className="h-5 w-5 shrink-0 text-danger" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="break-words text-sm text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/** Page title block: a mono eyebrow, a serif headline and one plain sentence. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-2">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">{title}</h1>
        {description ? (
          <p className="max-w-2xl text-base text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
