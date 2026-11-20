import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One section of the case page: an anchored landmark with a heading and a short intro. Each
 * opens on a node on a hairline, the same mark the section rail uses: the page reads as one
 * connected trail of evidence.
 */
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
      className={cn("scroll-mt-36 space-y-6 pt-12 first:pt-0", className)}
    >
      <div aria-hidden className="flex items-center gap-2" data-print="hide">
        <span className="h-2 w-2 rounded-full border border-muted-foreground/60 bg-background" />
        <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
      </div>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          <h2
            id={`${id}-title`}
            className="flex items-center gap-1.5 font-display text-3xl tracking-tight sm:text-4xl"
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
