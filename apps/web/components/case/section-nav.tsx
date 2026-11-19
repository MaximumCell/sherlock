"use client";

import { useEffect, useRef } from "react";
import { SECTION_LABEL, type CaseSection } from "@/lib/sections";
import { cn } from "@/lib/utils";

/** Scroll to a section (or any anchor) and reflect it in the URL hash without a navigation. */
export function goToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "start" });
  const url = new URL(window.location.href);
  url.hash = id;
  window.history.replaceState(window.history.state, "", url);
  const heading = el.querySelector<HTMLElement>("h2");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

function Count({ value, tone }: { value: number | undefined; tone: "muted" | "warning" }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-2xs font-medium tabular-nums",
        tone === "warning" ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground",
      )}
    >
      {value}
    </span>
  );
}

/**
 * Section navigation with scroll-spy: a vertical list beside the page on desktop, a
 * horizontal row of pills under the header on small screens.
 */
export function SectionNav({
  sections,
  active,
  counts,
  orientation,
}: {
  sections: CaseSection[];
  active: string | null;
  counts: Partial<Record<CaseSection, number>>;
  orientation: "vertical" | "horizontal";
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const vertical = orientation === "vertical";

  // keep the active pill visible in the horizontal scroller
  useEffect(() => {
    if (vertical || !active) return;
    const pill = listRef.current?.querySelector<HTMLElement>(`[data-target="${active}"]`);
    const list = listRef.current;
    if (!pill || !list) return;
    const left = pill.offsetLeft - list.clientWidth / 2 + pill.clientWidth / 2;
    list.scrollTo({ left, behavior: "smooth" });
  }, [active, vertical]);

  return (
    <nav aria-label="Sections of this investigation" data-print="hide">
      <ul
        ref={listRef}
        className={cn(
          vertical
            ? "space-y-0.5"
            : "scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:-mx-6 sm:px-6",
        )}
      >
        {sections.map((id) => {
          const current = id === active;
          return (
            <li key={id} className={vertical ? undefined : "shrink-0"}>
              <a
                href={`#${id}`}
                data-target={id}
                aria-current={current ? "location" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  goToSection(id);
                }}
                className={cn(
                  "flex items-center justify-between gap-2 text-sm font-medium transition-colors",
                  vertical
                    ? cn(
                        "relative rounded-md px-3 py-1.5",
                        current
                          ? "bg-muted text-foreground before:absolute before:inset-y-1.5 before:-left-px before:w-0.5 before:rounded-full before:bg-accent"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )
                    : cn(
                        "rounded-full border px-3 py-1",
                        current
                          ? "border-foreground/20 bg-foreground text-background"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      ),
                )}
              >
                {SECTION_LABEL[id]}
                <Count value={counts[id]} tone={id === "links" ? "warning" : "muted"} />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
