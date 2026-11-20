"use client";

import { useEffect, useRef, useState } from "react";
import { countUpDuration, countUpValue, formatCount } from "@/lib/ui/count-up";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "./hooks";

/**
 * A number that counts from its previous value to the new one. Screen readers get the
 * final value only; with reduced motion it simply changes.
 */
export function CountUp({
  value,
  decimals = 0,
  className,
  startFrom = 0,
}: {
  value: number;
  decimals?: number;
  className?: string;
  /** Where the very first count starts. */
  startFrom?: number;
}) {
  const reduce = usePrefersReducedMotion();
  const [shown, setShown] = useState(reduce ? value : startFrom);
  const shownRef = useRef(shown);

  useEffect(() => {
    const from = shownRef.current;
    const duration = countUpDuration(from, value);
    if (reduce || duration === 0) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / duration;
      const next = countUpValue(from, value, t, decimals);
      shownRef.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce, decimals]);

  return (
    <span className={cn("tabular-nums", className)}>
      <span aria-hidden>{formatCount(shown, decimals)}</span>
      <span className="sr-only">{formatCount(value, decimals)}</span>
    </span>
  );
}
