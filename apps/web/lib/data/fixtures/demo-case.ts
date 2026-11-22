/**
 * The bundled demo investigation. Everything here is FICTIONAL: the handle
 * "ada-fixture", reserved example domains, RFC 5737 addresses, a documentation ASN.
 * Platform names are used as labels only; every URL points at a reserved .example host.
 */
import type { Finding, FindingStatus, JsonObject, JsonValue } from "../../types";

export const DEMO_CASE_ID = "c0ffee00-0000-4000-8000-000000000001";
export const HANDLE = "ada-fixture";
export const EMAIL = "ada.fixture@example.com";
export const DOMAIN = "ada-fixture.example";
export const IP = "192.0.2.44";
export const ALT_HANDLE = "ada_fixture";
export const IMAGE_URL = "https://ada-fixture.example/me.jpg";

export const fid = (n: number): string => `f1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Inline SVG avatar so the demo never loads a remote image. */
export function avatar(initials: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 45% 32%)"/><circle cx="48" cy="14" r="20" fill="hsl(${hue} 60% 48%)" opacity=".55"/><text x="32" y="41" font-family="monospace" font-size="24" font-weight="700" text-anchor="middle" fill="#fff">${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Abstract geometric avatar (no initials), also inline: the demo shows no real people. */
export function geoAvatar(hue: number, variant: 0 | 1 | 2): string {
  const shapes = [
    `<circle cx="22" cy="24" r="16" fill="hsl(${hue + 40} 70% 62%)"/><rect x="30" y="30" width="26" height="26" rx="6" fill="hsl(${hue - 30} 65% 55%)" opacity=".85"/>`,
    `<path d="M0 64 L32 14 L64 64Z" fill="hsl(${hue + 30} 65% 60%)"/><circle cx="46" cy="18" r="9" fill="hsl(${hue - 40} 80% 70%)"/>`,
    `<rect x="8" y="8" width="22" height="22" rx="4" fill="hsl(${hue + 50} 60% 64%)"/><rect x="34" y="8" width="22" height="22" rx="11" fill="hsl(${hue} 60% 70%)"/><rect x="8" y="34" width="48" height="22" rx="4" fill="hsl(${hue - 50} 55% 58%)"/>`,
  ];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue} 40% 26%)"/>${shapes[variant]}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const AVATAR_A = avatar("AF", 212);
const AVATAR_B = avatar("af", 160);
const AVATAR_C = geoAvatar(268, 0);
const AVATAR_D = geoAvatar(18, 1);
const AVATAR_E = geoAvatar(140, 2);
/** A picture that fails to load, like a host that refuses hot-linking: initials take over. */
const BROKEN_AVATAR = "data:image/png;base64,AAAA";

const pagePreview = (title: string, site: string, minutesAgo: number): JsonObject => ({
  source: "page-meta",
  fetched_at: new Date(Date.UTC(2026, 10, 20, 9, 0) - minutesAgo * 60_000).toISOString(),
  url: `https://${site.toLowerCase()}.example/${HANDLE}`,
  title,
  site_name: site,
});

/** Deterministic 7x24 activity matrix (weekday x hour, UTC): evenings and weekends. */
export function activityMatrix(seed: number): number[][] {
  return Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      const evening = hour >= 18 && hour <= 23 ? 5 : hour >= 9 && hour <= 12 ? 2 : 0;
      const weekend = day >= 5 && hour >= 10 && hour <= 22 ? 3 : 0;
      const noise = (seed * 31 + day * 17 + hour * 7) % 4;
      const quiet = hour >= 1 && hour <= 6;
      return quiet ? 0 : Math.max(0, evening + weekend + noise - 1);
    }),
  );
}

interface Spec {
  n: number;
  platform: string;
  module: string;
  idType: string;
  idValue: string;
  status?: FindingStatus;
  url?: string | null;
  extra?: JsonObject;
  meta?: Record<string, JsonValue>;
  curated?: boolean;
  minutesAgo: number;
}

