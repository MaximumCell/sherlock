"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { brandColours, monogram, monogramHue } from "@/lib/brand-colour";
import type { BrandGlyph } from "@/lib/platform-glyphs";
import {
  platformRegistryVersion,
  resolvePlatform,
  subscribePlatformRegistry,
  type PlatformInfo,
} from "@/lib/platforms";
import { cn } from "@/lib/utils";

/*
 * The glyph table is its own chunk: it starts loading as soon as this module is first
 * evaluated (in parallel with the case data), and tiles show a monogram until it lands.
 */
type Glyphs = Readonly<Record<string, BrandGlyph>>;
let glyphs: Glyphs | null = null;
const glyphListeners = new Set<() => void>();
let loading: Promise<void> | null = null;

function loadGlyphs(): void {
  if (loading || typeof window === "undefined") return;
  loading = import("@/lib/platform-glyphs")
    .then((m) => {
      glyphs = m.PLATFORM_GLYPHS;
      glyphListeners.forEach((l) => l());
    })
    .catch(() => {
      loading = null; // monograms stay; try again on the next mount
    });
}
loadGlyphs();

function subscribeGlyphs(listener: () => void) {
  glyphListeners.add(listener);
  loadGlyphs();
  return () => glyphListeners.delete(listener);
}

/** The brand glyph table once loaded (null before, and on the server). */
export function useGlyphs(): Glyphs | null {
  return useSyncExternalStore(
    subscribeGlyphs,
    () => glyphs,
    () => null,
  );
}

/** The resolved platform; re-resolves when the live registry replaces the snapshot. */
export function usePlatformInfo(name: string | null | undefined, url?: string | null): PlatformInfo {
  useSyncExternalStore(subscribePlatformRegistry, platformRegistryVersion, () => 0);
  return resolvePlatform(name, url);
}

const SIZES = {
  xs: "h-4 w-4 rounded-[5px] text-[7px]",
  sm: "h-5 w-5 rounded-md text-[8px]",
  md: "h-7 w-7 rounded-lg text-[10px]",
  lg: "h-9 w-9 rounded-lg text-xs",
} as const;
export type PlatformIconSize = keyof typeof SIZES;

/**
 * A platform as a soft rounded tile: the brand glyph in one colour (brand colour adjusted
 * to stay readable in both themes) or, for platforms without one, a monogram on a
 * deterministic neutral tint. Decorative by default; pass `labelled` when the icon is the
 * only thing that names the platform.
 */
export function PlatformIcon({
  platform,
  url,
  size = "sm",
  labelled = false,
  className,
}: {
  platform: string | null | undefined;
  url?: string | null;
  size?: PlatformIconSize;
  labelled?: boolean;
  className?: string;
}) {
  const info = usePlatformInfo(platform, url);
  const table = useGlyphs();
  const glyph = table?.[info.key];
  const colours = glyph ? brandColours(glyph.hex) : null;
  const a11y = labelled
    ? { role: "img" as const, "aria-label": info.label, title: info.label }
    : { "aria-hidden": true as const };

  if (glyph && colours) {
    const style = {
      "--brand-light": colours.light,
      "--brand-dark": colours.dark,
      // a faint brand wash over the opaque card colour (badges sit on top of photos)
      backgroundImage: `linear-gradient(${colours.tint}17, ${colours.tint}17)`,
    } as CSSProperties;
    return (
      <span
        {...a11y}
        data-platform={info.key}
        style={style}
        className={cn(
          "inline-flex shrink-0 items-center justify-center border border-border/70 bg-card text-[var(--brand-light)] dark:text-[var(--brand-dark)]",
          SIZES[size],
          className,
        )}
      >
        <svg viewBox="0 0 24 24" className="h-[62%] w-[62%] fill-current" aria-hidden>
          <path d={glyph.path} />
        </svg>
      </span>
    );
  }
  const hue = monogramHue(info.key || info.label);
  return (
    <span
      {...a11y}
      data-platform={info.key}
      style={{ "--mono-hue": hue } as CSSProperties}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border border-border/70 bg-[hsl(var(--mono-hue)_18%_92%)] font-semibold leading-none tracking-tight text-[hsl(var(--mono-hue)_22%_30%)] dark:bg-[hsl(var(--mono-hue)_14%_18%)] dark:text-[hsl(var(--mono-hue)_22%_80%)]",
        SIZES[size],
        className,
      )}
    >
      {monogram(info.label, info.key)}
    </span>
  );
}
