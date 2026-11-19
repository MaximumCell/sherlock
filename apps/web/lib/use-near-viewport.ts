"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * True once the element has come within `margin` of the viewport (and stays true).
 * Used to mount heavy parts (the map, the report) only when the reader gets close.
 */
export function useNearViewport(ref: RefObject<Element | null>, margin = "600px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(id);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, margin, near]);
  return near;
}
