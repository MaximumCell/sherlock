import type {
  AuditEntry,
  Candidate,
  Case,
  Correlation,
  CorrelationStatus,
  Entity,
  EvidenceItem,
  Finding,
  Job,
  JobStatus,
  JsonObject,
  Queue,
} from "../../types";
import {
  ALT_HANDLE,
  DEMO_CASE_ID,
  DOMAIN,
  EMAIL,
  HANDLE,
  IMAGE_URL,
  IP,
  buildFinding,
  demoFindings,
  fid,
} from "./demo-case";
import { NAME_CASE_ID, PERSON_NAME, nameCandidates, nameCase, nameFindings } from "./people";

export const INFRA_CASE_ID = "c0ffee00-0000-4000-8000-000000000002";
export const REVIEW_CASE_ID = "c0ffee00-0000-4000-8000-000000000003";
export const ARCHIVED_CASE_ID = "c0ffee00-0000-4000-8000-000000000004";
export const FIXTURE_USER_ID = "00000000-0000-4000-8000-0000000000aa";

export interface FixtureState {
  cases: Case[];
  findings: Finding[];
  correlations: Correlation[];
  jobs: Job[];
  entities: Entity[];
  audit: AuditEntry[];
  /** Name-search candidates per case. */
  candidates: Record<string, Candidate[]>;
}

const iso = (now: number, minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const uid = (prefix: string, n: number) =>
  `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function demoCorrelations(now: number): Correlation[] {
  const corr = (
    n: number,
    type: string,
    matched: string | null,
    ids: number[],
    confidence: number,
    evidence: EvidenceItem[],
    status: CorrelationStatus,
    note: string | null = null,
  ): Correlation => ({
    id: uid("c1", n),
    case_id: DEMO_CASE_ID,
    type,
    corr_key: `${type}:${matched ?? n}`,
    matched_value: matched,
    entities_involved: ids.map(fid),
    confidence,
    evidence,
    priority: Math.round(confidence * 100 + ids.length * 5),
    status,
    reviewed: status === "approved",
    review_note: note,
    reviewed_at: status === "pending" ? null : iso(now, 45 - n),
    created_at: iso(now, 120 - n),
  });
  const contributed = (
    n: number,
    platform: string,
    module: string,
    value: string,
  ): EvidenceItem => ({
    finding_id: fid(n),
    platform,
    module,
    field: "contributed",
    value,
  });
  const ev = (n: number, field: string, value: string): EvidenceItem => ({
    finding_id: fid(n),
    field,
    value,
  });
  return [
    corr(
      1,
      "shared_email",
      EMAIL,
      [1, 10, 60, 90, 91, 92],
      0.95,
      [
        `Email ${EMAIL} appears on 3 platforms: GitHub, Gravatar, PyPI`,
        ev(90, "extra.email", EMAIL),
        ev(10, "extra.email", EMAIL),
        ev(60, "identifier_value", EMAIL),
      ],
      "approved",
      "Same mailbox published on all three profiles.",
    ),
    corr(
      2,
      "username_reuse",
      HANDLE,
      [1, 2, 3],
      0.72,
      [
        `Handle "${HANDLE}" is registered on GitHub, GitLab and Mastodon`,
        "The handle is uncommon: 25 of 35 checked platforms have it",
      ],
      "approved",
    ),
    corr(
      3,
      "avatar_match",
      "c3d4e1f0a9b8776x",
      [80, 81],
      0.9,
      [
        ev(80, "avatar_phash", "c3d4e1f0a9b87766"),
        ev(81, "avatar_phash", "c3d4e1f0a9b87764"),
        "Perceptual hashes differ by 1 of 64 bits",
      ],
      "pending",
    ),
    corr(
      4,
      "shared_url",
      `https://${DOMAIN}`,
      [1, 3, 4],
      0.85,
      [
        ev(1, "links", `https://${DOMAIN}`),
        ev(3, "links", `https://${DOMAIN}`),
        ev(4, "links", `https://${DOMAIN}`),
      ],
      "pending",
    ),
    corr(
      5,
      "shared_external_handle",
      "social.example/@ada",
      [1, 3],
      0.8,
      [
        ev(1, "links", "https://social.example/@ada"),
        ev(3, "links", `https://github.example/${HANDLE}`),
        "The two profiles link to each other",
      ],
      "pending",
    ),
    corr(
      6,
      "breach_overlap",
      EMAIL,
      [61, 62, 63],
      0.9,
      [
        `${EMAIL} appears in 3 breaches between 2019 and 2023`,
        ev(62, "data_classes", "Email addresses, Names, Phone numbers, Order history"),
      ],
      "pending",
    ),
    corr(
      7,
      "shared_bio_text",
      "Writing about queues, retries and other ways things fail.",
      [11, 12],
      0.6,
      [
        ev(11, "bio", "Writing about queues, retries and other ways things fail."),
        ev(12, "bio", "Writing about queues, retries and other ways things fail."),
      ],
      "pending",
    ),
    corr(
      8,
      "username_variation",
      ALT_HANDLE,
      [1, 50],
      0.42,
      [
        `"${ALT_HANDLE}" differs from "${HANDLE}" by one separator`,
        ev(50, "bio", "film photos"),
        "No shared email, link or avatar",
      ],
      "rejected",
      "Different avatar and interests; a naming coincidence is likely.",
    ),
    {
      ...corr(
        9,
        "same_account",
        `github:${HANDLE}`,
        [1, 90, 91, 92],
        1,
        [
          `4 findings describe one GitHub account ${HANDLE}, confirmed by github, user_scanner, whatsmyname. ` +
            `The GitHub profile ${HANDLE} publishes ${EMAIL}, and ${EMAIL} is registered on GitHub.`,
          contributed(
            1,
            "Github",
            "user_scanner",
            "profile details: name, bio, location, email, links",
          ),
          contributed(90, "github", "github", "profile details: name, bio, location, email, links"),
          contributed(91, "GitHub", "whatsmyname", "confirms the account exists"),
          contributed(92, "github", "user_scanner", `${EMAIL} is registered here`),
        ],
        "approved",
      ),
      priority: 0,
    },
    {
      ...corr(
        10,
        "same_account",
        `steam:${HANDLE}`,
        [18, 93],
        1,
        [
          `2 findings describe one Steam account ${HANDLE}, confirmed by user_scanner, whatsmyname.`,
          contributed(18, "Steam", "user_scanner", "profile details: name, location"),
          contributed(93, "Steam", "whatsmyname", "confirms the account exists"),
        ],
        "rejected",
        "Two different Steam profiles: the avatars and play history do not match.",
      ),
      priority: 0,
    },
  ];
}

