import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One section of the case page: an anchored landmark with a heading and a short intro. */
export function CaseSection({
  id,
  title,
  description,
  actions,
  hint,
  children,
  className,
  tour,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  tour?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-section={id}
      data-tour={tour}
      className={cn(
        "scroll-mt-36 space-y-5 border-t border-border pt-10 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2
            id={`${id}-title`}
            className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight"
          >
            {title}
            {hint}
          </h2>
          {description ? (
            <p className="max-w-2xl text-base text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </header>
      {children}
    </section>
  );
}
