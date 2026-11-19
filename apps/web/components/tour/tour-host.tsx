"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { readFlag, setFlag, TOUR_KEY } from "@/lib/preferences";
import { CoachMark } from "./coach-mark";
import { TOUR_STEPS } from "./tour-steps";

/**
 * Runs the tour on the demo investigation: automatically on the first visit, or whenever
 * the URL carries `?tour=1` ("Take the tour"). Finishing or skipping is remembered.
 */
export function TourHost() {
  const params = useSearchParams();
  const requested = params.get("tour") === "1";
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!requested && readFlag(TOUR_KEY)) return;
    // give the page a moment to lay out the sections the tour points at
    const timer = window.setTimeout(() => setIndex(0), 900);
    return () => window.clearTimeout(timer);
  }, [requested]);

  const close = useCallback(() => {
    setIndex(null);
    setFlag(TOUR_KEY, true);
    const url = new URL(window.location.href);
    if (url.searchParams.has("tour")) {
      url.searchParams.delete("tour");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  if (index === null) return null;
  const step = TOUR_STEPS[index];
  if (!step) return null;
  return (
    <CoachMark
      step={step}
      index={index}
      total={TOUR_STEPS.length}
      onBack={() => setIndex((i) => Math.max(0, (i ?? 0) - 1))}
      onNext={() => (index + 1 >= TOUR_STEPS.length ? close() : setIndex(index + 1))}
      onClose={close}
    />
  );
}