function demoJobs(now: number): Job[] {
  const job = (
    n: number,
    batch: number,
    queue: Queue,
    module: string,
    targetType: string,
    targetValue: string,
    status: JobStatus,
    over: Partial<Job> = {},
  ): Job => {
    const createdAgo = batch === 1 ? 195 : batch === 2 ? 100 : 4;
    const done = status === "succeeded" || status === "failed" || status === "cancelled";
    return {
      id: uid("b1", n),
      case_id: DEMO_CASE_ID,
      batch_id: uid("ba", batch),
      queue,
      module,
      target_type: targetType,
      target_value: targetValue,
      params: {},
      status,
      progress: status === "succeeded" ? 100 : 0,
      progress_note: null,
      attempts: status === "queued" ? 0 : 1,
      max_attempts: 3,
      result: null,
      error: null,
      created_at: iso(now, createdAgo),
      started_at: status === "queued" ? null : iso(now, createdAgo - 0.2),
      finished_at: done ? iso(now, createdAgo - 3 - n * 0.4) : null,
      ...over,
    };
  };
  return [
    job(1, 1, "identity", "user_scanner", "username", HANDLE, "succeeded", {
      result: { findings: 35, found: 25 },
      progress_note: "35 platforms checked",
    }),
    job(2, 1, "identity", "gravatar", "email", EMAIL, "succeeded", {
      result: { findings: 1, found: 1 },
    }),
    job(3, 1, "identity", "xposedornot", "email", EMAIL, "succeeded", {
      result: { findings: 3, found: 3 },
    }),
    job(4, 1, "identity", "email_registrations", "email", EMAIL, "succeeded", {
      result: { findings: 4, found: 2 },
    }),
    job(5, 1, "infra", "dns_records", "domain", DOMAIN, "succeeded", {
      result: { findings: 1, found: 1 },
    }),
    job(6, 1, "infra", "crtsh", "domain", DOMAIN, "succeeded", {
      result: { findings: 3, found: 3 },
      attempts: 2,
    }),
    job(7, 1, "infra", "rdap", "domain", DOMAIN, "succeeded", {
      result: { findings: 1, found: 1 },
    }),
    job(8, 1, "infra", "wayback", "domain", DOMAIN, "failed", {
      attempts: 3,
      progress: 40,
      error: "HTTP 503 from the archive index (3 attempts)",
    }),
    job(9, 2, "identity", "user_scanner", "username", ALT_HANDLE, "succeeded", {
      result: { findings: 3, found: 3 },
    }),
    job(10, 2, "identity", "user_scanner", "username", "afixture", "cancelled", {
      progress: 12,
      progress_note: "Cancelled by the investigator",
    }),
    job(11, 2, "infra", "internetdb", "ip", IP, "succeeded", { result: { findings: 1, found: 1 } }),
    job(12, 2, "infra", "rdap", "ip", IP, "succeeded", { result: { findings: 1, found: 1 } }),
    job(13, 3, "media", "avatar_phash", "image", IMAGE_URL, "running", {
      progress: 46,
      progress_note: "Hashing avatar 4 of 8",
    }),
    job(14, 3, "media", "exif", "image", IMAGE_URL, "queued"),
    job(15, 3, "infra", "wayback", "domain", DOMAIN, "running", {
      progress: 18,
      attempts: 1,
      progress_note: "Listing snapshots",
    }),
    job(16, 1, "identity", "github", "username", HANDLE, "succeeded", {
      result: { findings: 1, found: 1 },
    }),
    job(17, 1, "identity", "whatsmyname", "username", HANDLE, "succeeded", {
      result: { findings: 2, found: 2 },
    }),
    job(18, 1, "identity", "user_scanner", "email", EMAIL, "succeeded", {
      result: { findings: 1, found: 1 },
    }),
  ];
}

