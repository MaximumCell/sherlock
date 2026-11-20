"use client";

import { useEffect, useRef } from "react";
import { isTypingTarget } from "@/lib/storage";

export interface LinkKeyHandlers {
  enabled: boolean;
  onYes: () => void;
  onNo: () => void;
  onNext: () => void;
  onPrev: () => void;
  onUndo?: () => void;
}

/**
 * Keyboard for link decisions: Y or A = yes, N or R = no, J = next, K = previous, U = undo.
 * Registered in the capture phase so N here wins over the global "N = new search" shortcut
 * while the links section is the one being read. Ignored while typing or with a modifier.
 */
export function useLinkKeys(handlers: LinkKeyHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!handlers.enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const h = ref.current;
      const actions: Record<string, (() => void) | undefined> = {
        y: h.onYes,
        a: h.onYes,
        n: h.onNo,
        r: h.onNo,
        j: h.onNext,
        k: h.onPrev,
        u: h.onUndo,
      };
      const action = actions[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [handlers.enabled]);
}
