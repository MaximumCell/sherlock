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
/** Tallest spotlight, as a share of the viewport. */
const SPOT_MAX = 0.42;
const SPOT_MIN = 72;

/**
 * How tall the spotlight may be so the card still fits underneath it: on a short
 * window the spotlight shrinks to the top of the section instead of the card
 * covering what it describes.
 */
function spotHeight(targetHeight: number, offset: number, cardHeight: number): number {
  const room = window.innerHeight - offset - cardHeight - PAD * 2 - GAP - 16;
  const cap = Math.max(SPOT_MIN, Math.min(window.innerHeight * SPOT_MAX, room));
  return Math.min(targetHeight, cap);
}

/**
 * Space taken at the top of the viewport by sticky bars (top bar, progress rail).
 * A target must sit below it, otherwise its top edge hides underneath.
 */
function stickyOffset(target: HTMLElement): number {
  let bottom = 0;
  document.querySelectorAll<HTMLElement>("header, [data-sticky]").forEach((el) => {
    if (el.contains(target) || target.contains(el)) return;
    const style = getComputedStyle(el);
    if (style.position !== "sticky" && style.position !== "fixed") return;
    const pinnedAt = Number.parseFloat(style.top);
    if (Number.isNaN(pinnedAt)) return;
    const r = el.getBoundingClientRect();
    // a sticky bar will sit at `top` once the page scrolls, wherever it is right now
    if (r.height < window.innerHeight * 0.4) bottom = Math.max(bottom, pinnedAt + r.height);
  });
  return bottom + PAD + GAP;
}

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
  const cardHeightRef = useRef(cardHeight);

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
      const offset = stickyOffset(target);
      const top = Math.max(r.top, offset - GAP);
      const height = Math.max(0, spotHeight(r.bottom - top, offset, cardHeightRef.current));
      setBox({ top, left: r.left, width: r.width, height });
    };
    target = findTarget(step);
    const align = (behavior: ScrollBehavior) => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      const offset = stickyOffset(target);
      // just under the sticky bars: the spotlight is sized so the card fits below it
      window.scrollTo({ top: Math.max(0, window.scrollY + r.top - offset), behavior });
    };
    align(reducedMotion() ? "auto" : "smooth");
    // the page can still be settling (panels folding, data arriving): re-align once it has
    const realign = window.setTimeout(() => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      const offset = stickyOffset(target);
      if (r.top < offset - 2 || r.top > window.innerHeight * 0.6) align("auto");
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
    if (cardRef.current) {
      cardHeightRef.current = cardRef.current.offsetHeight;
      setCardHeight(cardRef.current.offsetHeight);
    }
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
    const below = box.top + box.height + PAD + GAP;
    const above = box.top - PAD - GAP - cardHeight;
    const fitsBelow = below + cardHeight <= vh - 16;
    const fitsAbove = above >= 16;
    // the spotlight is capped (SPOT_MAX), so one of the two normally fits; the last
    // resort pins the card to the bottom edge, clear of the spotlight's top
    top = fitsBelow ? below : fitsAbove ? above : Math.max(16, vh - cardHeight - 16);
    left = Math.min(Math.max(16, box.left), vw - width - 16);
  }
  const last = index === total - 1;

  return (
    <div data-print="hide" className="pointer-events-none fixed inset-0 z-[60]">
      {box ? (
        <div
          aria-hidden
          className="absolute rounded-xl shadow-[0_0_0_9999px_hsl(var(--shadow)/0.68),0_0_32px_-4px_hsl(var(--glow)/0.6)] ring-1 ring-accent transition-all duration-3 ease-out motion-reduce:transition-none"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-[hsl(var(--shadow)/0.68)]" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="pointer-events-auto absolute animate-fade-in space-y-3 rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-lift outline-none transition-[top,left] duration-3 ease-out motion-reduce:transition-none"
        style={{ top, left, width }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <p className="eyebrow text-accent">
              Step {index + 1} of {total}
            </p>
            <ol aria-hidden className="flex gap-1">
              {Array.from({ length: total }, (_, i) => (
                <li
                  key={i}
                  className={`h-1 w-5 rounded-full ${i <= index ? "bg-accent" : "bg-muted"}`}
                />
              ))}
            </ol>
          </div>
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
        <h2 id="tour-title" className="font-display text-2xl tracking-tight">
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
