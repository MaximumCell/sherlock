/**
 * Parsers for the module-specific shapes inside `extra_metadata` (see the modules in
 * `packages/core/sherlock_core/modules`). Every parser returns null when the shape is
 * absent, so unknown modules fall through to the generic key/value view.
 */
import type { JsonObject, JsonValue } from "./types";

const isObj = (v: JsonValue | undefined): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: JsonValue | undefined): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
const numOrNull = (v: JsonValue | undefined): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const strings = (v: JsonValue | undefined): string[] =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === "string" ? x.trim() : typeof x === "number" ? String(x) : "")).filter(Boolean)
    : typeof v === "string"
      ? v.split(",").map((x) => x.trim()).filter(Boolean)
      : [];
const nums = (v: JsonValue | undefined): number[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "number" && x > 0 ? x : 0)) : [];

export interface NetworkInfo {
  ports: number[];
  vulns: string[];
  hostnames: string[];
  cpes: string[];
  tags: string[];
}

export function parseNetwork(meta: JsonObject, extra: JsonObject): NetworkInfo | null {
  const ports = (Array.isArray(meta.ports) ? meta.ports : [])
    .map((p) => numOrNull(p))
    .filter((p): p is number => p !== null)
    .sort((a, b) => a - b);
  const vulns = strings(meta.vulns);
  const hostnames = strings(meta.hostnames ?? extra.hostnames);
  const cpes = strings(meta.cpes);
  const tags = strings(meta.tags);
  if (!ports.length && !vulns.length && !cpes.length && !("ports" in meta)) return null;
  return { ports, vulns, hostnames, cpes, tags };
}

export interface DnsInfo {
  records: Record<string, string[]>;
  spf: boolean | null;
  dmarc: boolean | null;
  spfRecord: string | null;
  dmarcRecord: string | null;
}

export function parseDns(meta: JsonObject): DnsInfo | null {
  const source = isObj(meta.records) ? meta.records : isObj(meta.dns) ? meta.dns : null;
  if (!source) return null;
  const records: Record<string, string[]> = {};
  for (const [type, values] of Object.entries(source)) {
    const list = strings(values);
    if (list.length) records[type.toUpperCase()] = list;
  }
  const txt = records.TXT ?? [];
  const spf = typeof meta.has_spf === "boolean" ? meta.has_spf : txt.length ? txt.some((t) => /^v=spf1/i.test(t)) : null;
  return {
    records,
    spf,
    dmarc: typeof meta.has_dmarc === "boolean" ? meta.has_dmarc : null,
    spfRecord: text(meta.spf_record),
    dmarcRecord: text(meta.dmarc_record),
  };
}

export interface WalletInfo {
  chain: string;
  address: string | null;
  balance: string | null;
  unit: string;
  received: string | null;
  txCount: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  isContract: boolean | null;
  ens: string | null;
  note: string | null;
}

export function parseWallet(meta: JsonObject, extra: JsonObject): WalletInfo | null {
  const chain = text(meta.chain);
  if (!chain) return null;
  const eth = /eth|evm/i.test(chain);
  return {
    chain,
    address: text(meta.address),
    balance: text(eth ? meta.balance_eth : meta.balance_btc) ?? text(meta.balance),
    unit: eth ? "ETH" : /bitcoin|btc/i.test(chain) ? "BTC" : chain.toUpperCase(),
    received: text(meta.total_received_btc),
    txCount: numOrNull(meta.tx_count),
    firstSeen: text(meta.first_seen),
    lastSeen: text(meta.last_seen),
    isContract: typeof meta.is_contract === "boolean" ? meta.is_contract : null,
    ens: text(extra.ens),
    note: text(meta.note),
  };
}

export interface ImageInfo {
  format: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  contentType: string | null;
  sha256: string | null;
  phash: string | null;
  camera: string | null;
  software: string | null;
  takenAt: string | null;
  gpsPresent: boolean | null;
}

