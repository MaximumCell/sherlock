"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

function subscribeMedia(query: string) {
  return (listener: () => void) => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia(query);
    } catch {
      return () => {};
    }
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  };
}

function matches(query: string): boolean {
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

const REDUCE = "(prefers-reduced-motion: reduce)";
const subscribeReduce = subscribeMedia(REDUCE);

/** True when the visitor asked their device for reduced motion (server: true, so nothing animates before hydration). */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduce, () => matches(REDUCE), () => true);
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
}

/** False while the tab is hidden, so loops can pause. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => !document.hidden,
    () => true,
  );
}

/** Whether an element is (roughly) on screen. Off-screen canvases stop drawing. */
export function useOnScreen(ref: RefObject<Element | null>, margin = "0px"): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setOn(entry?.isIntersecting ?? false), {
      rootMargin: margin,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return on;
}

const TOUCH = "(hover: none) and (pointer: coarse)";
const subscribeTouch = subscribeMedia(TOUCH);

/** True on touch-first devices (phones, tablets): enables swipe gestures. */
export function useTouchDevice(): boolean {
  return useSyncExternalStore(subscribeTouch, () => matches(TOUCH), () => false);
}