function demoEntities(now: number): Entity[] {
  const ent = (n: number, kind: string, value: string, over: Partial<Entity> = {}): Entity => ({
    id: uid("e1", n),
    case_id: DEMO_CASE_ID,
    kind,
    value,
    platform: null,
    source_finding_id: null,
    is_seed: false,
    scanned: false,
    first_seen: iso(now, 180 - n),
    ...over,
  });
  return [
    ent(1, "username", HANDLE, { is_seed: true, scanned: true }),
    ent(2, "email", EMAIL, { is_seed: true, scanned: true }),
    ent(3, "domain", DOMAIN, { is_seed: true, scanned: true }),
    ent(4, "username", ALT_HANDLE, { scanned: true, source_finding_id: fid(1) }),
    ent(5, "ip", IP, { scanned: true, source_finding_id: fid(70) }),
    ent(6, "image", IMAGE_URL, { scanned: true, source_finding_id: fid(1) }),
    ent(7, "email", "ada@fixture-labs.example", { source_finding_id: fid(5), platform: "npm" }),
    ent(8, "domain", "fixture-labs.example", { source_finding_id: fid(5), platform: "npm" }),
    ent(9, "username", "afixture", { source_finding_id: fid(4), platform: "GitHub" }),
    ent(10, "wallet", "0x52908400098527886E0F7030069857D2E4169EE7", {
      source_finding_id: fid(4),
      platform: "Keybase",
    }),
    ent(11, "url", "https://social.example/@ada", { source_finding_id: fid(1) }),
    ent(12, "domain", `git.${DOMAIN}`, { source_finding_id: fid(73) }),
  ];
}

