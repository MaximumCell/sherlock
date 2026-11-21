/**
 * Bundled FICTIONAL operator-panel data for fixture mode and /demo/admin. Every visitor,
 * address and target here is invented: reserved `.example` domains, `example.com` emails,
 * RFC 5737 addresses, made-up handles and names.
 */
import type { TargetType } from "../types";
import type { CaseMeta, MisuseFlag, SearchOutcome, VisitorSession } from "./types";

export interface DemoSearchSeed {
  user: string;
  minutesAgo: number;
  type: TargetType;
  value: string;
  outcome: SearchOutcome;
  modules?: string[];
  detail?: string;
}

const UA = {
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  edgeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0",
  curl: "curl/8.6.0",
  python: "python-requests/2.32.3",
};

export const DEMO_IDS = {
  selfCheck: "d3m0a001-0000-4000-8000-000000000001",
  kit: "d3m0a002-0000-4000-8000-000000000002",
  harvester: "d3m0a003-0000-4000-8000-000000000003",
  nameTrier: "d3m0a004-0000-4000-8000-000000000004",
  officeA: "d3m0a005-0000-4000-8000-000000000005",
  officeB: "d3m0a006-0000-4000-8000-000000000006",
  officeC: "d3m0a007-0000-4000-8000-000000000007",
  blocked: "d3m0a008-0000-4000-8000-000000000008",
  newcomer: "d3m0a009-0000-4000-8000-000000000009",
} as const;

const flag = (key: string, label: string, severity: MisuseFlag["severity"]): MisuseFlag => ({
  key,
  label,
  severity,
});

const SHARED = flag("shared_origin", "Shares an origin with 2 other sessions", "low");

type SessionSeed = Omit<
  VisitorSession,
  "first_seen" | "last_seen" | "search_count" | "refused_count"
> & {
  firstSeenDaysAgo: number;
};

const session = (
  user_id: string,
  rest: Partial<SessionSeed> & Pick<SessionSeed, "firstSeenDaysAgo" | "user_agent" | "origin">,
): SessionSeed => ({
  user_id,
  is_anonymous: true,
  email: null,
  country: null,
  origin_sessions: 1,
  blocked: false,
  blocked_at: null,
  blocked_reason: null,
  flags: [],
  ...rest,
});

export const DEMO_SESSIONS: SessionSeed[] = [
  session(DEMO_IDS.selfCheck, {
    firstSeenDaysAgo: 9,
    user_agent: UA.firefoxMac,
    origin: "4f1c2a9be07d3c11",
    country: "GB",
  }),
  session(DEMO_IDS.kit, {
    firstSeenDaysAgo: 12,
    is_anonymous: false,
    email: "kit.marsh@example.com",
    user_agent: UA.safariIos,
    origin: "a83de0c4419b2f70",
    country: "DE",
  }),
  session(DEMO_IDS.harvester, {
    firstSeenDaysAgo: 2,
    user_agent: UA.python,
    origin: "0bb7e52d9a6c4e18",
    country: "NL",
    flags: [
      flag(
        "many_targets",
        "Searched 18 different targets, more like harvesting than a self-check",
        "high",
      ),
      flag("burst", "11 searches within 10 minutes", "medium"),
      flag("rate_limited", "Hit the daily limit 4 times", "medium"),
      flag("burst_limit", "Hit the burst limit 2 times", "medium"),
    ],
  }),
  session(DEMO_IDS.nameTrier, {
    firstSeenDaysAgo: 1,
    user_agent: UA.chromeAndroid,
    origin: "71e9f0a2c5d83b46",
    flags: [flag("refused_names", "Tried 3 name searches without signing in", "medium")],
  }),
  session(DEMO_IDS.officeA, {
    firstSeenDaysAgo: 6,
    user_agent: UA.chromeWin,
    origin: "c2d4e6f8a0b1c3d5",
    country: "FR",
    origin_sessions: 3,
    flags: [SHARED],
  }),
  session(DEMO_IDS.officeB, {
    firstSeenDaysAgo: 5,
    user_agent: UA.edgeWin,
    origin: "c2d4e6f8a0b1c3d5",
    country: "FR",
    origin_sessions: 3,
    flags: [SHARED],
  }),
  session(DEMO_IDS.officeC, {
    firstSeenDaysAgo: 3,
    user_agent: UA.chromeWin,
    origin: "c2d4e6f8a0b1c3d5",
    country: "FR",
    origin_sessions: 3,
    flags: [
      SHARED,
      flag("shared_target", "Searched a target that 2 other sessions also searched", "low"),
    ],
  }),
  session(DEMO_IDS.blocked, {
    firstSeenDaysAgo: 4,
    user_agent: UA.curl,
    origin: "9e8d7c6b5a493827",
    blocked: true,
    blocked_reason: "Scripted lookups of many people's emails",
    flags: [
      flag(
        "many_targets",
        "Searched 14 different targets, more like harvesting than a self-check",
        "high",
      ),
    ],
  }),
  session(DEMO_IDS.newcomer, {
    firstSeenDaysAgo: 0,
    user_agent: UA.firefoxMac,
    origin: "5a5b5c5d5e5f6061",
    country: "CA",
  }),
];

