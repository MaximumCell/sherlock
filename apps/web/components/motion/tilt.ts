"use client";

import type { PointerEvent } from "react";

/**
 * A subtle 3D tilt that follows the pointer (mouse only, max ~3°). It writes two CSS
 * variables; the `.tilt` rule in globals.css applies them, and drops them for reduced motion.
 */
export const tiltHandlers = {
  onPointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    const el = event.currentTarget;
    const r = el.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width - 0.5;
    const y = (event.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--tilt-x", `${(-y * 3).toFixed(2)}deg`);
    el.style.setProperty("--tilt-y", `${(x * 3).toFixed(2)}deg`);
  },
  onPointerLeave(event: PointerEvent<HTMLElement>) {
    event.currentTarget.style.removeProperty("--tilt-x");
    event.currentTarget.style.removeProperty("--tilt-y");
  },
};
