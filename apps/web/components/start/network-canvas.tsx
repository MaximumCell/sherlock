"use client";

import { useEffect, useRef } from "react";
import { useOnScreen, usePageVisible, usePrefersReducedMotion } from "@/components/motion/hooks";
import {
  createNetwork,
  networkEdges,
  nodeCountFor,
  parallaxOffset,
  seededRandom,
  stepNetwork,
  type NetNode,
} from "@/lib/ui/network";

const FRAME_MS = 1000 / 40; // capped at 40 fps: smooth drift, half the work of 80+ Hz screens
const LINK = 170;

interface Palette {
  node: string;
  edge: string;
  accent: string;
}

function readPalette(el: Element): Palette {
  const css = getComputedStyle(el);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    node: `hsl(${v("--foreground")} / ALPHA)`,
    edge: `hsl(${v("--muted-foreground")} / ALPHA)`,
    accent: `hsl(${v("--accent")} / ALPHA)`,
  };
}

const withAlpha = (colour: string, a: number) => colour.replace("ALPHA", a.toFixed(3));

function lowPowerDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

function draw(
  ctx: CanvasRenderingContext2D,
  nodes: readonly NetNode[],
  palette: Palette,
  pointer: { x: number; y: number },
  w: number,
  h: number,
) {
  ctx.clearRect(0, 0, w, h);
  const pos = nodes.map((n) => {
    const o = parallaxOffset(n.z, pointer);
    return { x: n.x + o.dx, y: n.y + o.dy };
  });
  ctx.lineWidth = 1;
  for (const e of networkEdges(nodes, LINK)) {
    const a = pos[e.a]!;
    const b = pos[e.b]!;
    const depth = (nodes[e.a]!.z + nodes[e.b]!.z) / 2;
    ctx.strokeStyle = withAlpha(palette.edge, e.alpha * 0.42 * depth);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  nodes.forEach((n, i) => {
    const p = pos[i]!;
    const r = 1 + n.z * 1.6;
    if (n.pulse >= 0) {
      ctx.strokeStyle = withAlpha(palette.accent, (1 - n.pulse) * 0.5);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + n.pulse * 18, 0, Math.PI * 2);
      ctx.stroke();
    }
    const lit = n.pulse >= 0;
    ctx.fillStyle = lit
      ? withAlpha(palette.accent, 0.9)
      : withAlpha(palette.node, 0.25 + n.z * 0.5);
    ctx.beginPath();
    ctx.arc(p.x, p.y, lit ? r + 0.6 : r, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * The hero's living network: a hand-written 2D canvas, seeded so it looks the same on every
 * visit. DPR-aware, capped at 40 fps, paused off-screen or in a hidden tab, fewer nodes on
 * phones and low-power devices, one still frame for reduced motion. `converge` pulls every
 * node towards the search box (the launch moment).
 */
export function NetworkCanvas({
  converge = false,
  focus,
}: {
  converge?: boolean;
  /** Where to converge, as a share of the canvas (0..1). */
  focus?: { x: number; y: number };
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduce = usePrefersReducedMotion();
  const visible = usePageVisible();
  const onScreen = useOnScreen(ref);
  const convergeRef = useRef(converge);
  const focusRef = useRef(focus);
  // nodes survive pauses (off-screen, hidden tab) so the network resumes where it was
  const nodesRef = useRef<NetNode[]>([]);
  useEffect(() => {
    convergeRef.current = converge;
    focusRef.current = focus;
  });

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let w = 0;
    let h = 0;
    let nodes: NetNode[] = nodesRef.current;
    const rand = seededRandom(11);
    let palette = readPalette(document.documentElement);
    const pointer = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = nodeCountFor(w, lowPowerDevice());
      if (nodes.length !== count) nodes = nodesRef.current = createNetwork(count, w, h);
      draw(ctx, nodes, palette, pointer, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const themeWatch = new MutationObserver(() => {
      palette = readPalette(document.documentElement);
      draw(ctx, nodes, palette, pointer, w, h);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    const running = !reduce && visible && onScreen;
    let frame = 0;
    let last = performance.now();
    let acc = 0;
    const onPointer = (event: PointerEvent) => {
      target.x = (event.clientX / window.innerWidth) * 2 - 1;
      target.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      acc += now - last;
      last = now;
      if (acc < FRAME_MS) return;
      const dt = acc / 1000;
      acc = 0;
      pointer.x += (target.x - pointer.x) * 0.06;
      pointer.y += (target.y - pointer.y) * 0.06;
      const f = focusRef.current;
      const attract = convergeRef.current && f ? { x: f.x * w, y: f.y * h } : null;
      stepNetwork(nodes, dt, w, h, rand, attract);
      draw(ctx, nodes, palette, pointer, w, h);
    };
    if (running) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      frame = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      ro.disconnect();
      themeWatch.disconnect();
    };
  }, [reduce, visible, onScreen]);

  return <canvas ref={ref} aria-hidden className="absolute inset-0 h-full w-full" />;
}
