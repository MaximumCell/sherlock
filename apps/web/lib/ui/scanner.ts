/**
 * The scanner at the top of an investigation, as pure data: one tile per data-source run,
 * the counters, the "just found" ticker and the orbit layout. The component only draws it.
 */
import { groupOf, type FindingGroupId } from "../finding-groups";
import type { Finding, Job } from "../types";

export type TileState = "waiting" | "checking" | "found" | "empty" | "failed" | "stopped";

export interface ScanTile {
  id: string;
  module: string;
  target: string;
  state: TileState;
  /** Results this source reported as found (0 when unknown). */
  found: number;
  progress: number;
}

export interface TickerItem {
  id: string;
  platform: string;
  group: FindingGroupId;
  /** "profile found", "breach listing", … */
  what: string;
  at: string;
}

export interface ScannerState {
  tiles: ScanTile[];
  total: number;
  done: number;
  /** could not be checked: failed or stopped */
  failed: number;
  found: number;
  scanning: boolean;
  ticker: TickerItem[];
}

export function tileState(job: Pick<Job, "status" | "result">): TileState {
  switch (job.status) {
    case "queued":
      return "waiting";
    case "running":
      return "checking";
    case "failed":
      return "failed";
    case "cancelled":
      return "stopped";
    case "succeeded":
      return typeof job.result?.found === "number" && job.result.found > 0 ? "found" : "empty";
  }
}

const WHAT: Record<FindingGroupId, string> = {
  accounts: "account found",
  breaches: "breach listing",
  web: "website record",
  images: "image details",
  activity: "activity pattern",
  phone: "number details",
  wallet: "wallet activity",
  names: "page mentions the name",
  other: "result",
};

/** Order: what is happening now first, then what was found, then the rest. */
const RANK: Record<TileState, number> = {
  checking: 0,
  found: 1,
  empty: 2,
  failed: 3,
  stopped: 4,
  waiting: 5,
};

export function deriveScanner(
  jobs: readonly Job[],
  findings: readonly Finding[],
  tickerSize = 5,
): ScannerState {
  const tiles = jobs.map<ScanTile>((j) => ({
    id: j.id,
    module: j.module,
    target: j.target_value,
    state: tileState(j),
    found: typeof j.result?.found === "number" ? j.result.found : 0,
    progress: j.progress,
  }));
  // stable visual order: by creation, so tiles do not jump around while they light up
  const done = tiles.filter((t) => t.state !== "waiting" && t.state !== "checking").length;
  const failed = tiles.filter((t) => t.state === "failed" || t.state === "stopped").length;
  const ticker = findings
    .filter((f) => f.status === "found")
    .slice()
    .sort((a, b) => b.collected_at.localeCompare(a.collected_at))
    .slice(0, tickerSize)
    .map<TickerItem>((f) => {
      const group = groupOf(f);
      return { id: f.id, platform: f.platform, group, what: WHAT[group], at: f.collected_at };
    });
  return {
    tiles,
    total: tiles.length,
    done,
    failed,
    found: tiles.reduce((n, t) => n + t.found, 0),
    scanning: tiles.some((t) => t.state === "waiting" || t.state === "checking"),
    ticker,
  };
}

/** Tiles sorted for the list view (the orbit keeps creation order). */
export function rankTiles(tiles: readonly ScanTile[]): ScanTile[] {
  return [...tiles].sort((a, b) => RANK[a.state] - RANK[b.state]);
}

/**
 * Positions on one or two rings around the target, in -1..1 units. The inner ring holds up
 * to `inner` tiles; the rest go on the outer ring, offset by half a step so they interleave.
 */
export function orbitLayout(n: number, inner = 12): { x: number; y: number; ring: 0 | 1 }[] {
  const out: { x: number; y: number; ring: 0 | 1 }[] = [];
  const innerCount = n <= inner + 4 ? n : inner;
  const outerCount = n - innerCount;
  const place = (count: number, radius: number, ring: 0 | 1, offset: number) => {
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + ((i + offset) / count) * Math.PI * 2;
      out.push({ x: Math.cos(a) * radius, y: Math.sin(a) * radius, ring });
    }
  };
  place(innerCount, outerCount > 0 ? 0.62 : 0.86, 0, 0);
  place(outerCount, 0.96, 1, 0.5);
  return out;
}

/**
 * The demo replays its scan: at progress `t` (0..1) only the first share of finished tiles
 * shows its result; the others are still "checking". Live tiles are left as they are.
 */
export function replayTiles(tiles: readonly ScanTile[], t: number): ScanTile[] {
  const finished = tiles.filter((x) => x.state !== "waiting" && x.state !== "checking");
  const shown = Math.floor(Math.min(1, Math.max(0, t)) * finished.length);
  const revealed = new Set(finished.slice(0, shown).map((x) => x.id));
  return tiles.map((x) =>
    x.state === "waiting" || x.state === "checking" || revealed.has(x.id)
      ? x
      : { ...x, state: "checking", found: 0, progress: Math.round(t * 100) },
  );
}

/** Counters for a set of (possibly replayed) tiles. */
export function tileCounts(tiles: readonly ScanTile[]): { done: number; found: number; failed: number } {
  let done = 0;
  let found = 0;
  let failed = 0;
  for (const t of tiles) {
    if (t.state !== "waiting" && t.state !== "checking") done++;
    if (t.state === "failed" || t.state === "stopped") failed++;
    found += t.found;
  }
  return { done, found, failed };
}
