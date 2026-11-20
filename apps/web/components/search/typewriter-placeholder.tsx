"use client";

import { useEffect, useState } from "react";
import { usePageVisible, usePrefersReducedMotion } from "@/components/motion/hooks";
import { typewriterText } from "@/lib/ui/search-hints";

/**
 * A placeholder that types fictional examples one after another. Decorative: the input keeps
 * its own accessible name. Static with reduced motion or in a hidden tab.
 */
export function TypewriterPlaceholder({
  examples,
  fallback,
  className,
}: {
  examples: readonly string[];
  fallback: string;
  className?: string;
}) {
  const reduce = usePrefersReducedMotion();
  const visible = usePageVisible();
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (reduce || !visible) return;
    const start = performance.now() - 400;
    const id = window.setInterval(() => setElapsed(performance.now() - start), 50);
    return () => window.clearInterval(id);
  }, [reduce, visible]);

  if (reduce || elapsed === null) {
    return (
      <span aria-hidden className={className}>
        {fallback}
      </span>
    );
  }
  const { text } = typewriterText(examples, elapsed);
  return (
    <span aria-hidden className={className}>
      <span className="mr-2 text-muted-foreground/70">Try</span>
      <span className="font-mono text-[0.95em] text-muted-foreground">{text}</span>
      <span className="ml-px inline-block h-[1.1em] w-px translate-y-[0.2em] animate-caret bg-accent" />
    </span>
  );
}