export function buildFinding(caseId: string, now: number, s: Spec): Finding {
  return {
    id: fid(s.n),
    case_id: caseId,
    identifier_type: s.idType,
    identifier_value: s.idValue,
    source_tool: s.module,
    module: s.module,
    platform: s.platform,
    status: s.status ?? "found",
    finding_key: `fixture-${s.n.toString(16).padStart(4, "0")}`,
    extra_metadata: { url: s.url ?? null, extra: s.extra ?? {}, ...(s.meta ?? {}) },
    curated: s.curated ?? false,
    job_id: null,
    collected_at: new Date(now - s.minutesAgo * 60_000).toISOString(),
  };
}

const slug = (platform: string) => platform.toLowerCase().replace(/[^a-z0-9]+/g, "");
const profileUrl = (platform: string, handle: string) =>
  `https://${slug(platform)}.example/${handle}`;

type Account = [platform: string, category: string, extra?: JsonObject, curated?: boolean];

const ACCOUNTS: Account[] = [
  [
    "GitHub",
    "development",
    {
      fullname: "Ada Fixture",
      bio: "Backend engineer. Fictional person used for demos. Rust, Postgres, tea.",
      location: "Example City",
      email: EMAIL,
      links: `https://${DOMAIN}, https://social.example/@ada`,
      avatar_url: AVATAR_A,
      created_at: "2016-03-14T09:12:00Z",
      followers: 128,
      following: 64,
      public_repos: 41,
    },
    true,
  ],
  [
    "GitLab",
    "development",
    {
      fullname: "Ada Fixture",
      bio: "Mirror of my GitHub projects.",
      links: `https://${DOMAIN}`,
      avatar_url: AVATAR_A,
      created_at: "2018-07-02T18:40:00Z",
    },
    true,
  ],
  [
    "Mastodon",
    "social",
    {
      fullname: "ada (fixture)",
      bio: "Backend engineer. Fictional person used for demos. Posts about databases.",
      links: `https://${DOMAIN}, https://github.example/${HANDLE}`,
      avatar_url: AVATAR_A,
      created_at: "2019-11-20T21:05:00Z",
      followers: 412,
      following: 233,
    },
    true,
  ],
  [
    "Keybase",
    "security",
    {
      fullname: "Ada Fixture",
      bio: "Proofs for my accounts.",
      links: `https://${DOMAIN}, https://github.example/afixture`,
      wallet: "0x52908400098527886E0F7030069857D2E4169EE7",
      created_at: "2017-01-09T12:00:00Z",
    },
    true,
  ],
  [
    "npm",
    "development",
    {
      fullname: "ada-fixture",
      email: "ada@fixture-labs.example",
      links: "https://fixture-labs.example",
      packages: 7,
      created_at: "2017-05-23T10:31:00Z",
    },
  ],
  [
    "Reddit",
    "social",
    { bio: "lurker", created_at: "2017-09-01T07:45:00Z", karma: 2314, avatar_url: AVATAR_B },
  ],
  ["Hacker News", "development", { created_at: "2015-12-04T16:20:00Z", karma: 903 }],
  [
    "Stack Overflow",
    "development",
    {
      fullname: "Ada F.",
      location: "Example City",
      reputation: 5421,
      created_at: "2016-06-18T11:00:00Z",
    },
  ],
  ["Docker Hub", "development", { fullname: "Ada Fixture", created_at: "2018-02-11T13:14:00Z" }],
  ["PyPI", "development", { fullname: "Ada Fixture", email: EMAIL }],
  [
    "Dev.to",
    "blogging",
    {
      fullname: "Ada Fixture",
      bio: "Writing about queues, retries and other ways things fail.",
      links: `https://${DOMAIN}/blog`,
      created_at: "2020-01-15T08:00:00Z",
    },
  ],
  [
    "Medium",
    "blogging",
    {
      fullname: "Ada Fixture",
      bio: "Writing about queues, retries and other ways things fail.",
      followers: 86,
      avatar_url: AVATAR_D,
      preview: pagePreview("Ada Fixture – Medium", "Medium", 30),
    },
  ],
  ["Kaggle", "development", { fullname: "Ada Fixture", location: "Example City" }],
  ["Codeberg", "development", { created_at: "2022-04-03T19:22:00Z", avatar_url: BROKEN_AVATAR }],
  [
    "Bluesky",
    "social",
    {
      fullname: "ada",
      bio: "moved from the bird site. Databases, trains, film photography.",
      followers: 57,
      avatar_url: AVATAR_C,
      links: `https://${DOMAIN}, https://github.example/${HANDLE}`,
      preview: pagePreview("ada (@ada-fixture.bsky.social) — Bluesky", "Bluesky", 32),
    },
  ],
  ["Telegram", "messaging", { fullname: "Ada F" }],
  ["Twitch", "video", { created_at: "2019-03-30T22:10:00Z", followers: 12, avatar_url: AVATAR_B }],
  ["Steam", "gaming", { fullname: "adafx", location: "Example City", avatar_url: AVATAR_B }],
  ["Lichess", "gaming", { created_at: "2018-10-10T20:00:00Z", rating_blitz: 1684 }],
  ["Chess.com", "gaming", { created_at: "2021-02-01T20:30:00Z" }],
  [
    "Spotify",
    "music",
    { fullname: "ada", avatar_url: AVATAR_E, preview: pagePreview("ada | Spotify", "Spotify", 31) },
  ],
  ["Last.fm", "music", { created_at: "2014-08-19T17:00:00Z", scrobbles: 48210 }],
  ["SoundCloud", "music", {}],
  ["Flickr", "photo", { fullname: "Ada Fixture", location: "Example City" }],
  ["Pastebin", "other", { created_at: "2016-11-11T03:33:00Z" }],
];

