/**
 * Synthetic results for scans started inside fixture mode, so "New investigation"
 * and pivot scans visibly produce data. All values are invented and reserved.
 */
import type { Finding, FindingStatus, Job, JsonObject, JsonValue } from "../../types";
import { avatar } from "./demo-case";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const USERNAME_PLATFORMS: [string, string][] = [
  ["GitHub", "development"],
  ["Mastodon", "social"],
  ["Reddit", "social"],
  ["Dev.to", "blogging"],
  ["Lichess", "gaming"],
  ["Flickr", "photo"],
  ["Twitch", "video"],
  ["Keybase", "security"],
];

interface Draft {
  platform: string;
  status?: FindingStatus;
  url?: string | null;
  extra?: JsonObject;
  meta?: Record<string, JsonValue>;
}

function drafts(job: Job): Draft[] {
  const v = job.target_value;
  const seed = hash(`${job.module}:${v}`);
  const host = (platform: string) => platform.toLowerCase().replace(/[^a-z0-9]+/g, "");
  switch (job.module) {
    case "user_scanner":
      return USERNAME_PLATFORMS.map(([platform, category], i): Draft => {
        const found = (seed >> i) % 3 !== 0;
        const rich: JsonObject = {
          fullname: v,
          bio: "Synthetic demo profile.",
          avatar_url: avatar(v.slice(0, 2), seed % 360),
          created_at: `20${15 + (seed % 9)}-0${1 + (i % 9)}-12T10:00:00Z`,
        };
        return {
          platform,
          status: found ? "found" : "not_found",
          url: found ? `https://${host(platform)}.example/${v}` : null,
          extra: found && i < 2 ? rich : {},
          meta: { category },
        };
      });
    case "gravatar":
      return [
        {
          platform: "Gravatar",
          url: `https://gravatar.example/${seed.toString(16)}`,
          extra: { fullname: v.split("@")[0] ?? v, avatar_url: avatar("@", seed % 360) },
          meta: { category: "identity" },
        },
      ];
    case "xposedornot":
      return [
        {
          platform: "breach",
          url: "https://breaches.example/demoleak",
          meta: {
            category: "breach",
            breach_name: "DemoLeak",
            breach_date: "2020-02-20",
            data_classes: ["Email addresses", "Usernames"],
          },
        },
      ];
    case "email_registrations":
      return ["Duolingo", "Spotify", "Adobe"].map((platform, i): Draft => ({
        platform,
        status: (seed >> i) % 2 === 0 ? "found" : "not_found",
        meta: { category: "registration" },
      }));
    case "dns_records":
      return [
        {
          platform: "dns",
          url: `https://dns.example/query?name=${v}`,
          meta: {
            category: "dns",
            dns: {
              A: [`203.0.113.${1 + (seed % 250)}`],
              MX: [`10 mail.${v}`],
              NS: ["ns1.example.net", "ns2.example.net"],
            },
          },
        },
      ];
    case "crtsh":
      return ["www", "mail"].map((sub) => ({
        platform: "crt.sh",
        url: `https://crt.example/?q=${sub}.${v}`,
        extra: { common_name: `${sub}.${v}`, issuer: "Example Trust Services CA" },
        meta: { category: "certificate", subdomain: `${sub}.${v}` },
      }));
    case "rdap":
      return [
        {
          platform: "rdap",
          url: `https://rdap.example/${job.target_type}/${v}`,
          extra:
            job.target_type === "ip"
              ? { network: "203.0.113.0/24", org: "Example Hosting Ltd", asn: "AS64501" }
              : { registrar: "Example Registrar, Inc.", created_at: "2019-04-01T00:00:00Z" },
          meta: { category: job.target_type === "ip" ? "network" : "registration" },
        },
      ];
    case "internetdb":
      return [
        {
          platform: "internetdb",
          url: `https://internetdb.example/${v}`,
          meta: { category: "network", ports: seed % 2 ? [80, 443] : [22, 443, 8080], vulns: [] },
        },
      ];
    case "wayback":
      return [
        {
          platform: "wayback",
          url: `https://archive.example/web/*/${v}`,
          extra: { snapshots: 40 + (seed % 300), first_capture: "2016-05-09T00:00:00Z" },
          meta: { category: "archive" },
        },
      ];
    case "avatar_phash":
      return [
        {
          platform: "avatar",
          url: v,
          extra: { avatar_phash: seed.toString(16).padStart(16, "c3d4e1f0"), avatar_url: avatar("?", seed % 360) },
          meta: { category: "media" },
        },
      ];
    case "exif":
      return [
        {
          platform: "exif",
          url: v,
          extra: { camera: "ExampleCam X100", software: "DemoPhoto 4.2", gps: "removed" },
          meta: { category: "media" },
        },
      ];
    case "phone_meta":
      return [
        {
          platform: "phone",
          extra: { valid: true, country: "Fictionland", line_type: "mobile", carrier: "Example Mobile" },
          meta: { category: "telephony" },
        },
      ];
    default:
      return [
        {
          platform: job.module,
          url: `https://search.example/?q=${encodeURIComponent(v)}`,
          extra: { note: "Synthetic demo result." },
          meta: { category: "other" },
        },
      ];
  }
}

export function syntheticFindings(job: Job, now: number): Finding[] {
  return drafts(job).map((d, i) => ({
    id: `f2${hash(`${job.id}:${i}`).toString(16).padStart(6, "0")}-0000-4000-8000-${String(i).padStart(12, "0")}`,
    case_id: job.case_id,
    identifier_type: job.target_type,
    identifier_value: job.target_value,
    source_tool: job.module,
    module: job.module,
    platform: d.platform,
    status: d.status ?? "found",
    finding_key: `synthetic-${job.module}-${job.target_value}-${d.platform}-${i}`,
    extra_metadata: { url: d.url ?? null, extra: d.extra ?? {}, ...(d.meta ?? {}) },
    curated: false,
    job_id: job.id,
    collected_at: new Date(now).toISOString(),
  }));
}

const NOTES: Record<string, string[]> = {
  user_scanner: ["Resolving platform list", "Checking platforms", "Collecting profile fields"],
  avatar_phash: ["Downloading images", "Hashing avatars", "Comparing hashes"],
  wayback: ["Listing snapshots", "Reading capture index", "Summarising history"],
};

export function progressNote(module: string, progress: number): string {
  const notes = NOTES[module] ?? ["Starting", "Querying source", "Normalising results"];
  const index = Math.min(notes.length - 1, Math.floor((progress / 100) * notes.length));
  return notes[index] ?? "Working";
}
