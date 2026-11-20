"use client";

import type { ReactNode } from "react";

/** What the two sides share, drawn as the line between them. */
export function Connector({ value, rule }: { value: string | null; rule: string }) {
  return (
    <div className="relative flex min-w-0 flex-col items-center justify-center gap-2 py-2 md:w-44 md:py-0">
      <svg
        aria-hidden
        className="absolute inset-y-0 left-1/2 h-full w-px -translate-x-1/2 overflow-visible md:inset-x-0 md:left-0 md:top-1/2 md:h-px md:w-full md:-translate-y-1/2 md:translate-x-0"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <line
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          pathLength={1}
          strokeDasharray="1"
          className="hidden stroke-warning animate-[draw_600ms_var(--ease-out)_both] md:block"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="50"
          y1="0"
          x2="50"
          y2="100"
          className="stroke-warning/70 md:hidden"
          strokeWidth="2"
          strokeDasharray="4 4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="relative z-10 rounded-md border border-warning/40 bg-popover px-2 py-1 text-center text-2xs text-muted-foreground">
        {rule}
      </span>
      {value ? (
        <span className="relative z-10 max-w-full break-all rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-center font-mono text-xs text-foreground">
          {value}
        </span>
      ) : null}
    </div>
  );
}

/** The second account of a pair gets the connector in front of it (between the two). */
export function AccountSideWithConnector({
  showConnector,
  children,
}: {
  showConnector: boolean;
  children: [ReactNode, ReactNode];
}) {
  const [connector, side] = children;
  return (
    <>
      {showConnector ? <li className="list-none">{connector}</li> : null}
      {side}
    </>
  );
}