const NOT_FOUND = ["Pinterest", "Snapchat", "LinkedIn", "Vimeo", "Patreon", "Tumblr"];

function accountSpecs(): Spec[] {
  const specs: Spec[] = ACCOUNTS.map(([platform, category, extra, curated], i) => ({
    n: i + 1,
    platform,
    module: "user_scanner",
    idType: "username",
    idValue: HANDLE,
    url: profileUrl(platform, HANDLE),
    extra,
    meta: {
      category,
      ...(platform === "GitHub"
        ? { activity: { timezone: "UTC", weekday_hour: activityMatrix(3) } }
        : {}),
    },
    curated,
    minutesAgo: 190 - i,
  }));
  NOT_FOUND.forEach((platform, i) =>
    specs.push({
      n: 40 + i,
      platform,
      module: "user_scanner",
      idType: "username",
      idValue: HANDLE,
      status: "not_found",
      meta: { category: "social" },
      minutesAgo: 160 - i,
    }),
  );
  specs.push(
    {
      n: 48,
      platform: "Facebook",
      module: "user_scanner",
      idType: "username",
      idValue: HANDLE,
      status: "error",
      url: `https://www.facebook.com/${HANDLE}`,
      meta: { category: "social", reason: "blocked", unknown: true, detail: "timeout after 15 s" },
      minutesAgo: 150,
    },
    {
      n: 49,
      platform: "X",
      module: "user_scanner",
      idType: "username",
      idValue: HANDLE,
      status: "error",
      url: `https://x.com/${HANDLE}`,
      meta: {
        category: "social",
        reason: "rate_limited",
        unknown: true,
        detail: "HTTP 429: rate limited by the platform",
      },
      minutesAgo: 150,
    },
    // could not be checked: the platform shows every logged-out visitor the same page
    {
      n: 53,
      platform: "Instagram",
      module: "whatsmyname",
      idType: "username",
      idValue: HANDLE,
      status: "error",
      url: `https://www.instagram.com/${HANDLE}/`,
      meta: {
        category: "social",
        reason: "login_wall",
        unknown: true,
        detail: "Instagram only shows profiles to signed-in users",
      },
      minutesAgo: 150,
    },
    {
      n: 54,
      platform: "TikTok",
      module: "user_scanner",
      idType: "username",
      idValue: HANDLE,
      status: "error",
      url: `https://www.tiktok.com/@${HANDLE}`,
      meta: {
        category: "social",
        reason: "ambiguous",
        unknown: true,
        detail: "No public account (a private one looks the same)",
      },
      minutesAgo: 150,
    },
  );
  [
    ["Pixelfed", "photo", { fullname: "ada", bio: "film photos", avatar_url: AVATAR_B }],
    ["Replit", "development", { fullname: "Ada Fixture", created_at: "2021-09-09T09:09:00Z" }],
    ["Gitea", "development", {}],
  ].forEach(([platform, category, extra], i) =>
    specs.push({
      n: 50 + i,
      platform: platform as string,
      module: "user_scanner",
      idType: "username",
      idValue: ALT_HANDLE,
      url: profileUrl(platform as string, ALT_HANDLE),
      extra: extra as JsonObject,
      meta: { category: category as string },
      minutesAgo: 95 - i,
    }),
  );
  return specs;
}

