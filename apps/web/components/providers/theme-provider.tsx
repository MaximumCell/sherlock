"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_KEY, writeStorage } from "@/lib/storage";

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

/** An explicit choice, persisted per browser. */
export function setTheme(theme: Theme) {
  writeStorage(THEME_KEY, theme);
  apply(theme);
}

/**
 * Class-based theme (`.dark` on <html>). Dark is the default look of the console; the light
 * "case file" theme is one toggle away and remembered.
 */
export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => "dark");
  const toggle = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}
