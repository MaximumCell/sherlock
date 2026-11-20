"use client";

import { TargetIcon } from "@/components/common/bits";
import { PlatformIcon } from "@/components/common/platform-icon";
import { SOURCE_GROUPS } from "@/lib/sources";
import type { ModuleInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Availability = "all" | "ready" | "setup";

/** The platform a single-platform source reads ("profile_bluesky", "linkedin_search", "github"). */
export function sourceIconKey(name: string): string {
  return name.replace(/^profile_/, "").replace(/_search$/, "");
}

export function matchesGroup(m: ModuleInfo, groupId: string | null): boolean {
  if (!groupId) return true;
  const group = SOURCE_GROUPS.find((g) => g.id === groupId);
  return group ? group.types.some((t) => m.inputs.includes(t)) : true;
}

export function matchesAvailability(m: ModuleInfo, a: Availability): boolean {
  return a === "all" || (a === "ready" ? m.available : !m.available);
}

/**
 * Every source as one node on a board. Pick what you want to search and the sources that can
 * take it light up; the rest step back. Clicking a source jumps to its description.
 */
export function SourceConstellation({
  modules,
  group,
  onGroup,
  availability,
  onAvailability,
}: {
  modules: ModuleInfo[];
  group: string | null;
  onGroup: (id: string | null) => void;
  availability: Availability;
  onAvailability: (a: Availability) => void;
}) {
  const lit = modules.filter((m) => matchesGroup(m, group) && matchesAvailability(m, availability));
  return (
    <section aria-labelledby="board-title" className="panel overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <div className="space-y-4 border-b border-border p-5 lg:border-b-0 lg:border-r">
          <h2 id="board-title" className="eyebrow">
            What do you want to search?
          </h2>
          <ul className="space-y-1" aria-label="Kinds of search">
            {[{ id: null, title: "Everything", types: ["username"] }, ...SOURCE_GROUPS].map((g) => {
              const on = group === g.id;
              const n = modules.filter((m) => matchesGroup(m, g.id)).length;
              return (
                <li key={g.id ?? "all"}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onGroup(g.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-1",
                      on
                        ? "bg-secondary text-foreground shadow-[inset_0_0_0_1px_hsl(var(--input))]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {g.id ? (
                      <TargetIcon type={g.types[0] ?? "username"} className="h-4 w-4 shrink-0" />
                    ) : (
                      <span
                        className="h-4 w-4 shrink-0 rounded-full border border-current"
                        aria-hidden
                      />
                    )}
                    <span className="flex-1">{g.title}</span>
                    <span className="font-mono text-2xs tabular-nums">{n}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div
            role="group"
            aria-label="Availability"
            className="flex rounded-md border border-border p-0.5"
          >
            {(["all", "ready", "setup"] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={availability === a}
                onClick={() => onAvailability(a)}
                className={cn(
                  "flex-1 rounded-[5px] px-2 py-1 text-xs transition-colors duration-1",
                  availability === a
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {a === "all" ? "All" : a === "ready" ? "Ready" : "Needs setup"}
              </button>
            ))}
          </div>
        </div>
        <div className="p-5">
          <p className="mb-4 text-sm text-muted-foreground" aria-live="polite">
            {lit.length} of {modules.length} sources match.
          </p>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {modules.map((m) => {
              const on = lit.includes(m);
              return (
                <li
                  key={m.name}
                  className={cn("transition-opacity duration-3", !on && "opacity-30")}
                >
                  <a
                    href={`#source-${m.name}`}
                    tabIndex={on ? undefined : -1}
                    aria-hidden={on ? undefined : true}
                    className={cn(
                      "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-[border-color,box-shadow] duration-2",
                      on ? "border-border hover:border-accent/60" : "border-transparent",
                      on && group && "border-accent/40",
                    )}
                  >
                    <PlatformIcon platform={sourceIconKey(m.name)} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{m.title}</span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        m.available ? "bg-success" : "bg-warning",
                      )}
                      role="img"
                      aria-label={m.available ? "ready" : "needs setup"}
                    />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