function emailSpecs(): Spec[] {
  const breach = (
    n: number,
    name: string,
    date: string,
    classes: string[],
    records: number,
  ): Spec => ({
    n,
    platform: "breach",
    module: "xposedornot",
    idType: "email",
    idValue: EMAIL,
    url: `https://breaches.example/${slug(name)}`,
    extra: { industry: "Fictional", records },
    meta: { breach_name: name, breach_date: date, data_classes: classes, category: "breach" },
    curated: n === 62,
    minutesAgo: 170,
  });
  const reg = (n: number, platform: string, status: FindingStatus): Spec => ({
    n,
    platform,
    module: "email_registrations",
    idType: "email",
    idValue: EMAIL,
    status,
    url: status === "found" ? `https://${slug(platform)}.example/` : null,
    extra: status === "found" ? { registered: true } : {},
    meta: { category: "registration" },
    minutesAgo: 168,
  });
  return [
    {
      n: 60,
      platform: "Gravatar",
      module: "gravatar",
      idType: "email",
      idValue: EMAIL,
      url: "https://gravatar.example/adafixture",
      extra: {
        fullname: "Ada Fixture",
        bio: "Backend engineer.",
        location: "Example City",
        links: `https://${DOMAIN}`,
        avatar_url: AVATAR_A,
      },
      meta: { category: "identity" },
      curated: true,
      minutesAgo: 172,
    },
    breach(
      61,
      "ExampleForum",
      "2019-06-02",
      ["Email addresses", "Usernames", "Password hashes"],
      1_204_000,
    ),
    breach(
      62,
      "SampleShop",
      "2021-10-17",
      ["Email addresses", "Names", "Phone numbers", "Order history"],
      388_500,
    ),
    breach(63, "DemoCloud", "2023-03-28", ["Email addresses", "IP addresses"], 52_300),
    reg(64, "Duolingo", "found"),
    reg(65, "Spotify", "found"),
    reg(66, "Adobe", "not_found"),
    reg(67, "Evernote", "not_found"),
  ];
}

