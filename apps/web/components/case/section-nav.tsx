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
        "rounded-[4px] px-1 font-mono text-2xs tabular-nums",
        tone === "warning" ? "bg-warning/15 text-warning" : "text-muted-foreground",
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
            ? "relative space-y-0.5 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-border"
            : "scrollbar-none -mx-4 flex gap-1 overflow-x-auto px-4 sm:-mx-6 sm:px-6",
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
                  "flex items-center justify-between gap-2 text-sm font-medium transition-colors duration-1",
                  vertical
                    ? cn(
                        "relative rounded-md py-1.5 pl-6 pr-2",
                        current ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      )
                    : cn(
                        "rounded-md px-3 py-1.5",
                        current
                          ? "bg-secondary text-foreground shadow-[inset_0_0_0_1px_hsl(var(--input))]"
                          : "text-muted-foreground hover:text-foreground",
                      ),
                )}
              >
                {vertical ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute left-0 top-1/2 h-[11px] w-[11px] -translate-y-1/2 rounded-full border transition-[background-color,border-color,box-shadow] duration-2",
                      current
                        ? "border-accent bg-accent shadow-glow"
                        : "border-muted-foreground/50 bg-background",
                    )}
                  />
                ) : null}
                <span className="truncate">{SECTION_LABEL[id]}</span>
                <Count value={counts[id]} tone={id === "links" ? "warning" : "muted"} />
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
