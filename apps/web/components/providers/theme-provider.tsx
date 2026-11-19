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

export function setTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  writeStorage(THEME_KEY, theme);
  listeners.forEach((l) => l());
}

/** Class-based theme (`.dark` on <html>), persisted in localStorage. */
export function useTheme() {
  const theme = useSyncExternalStore<Theme>(subscribe, currentTheme, () => "dark");
  const toggle = useCallback(() => setTheme(currentTheme() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}