function infraSpecs(): Spec[] {
  const cert = (n: number, host: string, notBefore: string): Spec => ({
    n,
    platform: "crt.sh",
    module: "crtsh",
    idType: "domain",
    idValue: DOMAIN,
    url: `https://crt.example/?q=${host}`,
    extra: { common_name: host, issuer: "Example Trust Services CA", not_before: notBefore },
    meta: { category: "certificate", subdomain: host },
    minutesAgo: 140,
  });
  return [
    {
      n: 70,
      platform: "dns",
      module: "dns_records",
      idType: "domain",
      idValue: DOMAIN,
      url: `https://dns.example/query?name=${DOMAIN}`,
      extra: {},
      meta: {
        category: "dns",
        records: {
          A: [IP],
          AAAA: ["2001:db8::44"],
          MX: [`10 mail.${DOMAIN}`],
          NS: ["ns1.example.net", "ns2.example.net"],
          TXT: ["v=spf1 include:_spf.example.net ~all"],
        },
        has_spf: true,
        has_dmarc: false,
        spf_record: "v=spf1 include:_spf.example.net ~all",
      },
      curated: true,
      minutesAgo: 142,
    },
    cert(71, `www.${DOMAIN}`, "2024-11-02"),
    cert(72, `blog.${DOMAIN}`, "2024-11-02"),
    cert(73, `git.${DOMAIN}`, "2023-05-19"),
    {
      n: 74,
      platform: "rdap",
      module: "rdap",
      idType: "domain",
      idValue: DOMAIN,
      url: `https://rdap.example/domain/${DOMAIN}`,
      extra: {
        registrar: "Example Registrar, Inc.",
        created_at: "2015-11-02T00:00:00Z",
        expires_at: "2026-11-02T00:00:00Z",
        registrant: "REDACTED FOR PRIVACY",
        nameservers: "ns1.example.net, ns2.example.net",
      },
      meta: { category: "registration" },
      minutesAgo: 139,
    },
    {
      n: 75,
      platform: "internetdb",
      module: "internetdb",
      idType: "ip",
      idValue: IP,
      url: `https://internetdb.example/${IP}`,
      extra: { hostnames: `${DOMAIN}, git.${DOMAIN}` },
      meta: {
        category: "network",
        ip: IP,
        ports: [22, 80, 443, 3000],
        hostnames: [DOMAIN, `git.${DOMAIN}`],
        cpes: ["cpe:/a:example:gitforge:1.19", "cpe:/a:openbsd:openssh:8.9"],
        tags: ["self-hosted"],
        vulns: ["CVE-2099-0001", "CVE-2099-0002"],
      },
      minutesAgo: 60,
    },
    {
      n: 76,
      platform: "rdap",
      module: "rdap",
      idType: "ip",
      idValue: IP,
      url: `https://rdap.example/ip/${IP}`,
      extra: { network: "192.0.2.0/24", org: "Example Hosting Ltd", asn: "AS64500", country: "ZZ" },
      meta: { category: "network" },
      minutesAgo: 59,
    },
  ];
}

function mediaSpecs(): Spec[] {
  const hash = (n: number, source: string, phash: string): Spec => ({
    n,
    platform: "avatar",
    module: "avatar_phash",
    idType: "image",
    idValue: `https://${slug(source)}.example/avatars/${HANDLE}.png`,
    url: `https://${slug(source)}.example/avatars/${HANDLE}.png`,
    extra: { avatar_url: AVATAR_A, avatar_phash: phash, source_platform: source },
    meta: { category: "media" },
    minutesAgo: 30,
  });
  return [
    hash(80, "GitHub", "c3d4e1f0a9b87766"),
    hash(81, "Mastodon", "c3d4e1f0a9b87764"),
    {
      n: 82,
      platform: "image",
      module: "image_meta",
      idType: "image",
      idValue: IMAGE_URL,
      url: IMAGE_URL,
      extra: { avatar_phash: "c3d4e1f0a9b87766" },
      meta: {
        category: "media",
        format: "JPEG",
        width: 2048,
        height: 2048,
        mode: "RGB",
        content_type: "image/jpeg",
        size_bytes: 412_877,
        sha256: "9f2c4e1d0b7a65f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9",
        exif: {
          camera_make: "ExampleCam",
          camera_model: "X100",
          software: "DemoPhoto 4.2",
          datetime: "2022:08:14 15:02:11",
          gps_present: true,
        },
        gps_present: true,
      },
      minutesAgo: 28,
    },
    {
      n: 83,
      platform: "wallet",
      module: "wallet",
      idType: "wallet",
      idValue: "0x52908400098527886E0F7030069857D2E4169EE7",
      url: "https://explorer.example/address/0x52908400098527886E0F7030069857D2E4169EE7",
      extra: { ens: "adafixture.eth" },
      meta: {
        category: "wallet",
        chain: "ethereum",
        address: "0x52908400098527886E0F7030069857D2E4169EE7",
        balance_wei: "420000000000000000",
        balance_eth: "0.42",
        tx_count: 37,
        is_contract: false,
        has_tokens: true,
        note: "first/last seen are not collected for EVM addresses",
      },
      minutesAgo: 25,
    },
    {
      n: 84,
      platform: "activity",
      module: "activity_fingerprint",
      idType: "username",
      idValue: HANDLE,
      extra: { username: HANDLE },
      meta: {
        category: "activity",
        activity: {
          hours_utc: [1, 0, 0, 0, 0, 0, 1, 2, 4, 6, 7, 6, 5, 4, 5, 6, 8, 11, 14, 16, 15, 12, 7, 3],
          weekdays: [14, 17, 15, 18, 13, 26, 30],
          sample_size: 133,
          first: "2024-02-03T08:11:00Z",
          last: "2025-10-28T21:40:00Z",
        },
        sources: ["hackernews", "github"],
        utc_offset_estimate: 1,
        utc_offset_label: "UTC+1",
        confidence: "medium",
        quiet_window_utc: [1, 7],
        quiet_window_share: 0.015,
      },
      minutesAgo: 22,
    },
  ];
}

