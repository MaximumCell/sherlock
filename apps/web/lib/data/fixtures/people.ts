/**
 * Fictional name-search case. "Marlow Quince" is an invented person; every
 * employer, city, handle and URL below is made up and points at reserved
 * `.example` hosts.
 */
import type { Candidate, Case, Entity, Finding, JsonObject } from "../../types";
import { avatar } from "./demo-case";

export const NAME_CASE_ID = "c0ffee00-0000-4000-8000-000000000005";
export const PERSON_NAME = "Marlow Quince";

const iso = (now: number, minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const pid = (n: number) => `f5000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export function nameCase(now: number, ownerId: string): Case {
  return {
    id: NAME_CASE_ID,
    title: "Marlow Quince: who is who",
    notes:
      "Fictional name search. Several people share the name; pick the right one before pivoting.",
    tags: ["name-search", "demo"],
    identifiers: [{ type: "name", value: PERSON_NAME }],
    status: "open",
    owner_id: ownerId,
    is_demo: true,
    created_at: iso(now, 95),
    updated_at: iso(now, 80),
    archived_at: null,
  };
}

function profile(
  n: number,
  now: number,
  platform: string,
  url: string,
  extra: JsonObject,
  minutesAgo: number,
): Finding {
  return {
    id: pid(n),
    case_id: NAME_CASE_ID,
    identifier_type: "name",
    identifier_value: PERSON_NAME,
    source_tool: "name_search",
    module: "name_search",
    platform,
    status: "found",
    finding_key: `name-${n}`,
    extra_metadata: { url, extra, category: "identity" },
    curated: false,
    job_id: null,
    collected_at: iso(now, minutesAgo),
  };
}

export function nameFindings(now: number): Finding[] {
  return [
    profile(1, now, "GitHub", "https://code.example/mquince", {
      fullname: PERSON_NAME,
      bio: "Robotics firmware. Rust, embedded, coffee.",
      location: "Port Ellery",
      links: "https://mquince.example",
      company: "Example Robotics Ltd",
      avatar_url: avatar("MQ", 28),
    }, 88),
    profile(2, now, "Mastodon", "https://social.example/@marlowq", {
      fullname: PERSON_NAME,
      bio: "Firmware at Example Robotics. Port Ellery.",
      links: "https://mquince.example, https://code.example/mquince",
      avatar_url: avatar("MQ", 28),
    }, 87),
    profile(3, now, "Personal site", "https://mquince.example", {
      fullname: PERSON_NAME,
      bio: "Embedded engineer. Talks and notes.",
      email: "hello@mquince.example",
    }, 86),
    profile(4, now, "Conference speakers", "https://events.example/speakers/marlow-quince", {
      fullname: PERSON_NAME,
      bio: "Marlow Quince, Example Robotics Ltd: safe motor control in Rust.",
    }, 85),
    profile(5, now, "Lichess", "https://chess.example/@/quince_m", {
      fullname: "Marlow Q.",
      location: "Harrowgate",
      bio: "Teacher at Harrowgate Academy. Blitz only.",
    }, 84),
    profile(6, now, "Alumni list", "https://alumni.example/harrowgate/2009", {
      fullname: PERSON_NAME,
      school: "Harrowgate Academy",
    }, 84),
    profile(7, now, "Photography portfolio", "https://photos.example/marlowquince", {
      fullname: "Marlow Quince Studio",
      location: "Saltmere",
    }, 83),
  ];
}

export function nameCandidates(): Candidate[] {
  return [
    {
      candidate_id: "cand-port-ellery",
      label: "Marlow Quince, firmware engineer (Port Ellery)",
      score: 0.86,
      evidence: [
        "Same display name and avatar on GitHub and Mastodon",
        "Mastodon bio and conference listing both name Example Robotics Ltd",
        "GitHub and Mastodon both link to mquince.example",
        "Matches your hint: employer \"Example Robotics\"",
      ],
      finding_ids: [pid(1), pid(2), pid(3), pid(4)],
      confirmed: false,
      attributes: {
        employers: ["Example Robotics Ltd"],
        locations: ["Port Ellery"],
        handles: [
          { platform: "GitHub", handle: "mquince", url: "https://code.example/mquince" },
          { platform: "Mastodon", handle: "marlowq", url: "https://social.example/@marlowq" },
        ],
        links: ["https://mquince.example"],
        sources: ["GitHub", "Mastodon", "Personal site", "Conference speakers"],
      },
    },
    {
      candidate_id: "cand-harrowgate",
      label: "Marlow Quince, teacher (Harrowgate)",
      score: 0.41,
      evidence: [
        "Lichess bio mentions Harrowgate Academy",
        "Alumni list for Harrowgate Academy has the same full name",
      ],
      finding_ids: [pid(5), pid(6)],
      confirmed: false,
      attributes: {
        employers: ["Harrowgate Academy"],
        locations: ["Harrowgate"],
        handles: [{ platform: "Lichess", handle: "quince_m", url: "https://chess.example/@/quince_m" }],
        sources: ["Lichess", "Alumni list"],
        links: [],
      },
    },
    {
      // deliberately sparse: the backend may omit attributes
      candidate_id: "cand-saltmere",
      label: "Marlow Quince Studio (Saltmere)",
      score: 0.17,
      evidence: ["Business name contains the full name; no other overlap"],
      finding_ids: [pid(7)],
      confirmed: false,
      attributes: { employers: [], locations: ["Saltmere"], handles: [], links: [], sources: ["Photography portfolio"] },
    },
  ];
}

/** Entities a confirmed candidate adds as pivot suggestions (unscanned, not seeds). */
export function entitiesForCandidate(
  candidate: Candidate,
  now: number,
  newId: (prefix: string) => string,
): Entity[] {
  const first = candidate.finding_ids[0] ?? null;
  const rows: Omit<Entity, "id" | "case_id" | "first_seen">[] = [
    ...candidate.attributes.handles.map((h) => ({
      kind: "username",
      value: h.handle,
      platform: h.platform,
      source_finding_id: first,
      is_seed: false,
      scanned: false,
    })),
    ...candidate.attributes.links.flatMap((link) => {
      try {
        return [
          {
            kind: "domain",
            value: new URL(link).hostname,
            platform: null,
            source_finding_id: first,
            is_seed: false,
            scanned: false,
          },
        ];
      } catch {
        return [];
      }
    }),
  ];
  if (candidate.candidate_id === "cand-port-ellery") {
    rows.push({
      kind: "email",
      value: "hello@mquince.example",
      platform: "Personal site",
      source_finding_id: pid(3),
      is_seed: false,
      scanned: false,
    });
  }
  return rows.map((r, i) => ({
    ...r,
    id: newId("e5"),
    case_id: NAME_CASE_ID,
    first_seen: new Date(now + i).toISOString(),
  }));
}

/** Candidates for a name search started inside fixture mode (two invented people). */
export function syntheticCandidates(name: string, findingIds: string[], hints: JsonObject): Candidate[] {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const city = typeof hints.city === "string" && hints.city ? hints.city : "Example City";
  const employer = typeof hints.employer === "string" && hints.employer ? hints.employer : "Example Labs";
  return [
    {
      candidate_id: `syn-${slug}-1`,
      label: `${name} (${city})`,
      score: 0.72,
      evidence: [
        "Same full name on a code-hosting profile and a personal page",
        `Both mention ${employer}`,
      ],
      finding_ids: findingIds,
      confirmed: false,
      attributes: {
        employers: [employer],
        locations: [city],
        handles: [{ platform: "GitHub", handle: slug, url: `https://github.example/${slug}` }],
        links: [`https://${slug}.example`],
        sources: ["GitHub", "Personal site"],
      },
    },
    {
      candidate_id: `syn-${slug}-2`,
      label: `${name} (unrelated namesake)`,
      score: 0.22,
      evidence: ["Only the name matches; no shared links, places or employers"],
      finding_ids: [],
      confirmed: false,
      attributes: { employers: [], locations: [], handles: [], links: [], sources: ["Directory listing"] },
    },
  ];
}
