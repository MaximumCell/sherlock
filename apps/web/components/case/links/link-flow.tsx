"use client";

import { AnimatePresence, m } from "motion/react";
import type { ComponentProps } from "react";
import { MotionProvider } from "@/components/motion/motion-provider";
import { LinkQuestion } from "./link-question";

/** The answered card flies off to its side; the next one rises in. */
const CARD_MOTION = {
  enter: { opacity: 0, y: 16, scale: 0.98 },
  center: { opacity: 1, y: 0, x: 0, rotate: 0, scale: 1, transition: { duration: 0.3 } },
  leave: (dir: number) => ({
    opacity: 0,
    x: dir * 240,
    y: dir === 0 ? -12 : 0,
    rotate: dir * 4,
    transition: { duration: 0.32 },
  }),
};

/**
 * The one-at-a-time link question with its enter/leave motion and the touch swipe. This is
 * the only place the motion library is used, so it loads lazily with this module.
 */
export default function LinkFlow({
  leaving,
  ...question
}: ComponentProps<typeof LinkQuestion> & { leaving: -1 | 0 | 1 }) {
  return (
    <MotionProvider>
      <AnimatePresence mode="popLayout" initial={false} custom={leaving}>
        <m.div
          key={question.correlation.id}
          custom={leaving}
          variants={CARD_MOTION}
          initial="enter"
          animate="center"
          exit="leave"
        >
          <LinkQuestion {...question} />
        </m.div>
      </AnimatePresence>
    </MotionProvider>
  );
}