/**
 * One GitHub account reported by several sources and lookups (the "accounts, not rows"
 * scenario): the GitHub module's profile, a WhatsMyName hit, and the follow-up email
 * search saying the address is registered on GitHub. With finding 1 (user_scanner) they
 * are ONE account, merged automatically. Finding 93 is a second Steam hit the
 * investigator split from finding 18.
 */
function sameAccountSpecs(): Spec[] {
  return [
    {
      n: 90,
      platform: "github",
      module: "github",
      idType: "username",
      idValue: HANDLE,
      url: profileUrl("GitHub", HANDLE),
      extra: {
        username: HANDLE,
        fullname: "Ada Fixture",
        bio: "Backend engineer. Fictional person used for demos. Rust, Postgres, tea.",
        location: "Example City",
        company: "Fixture Labs (fictional)",
        email: EMAIL,
        emails: EMAIL,
        links: `https://${DOMAIN}`,
        avatar_url: AVATAR_A,
        created_at: "2016-03-14T09:12:00Z",
        followers: 128,
        following: 64,
        public_repos: 41,
      },
      meta: { category: "development" },
      minutesAgo: 189,
    },
    {
      n: 91,
      platform: "GitHub",
      module: "whatsmyname",
      idType: "username",
      idValue: HANDLE,
      url: profileUrl("GitHub", HANDLE),
      extra: { username: HANDLE },
      meta: { category: "coding" },
      minutesAgo: 186,
    },
    {
      n: 92,
      platform: "github",
      module: "user_scanner",
      idType: "email",
      idValue: EMAIL,
      meta: { category: "development", reason: null },
      minutesAgo: 167,
    },
    {
      n: 93,
      platform: "Steam",
      module: "whatsmyname",
      idType: "username",
      idValue: HANDLE,
      url: profileUrl("Steam", HANDLE),
      extra: { username: HANDLE },
      meta: { category: "gaming" },
      minutesAgo: 185,
    },
  ];
}

/** A LinkedIn profile seen only in public search results (`linkedin_search`). */
function linkedinSpecs(): Spec[] {
  return [
    {
      n: 94,
      platform: "linkedin",
      module: "linkedin_search",
      idType: "username",
      idValue: HANDLE,
      url: `https://linkedin.example/in/${HANDLE}`,
      extra: {
        fullname: "Ada Fixture",
        headline: "Backend engineer at Fixture Labs (fictional)",
        employer: "Fixture Labs (fictional)",
        education: "Example University",
        location: "Example City",
        handle: HANDLE,
        snippet:
          "Backend engineer at Fixture Labs · Experience: Fixture Labs · Education: Example University · Location: Example City · 500+ connections",
        preview: {
          source: "search-snippet",
          provider: "example-search",
          query: `site:linkedin.com/in "${HANDLE}"`,
          fetched_at: "2026-11-20T08:40:00Z",
          title: "Ada Fixture - Backend engineer at Fixture Labs | LinkedIn",
        },
      },
      meta: { category: "professional", result_kind: "profile", search_provider: "example-search" },
      curated: true,
      minutesAgo: 120,
    },
  ];
}

export function demoFindings(caseId: string, now: number): Finding[] {
  return [
    ...accountSpecs(),
    ...emailSpecs(),
    ...infraSpecs(),
    ...mediaSpecs(),
    ...sameAccountSpecs(),
    ...linkedinSpecs(),
  ].map((s) => buildFinding(caseId, now, s));
}
