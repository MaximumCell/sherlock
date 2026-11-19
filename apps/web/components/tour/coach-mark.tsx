"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { TourStep } from "./tour-steps";

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const GAP = 12;
const CARD_MAX = 360;

function findTarget(step: TourStep): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) ??
    document.getElementById(step.fallback)
  );
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** A coach-mark popover anchored to a real element, with a soft spotlight around it. */
export function CoachMark({
  step,
  index,
  total,
  onNext,
  onBack,
  onClose,
}: {
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(180);
  const cardRef = useRef<HTMLDivElement>(null);

  // bring the target into view, then track its position while the page moves
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    let target: HTMLElement | null = null;
    const measure = () => {
      frame = 0;
      if (!target || !target.isConnected) target = findTarget(step);
      if (!target) {
        setBox(null);
        if (tries++ < 20) frame = requestAnimationFrame(measure);
        return;
      }
      const r = target.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    target = findTarget(step);
    const align = (behavior: ScrollBehavior) => {
      if (!target) return;
      const tall = target.getBoundingClientRect().height > window.innerHeight * 0.5;
      target.scrollIntoView({ block: tall ? "start" : "center", behavior });
    };
    align(reducedMotion() ? "auto" : "smooth");
    // the page can still be settling (panels folding, data arriving): re-align once it has
    const realign = window.setTimeout(() => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      if (r.top < 0 || r.top > window.innerHeight * 0.6) align("auto");
    }, 900);
    measure();
    const onMove = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onMove, { passive: true });
    window.addEventListener("resize", onMove);
    const settle = window.setInterval(onMove, 250);
    return () => {
      window.removeEventListener("scroll", onMove);
      window.removeEventListener("resize", onMove);
      window.clearInterval(settle);
      window.clearTimeout(realign);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [step]);

  useLayoutEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [index]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const width = Math.min(CARD_MAX, vw - 32);
  let top = vh / 2 - cardHeight / 2;
  let left = vw / 2 - width / 2;
  if (box) {
    // the top of a tall target stays visible, so measure space from its visible part
    const visibleBottom = Math.min(box.top + box.height, vh);
    const below = visibleBottom + PAD + GAP;
    const above = box.top - PAD - GAP - cardHeight;
    top =
      below + cardHeight <= vh - 16
        ? below
        : above >= 72
          ? above
          : Math.max(72, vh - cardHeight - 16);
    left = Math.min(Math.max(16, box.left), vw - width - 16);
  }
  const last = index === total - 1;

  return (
    <div data-print="hide" className="pointer-events-none fixed inset-0 z-[60]">
      {box ? (
        <div
          aria-hidden
          className="absolute rounded-xl shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] ring-2 ring-accent transition-all duration-300 motion-reduce:transition-none"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: Math.min(box.height + PAD * 2, vh),
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="pointer-events-auto absolute animate-rise-in space-y-3 rounded-2xl border border-border bg-popover p-5 text-popover-foreground shadow-lift outline-none"
        style={{ top, left, width }}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-medium text-accent">
            Step {index + 1} of {total}
          </p>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mr-2 -mt-2"
            onClick={onClose}
            aria-label="Close the tour"
          >
            <X aria-hidden />
          </Button>
        </div>
        <h2 id="tour-title" className="text-lg font-semibold tracking-tight">
          {step.title}
        </h2>
        <p id="tour-body" className="text-sm text-muted-foreground">
          {step.body}
        </p>
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
          <div className="flex gap-2">
            {index > 0 ? (
              <Button variant="outline" size="sm" onClick={onBack}>
                Back
              </Button>
            ) : null}
            <Button size="sm" onClick={onNext}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
