"use client";

import { LazyMotion, MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { EASE_OUT } from "@/lib/ui/count-up";

const loadFeatures = () => import("./features").then((m) => m.default);

/**
 * One motion setup for the app: features load lazily (off the critical path), every
 * animation uses the house curve, and `reducedMotion="user"` turns transforms off for
 * people who ask their device for less motion.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user" transition={{ duration: 0.24, ease: EASE_OUT }}>
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
