"use client";

import { X } from "lucide-react";
import { useRef } from "react";
import { useOnScreen } from "@/components/motion/hooks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Three small animated diagrams. They play once when scrolled into view (CSS only, so
 * reduced motion simply shows the end state) and explain the step, not decorate it.
 */

function SearchArt() {
  return (
    <svg viewBox="0 0 120 64" className="h-16 w-full" aria-hidden>
      <rect x="8" y="20" width="104" height="24" rx="6" className="fill-card stroke-input" strokeWidth="1.2" />
      <circle cx="22" cy="32" r="5" className="fill-none stroke-muted-foreground" strokeWidth="1.6" />
      <path d="M26 36 29 39" className="stroke-muted-foreground" strokeWidth="1.6" strokeLinecap="round" />
      <rect
        x="36"
        y="29"
        width="44"
        height="6"
        rx="3"
        className="origin-left fill-muted-foreground/40 [transform-box:fill-box] group-data-[play]:animate-[grow-x_900ms_var(--ease-out)_both]"
      />
      <rect x="88" y="25" width="18" height="14" rx="4" className="fill-accent" />
    </svg>
  );
}

function SourcesArt() {
  return (
    <svg viewBox="0 0 120 64" className="h-16 w-full" aria-hidden>
      {Array.from({ length: 12 }, (_, i) => {
        const x = 18 + (i % 6) * 15;
        const y = 16 + Math.floor(i / 6) * 18;
        const miss = i % 5 === 3;
        return (
          <g
            key={i}
            className="origin-center [transform-box:fill-box] group-data-[play]:animate-[tick-in_var(--dur-3)_var(--ease-spring)_both]"
            style={{ animationDelay: `${120 + i * 70}ms` }}
          >
            <rect
              x={x}
              y={y}
              width="11"
              height="11"
              rx="3"
              className={miss ? "fill-muted stroke-border" : "fill-success/20 stroke-success/60"}
              strokeWidth="1"
            />
            {miss ? null : (
              <path
                d={`M${x + 3} ${y + 5.5} l2 2 l3.5 -4`}
                className="fill-none stroke-success"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ConfirmArt() {
  return (
    <svg viewBox="0 0 120 64" className="h-16 w-full" aria-hidden>
      <rect x="10" y="16" width="38" height="32" rx="5" className="fill-card stroke-input" strokeWidth="1.2" />
      <rect x="72" y="16" width="38" height="32" rx="5" className="fill-card stroke-input" strokeWidth="1.2" />
      <circle cx="22" cy="28" r="5" className="fill-muted-foreground/40" />
      <circle cx="84" cy="28" r="5" className="fill-muted-foreground/40" />
      <rect x="17" y="37" width="24" height="4" rx="2" className="fill-muted-foreground/30" />
      <rect x="79" y="37" width="24" height="4" rx="2" className="fill-muted-foreground/30" />
      <path
        d="M48 32 H72"
        pathLength={1}
        strokeDasharray="1"
        className="stroke-success group-data-[play]:animate-[draw_700ms_var(--ease-out)_400ms_both]"
        strokeWidth="2"
      />
      <g className="origin-center [transform-box:fill-box] group-data-[play]:animate-[tick-in_var(--dur-3)_var(--ease-spring)_1000ms_both]">
        <circle cx="60" cy="32" r="8" className="fill-success" />
        <path d="M56.5 32 l2.5 2.5 l4.5 -5" className="fill-none stroke-background" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

const STEPS = [
  {
    art: SearchArt,
    title: "Search",
    body: "Type a username, email, website, IP, phone, wallet, image link or name.",
  },
  {
    art: SourcesArt,
    title: "We check public sources",
    body: "Dozens of data sources run in parallel. Results stream in as each one finishes.",
  },
  {
    art: ConfirmArt,
    title: "You confirm what is real",
    body: "We suggest links between results. Nothing counts until you say yes.",
  },
];

/**
 * The three steps, connected like the progress rail of an investigation. `trail` is the
 * compact vertical version beside the start-screen search; the default is the wide one with
 * animated diagrams.
 */
export function HowItWorks({
  onDismiss,
  headingLevel = "h2",
  variant = "wide",
}: {
  onDismiss?: () => void;
  headingLevel?: "h2" | "h3";
  variant?: "wide" | "trail";
}) {
  const Heading = headingLevel;
  const ref = useRef<HTMLElement>(null);
  const seen = useOnScreen(ref, "-10% 0px");
  const trail = variant === "trail";
  return (
    <section
      ref={ref}
      aria-labelledby="how-title"
      data-play={seen || undefined}
      className={cn("group relative", trail ? "space-y-4" : "panel p-5 sm:p-6")}
    >
      <div className="flex items-center justify-between gap-3">
        <Heading id="how-title" className="eyebrow">
          How it works
        </Heading>
        {onDismiss ? (
          <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Hide how it works">
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <ol
        className={cn(
          "relative",
          trail ? "space-y-5" : "mt-5 grid grid-cols-1 gap-8 sm:grid-cols-3 sm:gap-6",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute bg-border",
            trail ? "bottom-3 left-[11px] top-3 w-px" : "left-3 right-3 top-[11px] hidden h-px sm:block",
          )}
        />
        {STEPS.map(({ art: Art, title, body }, i) => (
          <li key={title} className={cn("relative", trail ? "flex gap-4" : "space-y-3")}>
            <span
              className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-input bg-background font-mono text-2xs text-foreground"
              aria-hidden
            >
              {i + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <p className="font-medium">
                <span className="sr-only">Step {i + 1}: </span>
                {title}
              </p>
              <p className="text-sm text-muted-foreground">{body}</p>
              {trail ? null : (
                <div className="pt-2">
                  <div className="rounded-lg border border-border bg-surface px-2 py-1">
                    <Art />
                  </div>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