const H = 60;
const D = 24 * H;

/** Hand-placed searches; `demoSearchSeeds()` adds the repetitive ones. */
const BASE: DemoSearchSeed[] = [
  {
    user: DEMO_IDS.selfCheck,
    minutesAgo: 9 * D,
    type: "username",
    value: "quill-rook",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.selfCheck,
    minutesAgo: 9 * D - 4,
    type: "email",
    value: "quill.rook@example.com",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.selfCheck,
    minutesAgo: 2 * D,
    type: "domain",
    value: "rookery.example",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.kit,
    minutesAgo: 12 * D,
    type: "email",
    value: "kit.marsh@example.com",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.kit,
    minutesAgo: 11 * D,
    type: "username",
    value: "kitmarsh",
    outcome: "accepted",
  },
  { user: DEMO_IDS.kit, minutesAgo: 5 * D, type: "name", value: "Kit Marsh", outcome: "accepted" },
  {
    user: DEMO_IDS.kit,
    minutesAgo: 40,
    type: "domain",
    value: "marsh-studio.example",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.nameTrier,
    minutesAgo: 20 * H,
    type: "name",
    value: "Marlow Quince",
    outcome: "forbidden",
    detail: "Searching by name requires a signed-in account. Sign in and try again.",
  },
  {
    user: DEMO_IDS.nameTrier,
    minutesAgo: 20 * H - 3,
    type: "name",
    value: "Marlow Quince",
    outcome: "forbidden",
    detail: "Searching by name requires a signed-in account. Sign in and try again.",
  },
  {
    user: DEMO_IDS.nameTrier,
    minutesAgo: 19 * H,
    type: "name",
    value: "Wren Holloway",
    outcome: "forbidden",
    detail: "Searching by name requires a signed-in account. Sign in and try again.",
  },
  {
    user: DEMO_IDS.nameTrier,
    minutesAgo: 19 * H - 5,
    type: "username",
    value: "wren-h",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.officeA,
    minutesAgo: 6 * D,
    type: "domain",
    value: "harbourline.example",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.officeA,
    minutesAgo: 3 * D,
    type: "ip",
    value: "203.0.113.40",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.officeB,
    minutesAgo: 5 * D,
    type: "domain",
    value: "harbourline.example",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.officeC,
    minutesAgo: 3 * D - 30,
    type: "domain",
    value: "harbourline.example",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.officeC,
    minutesAgo: 90,
    type: "email",
    value: "security@harbourline.example",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.blocked,
    minutesAgo: 30,
    type: "email",
    value: "j.doe@example.com",
    outcome: "blocked",
    detail: "This session has been blocked from running searches.",
  },
  {
    user: DEMO_IDS.newcomer,
    minutesAgo: 12,
    type: "username",
    value: "paper-lantern",
    outcome: "accepted",
  },
  {
    user: DEMO_IDS.newcomer,
    minutesAgo: 11,
    type: "domain",
    value: "not a domain",
    outcome: "invalid",
    detail: "not a valid domain",
  },
];