function demoAudit(now: number): AuditEntry[] {
  let id = 100;
  const entry = (
    caseId: string,
    minutesAgo: number,
    action: string,
    actor: string,
    detail: JsonObject,
  ): AuditEntry => ({
    id: id++,
    case_id: caseId,
    action,
    actor,
    detail,
    created_at: iso(now, minutesAgo),
  });
  const C = DEMO_CASE_ID;
  return [
    entry(C, 196, "case_created", "investigator", {
      identifiers: 3,
      acknowledgement: "authorised / own data",
    }),
    entry(C, 195, "scan_requested", "investigator", { targets: 3, jobs: 8 }),
    entry(C, 190, "collector_run", "user_scanner", { target: HANDLE, findings: 35, found: 25 }),
    entry(C, 172, "collector_run", "gravatar", { target: EMAIL, found: 1 }),
    entry(C, 170, "collector_run", "xposedornot", { target: EMAIL, breaches: 3 }),
    entry(C, 142, "collector_run", "dns_records", { target: DOMAIN, records: 6 }),
    entry(C, 140, "collector_run", "crtsh", { target: DOMAIN, certificates: 3 }),
    entry(C, 138, "collector_failed", "wayback", {
      target: DOMAIN,
      error: "HTTP 503",
      attempts: 3,
    }),
    entry(C, 120, "correlation", "engine", { rules: 6, correlations: 8 }),
    entry(C, 100, "scan_requested", "investigator", { target: ALT_HANDLE, reason: "pivot" }),
    entry(C, 95, "collector_run", "user_scanner", { target: ALT_HANDLE, found: 3 }),
    entry(C, 60, "collector_run", "internetdb", { target: IP, ports: 4 }),
    entry(C, 44, "review", "investigator", { rule: "shared_email", decision: "approve" }),
    entry(C, 43, "review", "investigator", { rule: "username_reuse", decision: "approve" }),
    entry(C, 37, "review", "investigator", { rule: "username_variation", decision: "reject" }),
    entry(C, 4, "scan_requested", "investigator", { target: IMAGE_URL, jobs: 3 }),
    entry(INFRA_CASE_ID, 2900, "case_created", "investigator", { identifiers: 2 }),
    entry(INFRA_CASE_ID, 2890, "collector_run", "dns_records", {
      target: "example.org",
      records: 5,
    }),
    entry(INFRA_CASE_ID, 2880, "report", "investigator", { format: "markdown" }),
    entry(REVIEW_CASE_ID, 1500, "case_created", "investigator", { identifiers: 1 }),
    entry(REVIEW_CASE_ID, 1490, "correlation", "engine", { correlations: 2 }),
  ];
}

function otherCases(now: number): Pick<FixtureState, "findings" | "correlations" | "jobs"> {
  const f = (caseId: string, n: number, spec: Omit<Parameters<typeof buildFinding>[2], "n">) =>
    buildFinding(caseId, now, { n, ...spec });
  const findings: Finding[] = [
    f(INFRA_CASE_ID, 200, {
      platform: "dns",
      module: "dns_records",
      idType: "domain",
      idValue: "example.org",
      url: "https://dns.example/query?name=example.org",
      meta: {
        category: "dns",
        dns: { A: ["198.51.100.24"], MX: ["10 mx.example.org"], NS: ["a.example-dns.net"] },
      },
      minutesAgo: 2890,
    }),
    f(INFRA_CASE_ID, 201, {
      platform: "crt.sh",
      module: "crtsh",
      idType: "domain",
      idValue: "example.org",
      extra: { common_name: "status.example.org", issuer: "Example Trust Services CA" },
      meta: { category: "certificate", subdomain: "status.example.org" },
      minutesAgo: 2889,
    }),
    f(INFRA_CASE_ID, 202, {
      platform: "internetdb",
      module: "internetdb",
      idType: "ip",
      idValue: "198.51.100.24",
      meta: { category: "network", ports: [80, 443] },
      minutesAgo: 2888,
    }),
    f(REVIEW_CASE_ID, 210, {
      platform: "Gravatar",
      module: "gravatar",
      idType: "email",
      idValue: "press@example.net",
      url: "https://gravatar.example/press",
      extra: { fullname: "Example Press Desk", links: "https://example.net/press" },
      meta: { category: "identity" },
      minutesAgo: 1495,
    }),
    f(REVIEW_CASE_ID, 211, {
      platform: "breach",
      module: "xposedornot",
      idType: "email",
      idValue: "press@example.net",
      meta: {
        category: "breach",
        breach_name: "ExampleForum",
        breach_date: "2019-06-02",
        data_classes: ["Email addresses", "Usernames"],
      },
      minutesAgo: 1494,
    }),
    f(REVIEW_CASE_ID, 212, {
      platform: "breach",
      module: "xposedornot",
      idType: "email",
      idValue: "press@example.net",
      meta: {
        category: "breach",
        breach_name: "NewsletterCo",
        breach_date: "2022-01-09",
        data_classes: ["Email addresses"],
      },
      minutesAgo: 1494,
    }),
    f(ARCHIVED_CASE_ID, 220, {
      platform: "GitHub",
      module: "user_scanner",
      idType: "username",
      idValue: "fixture-bot",
      url: "https://github.example/fixture-bot",
      extra: { bio: "Automation account (fictional)." },
      meta: { category: "development" },
      minutesAgo: 43000,
    }),
  ];
  const base = demoCorrelations(now)[5];
  const correlations: Correlation[] = base
    ? [
        {
          ...base,
          id: uid("c2", 1),
          case_id: REVIEW_CASE_ID,
          corr_key: "breach_overlap:press@example.net",
          matched_value: "press@example.net",
          entities_involved: [fid(211), fid(212)],
          evidence: ["press@example.net appears in 2 breaches"],
          confidence: 0.85,
          created_at: iso(now, 1490),
        },
        {
          ...base,
          id: uid("c2", 2),
          case_id: REVIEW_CASE_ID,
          type: "shared_email",
          corr_key: "shared_email:press@example.net",
          matched_value: "press@example.net",
          entities_involved: [fid(210), fid(211)],
          evidence: ["Gravatar profile and breach record share the address"],
          confidence: 0.7,
          created_at: iso(now, 1490),
        },
      ]
    : [];
  return { findings, correlations, jobs: [] };
}

