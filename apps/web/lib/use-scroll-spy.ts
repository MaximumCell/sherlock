"use client";

import { useEffect, useState } from "react";

/**
 * Which of the given section ids is currently being read: the last section whose top has
 * crossed a line `offset` px below the top of the viewport. Uses scroll position rather
 * than IntersectionObserver so tall sections are handled correctly.
 */
export function useScrollSpy(ids: readonly string[], offset = 160): string | null {
  const [active, setActive] = useState<string | null>(ids[0] ?? null);
  const key = ids.join("|");

  useEffect(() => {
    const list = key ? key.split("|") : [];
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = list[0] ?? null;
      for (const id of list) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top - offset <= 0) current = id;
      }
      const atBottom =
        window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) current = list[list.length - 1] ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // sections grow as data arrives; re-measure when the page height changes
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    observer?.observe(document.body);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, offset]);

  return active;
}