export function demoSearchSeeds(): DemoSearchSeed[] {
  const out = [...BASE];
  for (let i = 0; i < 18; i++) {
    out.push({
      user: DEMO_IDS.harvester,
      minutesAgo: 26 * H - i * 1.5,
      type: "email",
      value: `person${String(i + 1).padStart(2, "0")}@example.com`,
      outcome: i >= 16 ? "rate_limited" : i >= 14 ? "burst_limited" : "accepted",
      detail:
        i >= 14 ? "Daily limit reached: 20 scans per session. Try again tomorrow." : undefined,
    });
  }
  for (let i = 0; i < 14; i++) {
    out.push({
      user: DEMO_IDS.blocked,
      minutesAgo: 4 * D - i * 2,
      type: "email",
      value: `lead${i + 1}@example.com`,
      outcome: "accepted",
    });
  }
  // background self-checks spread over the fortnight, so the chart has a shape
  const pool = [
    "moss-otter",
    "tidepool.example",
    "lark.fen@example.com",
    "198.51.100.7",
    "cobalt-finch",
  ];
  for (let d = 13; d >= 0; d--) {
    const n = (d * 7) % 5;
    for (let k = 0; k < n; k++) {
      const value = pool[(d + k) % pool.length] ?? "moss-otter";
      const type: TargetType = value.includes("@")
        ? "email"
        : /^\d/.test(value)
          ? "ip"
          : value.includes(".")
            ? "domain"
            : "username";
      out.push({
        user: DEMO_IDS.selfCheck,
        minutesAgo: d * D + 300 + k * 45,
        type,
        value,
        outcome: k === 3 ? "rate_limited" : "accepted",
      });
    }
  }
  return out;
}

/** Cases as metadata only, per visitor. */
export function demoCases(now: number): Record<string, CaseMeta[]> {
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const meta = (
    id: string,
    title: string,
    type: TargetType,
    value: string,
    minutesAgo: number,
    jobs: number,
    found: number,
  ): CaseMeta => ({
    id,
    title,
    identifiers: [{ type, value }],
    status: "done",
    created_at: at(minutesAgo),
    archived_at: null,
    job_count: jobs,
    found_count: found,
  });
  return {
    [DEMO_IDS.selfCheck]: [
      meta(
        "c0de0001-0000-4000-8000-000000000001",
        "My own accounts",
        "username",
        "quill-rook",
        9 * D,
        6,
        11,
      ),
    ],
    [DEMO_IDS.kit]: [
      meta(
        "c0de0002-0000-4000-8000-000000000002",
        "kit.marsh@example.com",
        "email",
        "kit.marsh@example.com",
        12 * D,
        5,
        4,
      ),
      meta("c0de0003-0000-4000-8000-000000000003", "Kit Marsh", "name", "Kit Marsh", 5 * D, 4, 7),
    ],
    [DEMO_IDS.harvester]: [
      meta(
        "c0de0004-0000-4000-8000-000000000004",
        "list 1",
        "email",
        "person01@example.com",
        26 * H,
        70,
        23,
      ),
    ],
    [DEMO_IDS.blocked]: [
      meta(
        "c0de0005-0000-4000-8000-000000000005",
        "leads",
        "email",
        "lead1@example.com",
        4 * D,
        56,
        9,
      ),
    ],
    [DEMO_IDS.officeA]: [
      meta(
        "c0de0006-0000-4000-8000-000000000006",
        "Harbourline audit",
        "domain",
        "harbourline.example",
        6 * D,
        6,
        14,
      ),
    ],
  };
}

/** Targets the "live" demo feed cycles through. */
export const LIVE_POOL: { user: string; type: TargetType; value: string }[] = [
  { user: DEMO_IDS.newcomer, type: "email", value: "paper.lantern@example.com" },
  { user: DEMO_IDS.kit, type: "username", value: "kit-sketches" },
  { user: DEMO_IDS.selfCheck, type: "domain", value: "quillrook.example" },
  { user: DEMO_IDS.officeB, type: "ip", value: "203.0.113.41" },
  { user: DEMO_IDS.newcomer, type: "username", value: "lantern-paper" },
];
