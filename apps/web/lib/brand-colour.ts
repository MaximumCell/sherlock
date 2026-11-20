/**
 * Brand colours as a subtle accent that stays readable: a glyph colour per theme with at
 * least 3:1 contrast (WCAG non-text) against the card, so near-black brands (GitHub, X)
 * turn light on the dark theme and pale ones (Snapchat yellow) turn darker on the light one.
 * Also the deterministic neutral tint of monogram tiles. Pure.
 */

type Rgb = [number, number, number];

// The card colours of globals.css: light `0 0% 100%`, dark `228 12% 9.5%`.
export const CARD_LIGHT: Rgb = [255, 255, 255];
export const CARD_DARK: Rgb = [21, 23, 27];
export const MIN_CONTRAST = 3;

export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: Rgb) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** The brand colour moved toward black (light card) or white (dark card) until it reads. */
export function readableOn(brand: Rgb, card: Rgb): Rgb {
  const target: Rgb = luminance(card) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(brand, target, t);
    if (contrast(c, card) >= MIN_CONTRAST + 0.2) return c;
  }
  return target;
}

export interface BrandColours {
  /** Glyph colour on the light theme. */
  light: string;
  /** Glyph colour on the dark theme. */
  dark: string;
  /** The raw brand colour, for the faint tile tint. */
  tint: string;
}

/** Per-theme glyph colours for a simple-icons hex (without "#"); null for a bad value. */
export function brandColours(hex: string): BrandColours | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return {
    light: toHex(readableOn(rgb, CARD_LIGHT)),
    dark: toHex(readableOn(rgb, CARD_DARK)),
    tint: toHex(rgb),
  };
}

/** Stable small hash of a string (FNV-1a). */
export function hashString(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A muted hue for a monogram tile, the same for the same key on every render. */
export const monogramHue = (key: string): number => hashString(key) % 360;

// Monograms that read as the platform's own short form (no logo is drawn).
const MONOGRAMS: Record<string, string> = { linkedin: "in", xing: "X", vk: "VK" };

/** One or two letters for a monogram: "Hacker News" -> "HN", "pixelfed" -> "Pi", "" -> "?". */
export function monogram(label: string, key?: string): string {
  const fixed = key ? MONOGRAMS[key] : undefined;
  if (fixed) return fixed;
  const words = label
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const w = words[0] ?? "";
  if (!w) return "?";
  return w.length === 1 ? w.toUpperCase() : w[0]!.toUpperCase() + w[1]!.toLowerCase();
}

/** Initials of a person or display name for an avatar fallback: "Ada Fixture" -> "AF". */
export function initials(name: string): string {
  const words = name
    .replace(/^@/, "")
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}
