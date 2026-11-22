/**
 * Synthetic results for scans started inside fixture mode, so "New investigation"
 * and pivot scans visibly produce data. All values are invented and reserved.
 */
import type { Finding, FindingStatus, Job, JsonObject, JsonValue } from "../../types";
import { avatar, geoAvatar } from "./demo-case";
import { isUploadedPhoto } from "../../uploads";

/** What the fixture "upload" learnt about a photo chosen in the demo (the file itself stays in the browser). */
export interface FixturePhoto {
  size: number;
  mime: string;
  gps: boolean | null;
  sha256: string | null;
}

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

/** Results for a demo search on an uploaded photo: real size and location flag, invented matches. */
function photoDrafts(job: Job, photo: FixturePhoto | undefined, seed: number): Draft[] | null {
  switch (job.module) {
    case "image_meta":
      return [
        {
          platform: "image",
          url: null,
          extra: {
            avatar_phash: seed.toString(16).padStart(16, "a1b2c3d4"),
            ...(photo?.gps ? { note: "This photo contains location data" } : {}),
          },
          meta: {
            category: "media",
            format: (photo?.mime.split("/")[1] ?? "jpeg").toUpperCase(),
            content_type: photo?.mime ?? "image/jpeg",
            size_bytes: photo?.size ?? 0,
            ...(photo?.sha256 ? { sha256: photo.sha256 } : {}),
            gps_present: photo?.gps === true,
          },
        },
      ];
    case "reverse_image_links": {
      const signed = encodeURIComponent(`https://storage.example/object/sign/media/demo.jpg?token=demo-${seed % 9999}`);
      const engines = {
        google_lens: `https://lens.google.com/uploadbyurl?url=${signed}`,
        yandex: `https://yandex.com/images/search?rpt=imageview&url=${signed}`,
        tineye: `https://tineye.com/search?url=${signed}`,
        bing: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${signed}`,
      };
      return [
        {
          platform: "reverse-image-links",
          url: engines.google_lens,
          extra: {
            links: Object.values(engines).join(", "),
            note: "These links use a private link to your photo that stops working after an hour.",
          },
          meta: { engines, manual: true, expires_s: 3600 },
        },
      ];
    }
    case "reverse_image":
      return ["Example Gallery", "Fixture Blog", "Sample Forum"].map((source, i) => ({
        platform: "google-lens",
        url: `https://${source.toLowerCase().replace(/\s+/g, "-")}.example/post/${(seed >> i) % 900}`,
        meta: {
          title: `A copy of this picture on ${source}`,
          source,
          thumbnail: geoAvatar((seed + i * 70) % 360, (i % 3) as 0 | 1 | 2),
          position: i + 1,
        },
      }));
    default:
      return null;
  }
}

function drafts(job: Job, photo?: FixturePhoto): Draft[] {
  const v = job.target_value;
  const seed = hash(`${job.module}:${v}`);
  if (job.target_type === "image" && isUploadedPhoto(v)) {
    const own = photoDrafts(job, photo, seed);
    if (own) return own;
  }
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
            records: {
              A: [`203.0.113.${1 + (seed % 250)}`],
              MX: [`10 mail.${v}`],
              NS: ["ns1.example.net", "ns2.example.net"],
            },
            has_spf: seed % 2 === 0,
            has_dmarc: seed % 3 === 0,
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
          meta: {
            category: "network",
            ports: seed % 2 ? [80, 443] : [22, 443, 8080],
            hostnames: job.target_type === "domain" ? [v] : [],
            vulns: seed % 3 === 0 ? ["CVE-2099-0101"] : [],
          },
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
    case "reverse_image_links":
      return [
        {
          platform: "avatar",
          url: v,
          extra: { avatar_phash: seed.toString(16).padStart(16, "c3d4e1f0"), avatar_url: avatar("?", seed % 360) },
          meta: { category: "media" },
        },
      ];
    case "image_meta":
      return [
        {
          platform: "image",
          url: v,
          extra: { avatar_phash: seed.toString(16).padStart(16, "c3d4e1f0") },
          meta: {
            category: "media",
            format: "JPEG",
            width: 1200,
            height: 900,
            size_bytes: 180_000 + (seed % 90_000),
            exif: { camera_make: "ExampleCam", camera_model: "X100", software: "DemoPhoto 4.2" },
            gps_present: seed % 2 === 0,
          },
        },
      ];
    case "wallet":
      return [
        {
          platform: "wallet",
          url: `https://explorer.example/address/${v}`,
          meta: v.startsWith("0x")
            ? { category: "wallet", chain: "ethereum", address: v, balance_eth: "0.0", tx_count: seed % 40 }
            : {
                category: "wallet",
                chain: "bitcoin",
                address: v,
                balance_btc: "0.0012",
                tx_count: seed % 40,
                first_seen: "2021-04-02T00:00:00Z",
                last_seen: "2024-09-11T00:00:00Z",
              },
        },
      ];
    case "name_search":
      return ["GitHub", "Personal site"].map((platform, i) => ({
        platform,
        url: `https://${host(platform)}.example/${encodeURIComponent(v.toLowerCase().replace(/\s+/g, "-"))}`,
        extra: { fullname: v, bio: i === 0 ? "Synthetic demo profile." : "Synthetic personal page." },
        meta: { category: "identity" },
      }));
    case "linkedin_search":
      return [
        {
          platform: "linkedin",
          url: `https://linkedin.example/in/${encodeURIComponent(v.toLowerCase().replace(/\s+/g, "-"))}`,
          extra: {
            fullname: job.target_type === "name" ? v : "",
            headline: "Synthetic demo profile",
            snippet: "Synthetic demo profile · Location: Example City",
            location: "Example City",
            preview: { source: "search-snippet", fetched_at: new Date().toISOString(), title: `${v} | LinkedIn` },
          },
          meta: { category: "professional", result_kind: "profile" },
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
      if (job.module.startsWith("profile_")) {
        const platform = job.module.slice("profile_".length);
        const found = seed % 3 !== 0;
        return [
          {
            platform,
            status: found ? "found" : "not_found",
            url: found ? `https://${platform}.example/${v}` : null,
            extra: found ? { fullname: v, bio: "Synthetic demo profile." } : {},
            meta: { category: "social" },
          },
        ];
      }
      // other sources: a coverage row only, so a demo scan does not invent detail
      return [{ platform: job.module, status: "not_found", meta: { category: "other" } }];
  }
}

export function syntheticFindings(job: Job, now: number, photo?: FixturePhoto): Finding[] {
  return drafts(job, photo).map((d, i) => ({
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
