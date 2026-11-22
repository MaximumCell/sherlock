"use client";

import { Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  fitZoom,
  centerOf,
  pointInView,
  project,
  tileUrl,
  unproject,
  visibleTiles,
  type Point,
} from "@/lib/geo";
import { cn } from "@/lib/utils";

export interface MapMarker {
  key: string;
  point: Point;
  label: string;
  tone: "camera" | "claim" | "pick";
}

const TONE: Record<MapMarker["tone"], string> = {
  camera: "bg-accent text-accent-foreground",
  claim: "bg-warning text-background",
  pick: "bg-foreground text-background",
};

/**
 * A small, dependency-free OpenStreetMap map: standard tiles, drag to pan, buttons or +/- keys to
 * zoom, arrows to pan, and (with `onPick`) a click or Enter to pick the centre point. Points are
 * rounded to two decimals (about 1 km), like everything stored.
 */
export function OsmMap({
  markers,
  onPick,
  className,
  label,
}: {
  markers: MapMarker[];
  onPick?: (p: Point) => void;
  className?: string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 320 });
  const [measured, setMeasured] = useState(false);
  const points = useMemo(() => markers.map((m) => m.point), [markers]);
  const fitKey = points.map((p) => `${p.lat},${p.lon}`).join("|");
  const [view, setView] = useState<{ center: Point; zoom: number }>(() => ({
    center: centerOf(points) ?? { lat: 48.86, lon: 2.35 },
    zoom: points.length ? fitZoom(points, 640, 320) : 3,
  }));
  const drag = useRef<{ x: number; y: number; moved: boolean; start: Point } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === 0) return;
      setMeasured(true);
      setSize({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-fit when the markers change (a new claim, a re-check) or the box is first measured, never
  // on a pan: state adjusted during render, as React recommends instead of an effect.
  const fitFor = `${fitKey}@${measured ? "m" : "-"}`;
  const [fitted, setFitted] = useState(fitFor);
  if (fitted !== fitFor) {
    setFitted(fitFor);
    if (points.length)
      setView({ center: centerOf(points)!, zoom: fitZoom(points, size.w, size.h) });
  }

  const tiles = visibleTiles(view.center, view.zoom, size.w, size.h);
  const zoomBy = (d: number) =>
    setView((v) => ({ ...v, zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom + d)) }));
  const panBy = (dx: number, dy: number) =>
    setView((v) => {
      const c = project(v.center, v.zoom);
      return { ...v, center: unproject(c.x + dx, c.y + dy, v.zoom) };
    });

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("button,a")) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false, start: view.center };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    const c = project(d.start, view.zoom);
    setView((v) => ({ ...v, center: unproject(c.x - dx, c.y - dy, v.zoom) }));
  }
  function onPointerUp(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || !onPick || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const c = project(view.center, view.zoom);
    onPick(
      unproject(
        c.x + e.clientX - rect.left - size.w / 2,
        c.y + e.clientY - rect.top - size.h / 2,
        view.zoom,
      ),
    );
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = 80;
    const map: Record<string, () => void> = {
      ArrowLeft: () => panBy(-step, 0),
      ArrowRight: () => panBy(step, 0),
      ArrowUp: () => panBy(0, -step),
      ArrowDown: () => panBy(0, step),
      "+": () => zoomBy(1),
      "=": () => zoomBy(1),
      "-": () => zoomBy(-1),
      Enter: () => onPick?.(view.center),
    };
    const fn = map[e.key];
    if (fn) {
      e.preventDefault();
      fn();
    }
  }

  return (
    <div
      className={cn("relative overflow-hidden rounded-lg border border-border bg-muted", className)}
    >
      <div
        ref={box}
        role="application"
        aria-label={`${label}${onPick ? ". Click or press Enter to pick the centre as the claimed place; arrow keys move, plus and minus zoom." : ""}`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={onKeyDown}
        className={cn(
          "absolute inset-0 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-ring",
          onPick ? "cursor-crosshair" : "cursor-grab",
        )}
      >
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element -- standard OSM tiles, not optimisable
          <img
            key={t.key}
            src={tileUrl(t)}
            alt=""
            draggable={false}
            referrerPolicy="strict-origin-when-cross-origin"
            className="pointer-events-none absolute h-64 w-64 max-w-none dark:brightness-[0.72] dark:contrast-[1.1] dark:invert-[0.92] dark:hue-rotate-180"
            style={{ left: t.left, top: t.top }}
          />
        ))}
        {markers.map((m) => {
          const at = pointInView(m.point, view.center, view.zoom, size.w, size.h);
          if (at.x < -20 || at.y < -20 || at.x > size.w + 20 || at.y > size.h + 20) return null;
          return (
            <span
              key={m.key}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-full"
              style={{ left: at.x, top: at.y }}
            >
              <span
                className={cn(
                  "block whitespace-nowrap rounded-md px-1.5 py-0.5 text-2xs font-medium shadow",
                  TONE[m.tone],
                )}
              >
                {m.label}
              </span>
              <span aria-hidden className={cn("mx-auto block h-2 w-0.5", TONE[m.tone])} />
              <span
                aria-hidden
                className={cn(
                  "mx-auto -mt-0.5 block h-2 w-2 rounded-full ring-2 ring-background",
                  TONE[m.tone],
                )}
              />
            </span>
          );
        })}
      </div>
      <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border border-border glass">
        <button
          type="button"
          onClick={() => zoomBy(1)}
          aria-label="Zoom in"
          className="flex h-8 w-8 items-center justify-center hover:bg-muted"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(-1)}
          aria-label="Zoom out"
          className="flex h-8 w-8 items-center justify-center border-t border-border hover:bg-muted"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <p className="glass absolute bottom-0 right-0 rounded-tl-md px-1.5 py-0.5 text-[10px] text-muted-foreground">
        ©{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          OpenStreetMap
        </a>{" "}
        contributors
      </p>
    </div>
  );
}