export function createFixtureState(now: number = Date.now()): FixtureState {
  const baseCase = {
    notes: "",
    status: "open",
    owner_id: FIXTURE_USER_ID,
    is_demo: true,
    archived_at: null,
  };
  const cases: Case[] = [
    {
      ...baseCase,
      id: DEMO_CASE_ID,
      title: "Ada Fixture: self-exposure audit",
      notes:
        "Fictional demo subject. Goal: map what a stranger can learn from the handle, the mailbox and the personal domain.\n\n- Confirm which accounts are really Ada's\n- List breach exposure for the mailbox\n- Check what the personal server exposes",
      tags: ["self-audit", "demo"],
      identifiers: [
        { type: "username", value: HANDLE },
        { type: "email", value: EMAIL },
        { type: "domain", value: DOMAIN },
      ],
      created_at: iso(now, 196),
      updated_at: iso(now, 4),
    },
    {
      ...baseCase,
      id: REVIEW_CASE_ID,
      title: "press@example.net mailbox",
      tags: ["email", "client-a"],
      identifiers: [{ type: "email", value: "press@example.net" }],
      created_at: iso(now, 1500),
      updated_at: iso(now, 1490),
    },
    {
      ...baseCase,
      id: INFRA_CASE_ID,
      title: "example.org infrastructure",
      tags: ["infra", "client-a"],
      identifiers: [
        { type: "domain", value: "example.org" },
        { type: "ip", value: "198.51.100.24" },
      ],
      created_at: iso(now, 2900),
      updated_at: iso(now, 2880),
    },
    {
      ...baseCase,
      id: ARCHIVED_CASE_ID,
      title: null,
      tags: ["demo"],
      identifiers: [{ type: "username", value: "fixture-bot" }],
      created_at: iso(now, 43200),
      updated_at: iso(now, 43000),
      archived_at: iso(now, 40000),
    },
  ];
  cases.splice(1, 0, nameCase(now, FIXTURE_USER_ID));
  const others = otherCases(now);
  return {
    cases,
    findings: [...demoFindings(DEMO_CASE_ID, now), ...nameFindings(now), ...others.findings],
    correlations: [...demoCorrelations(now), ...others.correlations],
    jobs: [...demoJobs(now), ...others.jobs],
    entities: [
      ...demoEntities(now),
      {
        id: uid("e5", 1),
        case_id: NAME_CASE_ID,
        kind: "name",
        value: PERSON_NAME,
        platform: null,
        source_finding_id: null,
        is_seed: true,
        scanned: true,
        first_seen: iso(now, 95),
      },
    ],
    audit: demoAudit(now),
    candidates: { [NAME_CASE_ID]: nameCandidates() },
  };
}
