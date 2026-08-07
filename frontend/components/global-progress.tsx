"use client";
/** Global in-flight API counter. Every api() call emits 'sherlock:api:begin'
 *  on start and 'sherlock:api:end' on completion (success or error). The
 *  thin progress bar at the top of every page renders while the counter
 *  is > 0, giving the user a "something is happening" signal even for
 *  fast calls. The event-bus approach means api() (which lives in a plain
 *  module, not a component) can poke the counter without needing hooks.
 *  The begin/end helpers themselves live in api-inflight.ts (no
 *  "use client" boundary) so server components can also call them — they
 *  no-op outside the browser. */
import { useEffect, useState } from "react";
import { BEGIN, END } from "./api-inflight";

let counter = 0;
const listeners = new Set<(n: number) => void>();

function emit(n: number) {
  for (const l of listeners) l(n);
}

if (typeof window !== "undefined") {
  window.addEventListener(BEGIN, () => {
    counter += 1;
    emit(counter);
  });
  window.addEventListener(END, () => {
    counter = Math.max(0, counter - 1);
    emit(counter);
  });
}

export function InflightProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ProgressBar />
    </>
  );
}

function ProgressBar() {
  const [inflight, setInflight] = useState(0);
  useEffect(() => {
    const l = (n: number) => setInflight(n);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  // Don't show for the first 80ms — quick responses flash it distractingly.
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(8);
  useEffect(() => {
    if (inflight === 0) {
      setVisible(false);
      setProgress(8);
      return;
    }
    const t = setTimeout(() => setVisible(true), 80);
    return () => clearTimeout(t);
  }, [inflight]);
  useEffect(() => {
    if (!visible) return;
    // Crawl towards 92% to feel alive, but never reach 100% (the call
    // returning snaps it to 100% then off).
    const interval = setInterval(() => {
      setProgress((p) => (p < 90 ? p + Math.random() * 8 : p));
    }, 400);
    return () => clearInterval(interval);
  }, [visible]);

  return (
    <div
      aria-hidden={!visible}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background:
            "linear-gradient(90deg, transparent 0%, var(--color-accent, #22c55e) 50%, transparent 100%)",
          boxShadow: "0 0 8px var(--color-accent, #22c55e)",
          transition: visible
            ? "width 350ms cubic-bezier(0.4, 0, 0.2, 1)"
            : "none",
        }}
      />
    </div>
  );
}
