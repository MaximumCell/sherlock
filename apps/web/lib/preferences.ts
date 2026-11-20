"use client";

import { useCallback, useSyncExternalStore } from "react";
import { readStorage, writeStorage } from "./storage";

/**
 * Small per-browser preferences kept in localStorage (never throws). Each one is a
 * tiny external store so every component that reads it re-renders when it changes.
 */
export const ADVANCED_KEY = "sherlock.advanced";
export const TOUR_KEY = "sherlock.tour.v1";
export const INTRO_KEY = "sherlock.intro-dismissed";

const listeners = new Map<string, Set<() => void>>();

function subscribeKey(key: string) {
  return (listener: () => void) => {
    const set = listeners.get(key) ?? new Set();
    set.add(listener);
    listeners.set(key, set);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      set.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  };
}

export function setFlag(key: string, value: boolean): void {
  writeStorage(key, value ? "1" : "0");
  listeners.get(key)?.forEach((l) => l());
}

export function readFlag(key: string): boolean {
  return readStorage(key) === "1";
}

const subscribers = new Map<string, ReturnType<typeof subscribeKey>>();
function subscriberFor(key: string) {
  let sub = subscribers.get(key);
  if (!sub) {
    sub = subscribeKey(key);
    subscribers.set(key, sub);
  }
  return sub;
}

/** A boolean preference. `serverValue` is used during SSR and hydration. */
export function useFlag(key: string, serverValue = false): [boolean, (value: boolean) => void] {
  const value = useSyncExternalStore(
    subscriberFor(key),
    () => readFlag(key),
    () => serverValue,
  );
  const set = useCallback((next: boolean) => setFlag(key, next), [key]);
  return [value, set];
}

/** The "Advanced" switch: reveals module ids, queues, attempts, finding keys, raw JSON and rule ids. */
export function useAdvanced(): [boolean, (value: boolean) => void] {
  return useFlag(ADVANCED_KEY);
}
