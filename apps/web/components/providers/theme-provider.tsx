"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { THEME_KEY, readStorage, writeStorage } from "@/lib/storage";

export type Theme = "dark" | "light";

const listeners = new Set<() => void>();

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  listeners.forEach((l) => l());
}

/** An explicit choice: persisted, and from then on the system preference is ignored. */
export function setTheme(theme: Theme) {
  writeStorage(THEME_KEY, theme);
  apply(theme);
}

/**
 * Class-based theme (`.dark` on <html>). Defaults to the system preference and follows
 * it live until the visitor picks one with the toggle.
 */
export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => "light");
  const toggle = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}

/** Mounted once: keeps the theme in sync with the OS while no explicit choice is stored. */
export function SystemThemeSync() {
  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => {
      const stored = readStorage(THEME_KEY);
      if (stored !== "light" && stored !== "dark") apply(media.matches ? "dark" : "light");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return null;
}