export function parseImage(meta: JsonObject, extra: JsonObject): ImageInfo | null {
  const exif = isObj(meta.exif) ? meta.exif : {};
  const width = numOrNull(meta.width);
  const sha256 = text(meta.sha256);
  const legacyCamera = text(extra.camera);
  if (width === null && !sha256 && !legacyCamera && !Object.keys(exif).length) return null;
  const make = text(exif.camera_make);
  const model = text(exif.camera_model);
  const dims = text(extra.dimensions)?.split("x").map(Number);
  return {
    format: text(meta.format),
    width: width ?? (dims?.[0] && Number.isFinite(dims[0]) ? dims[0] : null),
    height: numOrNull(meta.height) ?? (dims?.[1] && Number.isFinite(dims[1]) ? dims[1] : null),
    sizeBytes: numOrNull(meta.size_bytes),
    contentType: text(meta.content_type),
    sha256,
    phash: text(extra.avatar_phash),
    camera: [make, model].filter(Boolean).join(" ") || legacyCamera,
    software: text(exif.software) ?? text(extra.software),
    takenAt: text(exif.datetime) ?? text(extra.taken_at),
    gpsPresent:
      typeof meta.gps_present === "boolean"
        ? meta.gps_present
        : typeof exif.gps_present === "boolean"
          ? exif.gps_present
          : null,
  };
}

export interface ActivityInfo {
  /** 7 x 24 (Mon first), when the source gives a full matrix. */
  matrix: number[][] | null;
  hours: number[] | null; // 24
  weekdays: number[] | null; // 7, Mon first
  sampleSize: number | null;
  first: string | null;
  last: string | null;
  offsetLabel: string | null;
  confidence: string | null;
  sources: string[];
}

function toMatrix(v: JsonValue | undefined): number[][] | null {
  const raw = isObj(v) ? v.weekday_hour : v;
  if (!Array.isArray(raw) || raw.length !== 7) return null;
  const rows = raw.map((row) => nums(row));
  return rows.every((r) => r.length === 24) ? rows : null;
}

export function parseActivity(meta: JsonObject): ActivityInfo | null {
  const a = meta.activity;
  if (a === undefined || a === null) return null;
  const matrix = toMatrix(a);
  const obj = isObj(a) ? a : {};
  const hours = nums(obj.hours_utc);
  const weekdays = nums(obj.weekdays);
  if (!matrix && hours.length !== 24 && weekdays.length !== 7) return null;
  const rowsFromMatrix = matrix?.map((r) => r.reduce((s, x) => s + x, 0)) ?? null;
  return {
    matrix,
    hours: hours.length === 24 ? hours : matrix ? Array.from({ length: 24 }, (_, h) => matrix.reduce((s, r) => s + (r[h] ?? 0), 0)) : null,
    weekdays: weekdays.length === 7 ? weekdays : rowsFromMatrix,
    sampleSize: numOrNull(obj.sample_size),
    first: text(obj.first),
    last: text(obj.last),
    offsetLabel: text(meta.utc_offset_label),
    confidence: text(meta.confidence),
    sources: strings(meta.sources),
  };
}

/** Keys the dedicated renderers own; everything else lands in the generic view. */
export const STRUCTURED_META = new Set([
  "ip", "ports", "vulns", "hostnames", "cpes", "tags",
  "records", "dns", "has_spf", "has_dmarc", "spf_record", "dmarc_record",
  "chain", "address", "balance_btc", "balance_eth", "balance_sats", "balance_wei", "balance",
  "total_received_btc", "tx_count", "first_seen", "last_seen", "is_contract", "note",
  "format", "width", "height", "size_bytes", "content_type", "sha256", "exif", "gps_present", "mode",
  "activity", "utc_offset_label", "utc_offset_estimate", "confidence", "sources",
  "quiet_window_utc", "quiet_window_share",
]);
export const STRUCTURED_EXTRA = new Set(["ens", "avatar_phash", "camera", "software", "taken_at", "dimensions", "hostnames"]);

/** Flatten nested objects one level into readable key/value pairs. */
export function flattenEntries(prefix: string, value: JsonValue | undefined, out: [string, string][]): void {
  if (value === null || value === undefined || value === "") return;
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      const key = prefix ? `${prefix} · ${k.replace(/_/g, " ")}` : k.replace(/_/g, " ");
      if (isObj(v)) out.push([key, JSON.stringify(v)]);
      else flattenEntries(key, v, out);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (!value.length) return;
    out.push([prefix, value.map((x) => (isObj(x) || Array.isArray(x) ? JSON.stringify(x) : String(x))).join(", ")]);
    return;
  }
  out.push([prefix, String(value)]);
}
