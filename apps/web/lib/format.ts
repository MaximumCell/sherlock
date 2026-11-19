/** Format a past ISO timestamp as a friendly "time ago" label.
 * Server-side helper: call from server components and pass the result as a
 * prop to client components. Computing it inside a client component would
 * call Date.now() on both server and client and produce hydration mismatches
 * (e.g. "12h ago" on server, "13h ago" on client when the hour boundary
 * falls between the two). */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
