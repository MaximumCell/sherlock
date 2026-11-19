/**
 * A small stand-in for `sherlock_core.scoring` so fixture mode can show an exposure
 * score that reacts to scans and review decisions. Same factor keys, caps and bands
 * as the backend; the curves are simplified.
 */
import type { Correlation, Exposure, ExposureFactor, Finding } from "../../types";
import { bandFor } from "../mappers";

const share = (n: number, saturation: number) =>
  n <= 0 ? 0 : Math.min(1, Math.log1p(n) / Math.log1p(saturation));
const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function factor(
  key: string,
  label: string,
  max: number,
  points: number,
  detail: string,
  evidence: Finding[],
  remediation: string[],
): ExposureFactor {
  return {
    key,
    label,
    points: round1(Math.max(0, Math.min(max, points))),
    max_points: max,
    detail,
    evidence_finding_ids: evidence.map((f) => f.id).slice(0, 50),
    remediation,
  };
}

const extra = (f: Finding) => f.extra_metadata.extra ?? {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export const FIXTURE_METHOD =
  "A deterministic 0-100 estimate of how much this case's public findings expose the subject. It is the sum of capped factors (breaches and infostealer logs 30, account footprint 15, identity linkability 15, infrastructure 15, published contact details 10, handle reuse 10, image location metadata 5), each with diminishing returns. Only findings with status 'found' and correlations you approved are counted. It is not a probability of compromise and not a security audit: it reflects only the sources that were scanned.";

export function scoreFixtureCase(findings: Finding[], correlations: Correlation[]): Exposure {
  const found = findings.filter((f) => f.status === "found" && f.extra_metadata.summary !== true);
  const approved = correlations.filter((c) => c.status === "approved");

  const breaches = found.filter((f) => f.platform === "breach");
  const sensitive = breaches.filter((f) =>
    list(f.extra_metadata.data_classes).some((c) => /password|phone|physical address|home address|birth/i.test(String(c))),
  );
  const breach = factor(
    "breach_exposure",
    "Breach exposure",
    30,
    breaches.length === 0 ? 0 : 30 * (0.45 * share(breaches.length, 20) + 0.15 + 0.3 * share(sensitive.length, 4)),
    breaches.length
      ? `${plural(breaches.length, "breach")} list this subject; ${sensitive.length} exposed passwords, phone numbers or addresses.`
      : "No breach listings found for the scanned identifiers.",
    breaches,
    breaches.length
      ? [
          "Change the password on every service that shared it with a breached site, and use a password manager.",
          "Turn on two-factor authentication for the breached mailbox.",
          "Watch for phishing that quotes data from these breaches.",
        ]
      : [],
  );

  const accounts = found.filter(
    (f) =>
      f.platform !== "breach" &&
      ["username", "email", "name"].includes(f.identifier_type) &&
      !["dns", "rdap", "crt.sh", "internetdb", "activity"].includes(f.platform),
  );
  const footprint = factor(
    "account_footprint",
    "Account footprint",
    15,
    15 * share(accounts.length, 50),
    `${plural(accounts.length, "public account")} found across the scanned platforms.`,
    accounts,
    accounts.length ? ["Close accounts you no longer use.", "Make dormant profiles private."] : [],
  );

  const linkEvidence = found.filter((f) => approved.some((c) => c.entities_involved.includes(f.id)));
  const linkability = factor(
    "identity_linkability",
    "Identity linkability",
    15,
    15 * share(approved.length, 10),
    approved.length
      ? `${plural(approved.length, "approved correlation")} tie these accounts to one person.`
      : "No approved correlations yet. Approve links in Review to count them.",
    linkEvidence,
    approved.length
      ? [
          "Use different display names and avatars where you want accounts kept apart.",
          "Remove cross-links between profiles you do not want connected.",
        ]
      : [],
  );

  const network = found.filter((f) => f.platform === "internetdb");
  const ports = network.flatMap((f) => list(f.extra_metadata.ports));
  const vulns = network.flatMap((f) => list(f.extra_metadata.vulns));
  const dns = found.filter((f) => f.platform === "dns");
  const noDmarc = dns.filter((f) => f.extra_metadata.has_dmarc === false).length;
  const infra = factor(
    "infrastructure_exposure",
    "Infrastructure exposure",
    15,
    3 * share(ports.length, 20) + 6 * share(vulns.length, 10) + 1.5 * noDmarc,
    network.length || dns.length
      ? `${plural(ports.length, "open port")}, ${plural(vulns.length, "known vulnerability")}${noDmarc ? ", no DMARC policy" : ""}.`
      : "No infrastructure scanned.",
    [...network, ...dns],
    network.length || dns.length
      ? [
          "Close services that do not need to face the internet, or put them behind a VPN.",
          "Patch the software behind every listed CVE.",
          ...(noDmarc ? ["Publish a DMARC record so others cannot spoof your domain."] : []),
        ]
      : [],
  );

  const contactRows = found.filter((f) => {
    const e = extra(f);
    return f.platform !== "breach" && (Boolean(e.email) || Boolean(e.emails) || Boolean(e.phone));
  });
  const contact = factor(
    "exposed_contact_details",
    "Exposed contact details",
    10,
    10 * share(contactRows.length, 6),
    contactRows.length
      ? `An email address or phone number is published on ${plural(contactRows.length, "profile")}.`
      : "No contact details published on the profiles found.",
    contactRows,
    contactRows.length ? ["Hide the email address on public profiles or use a forwarding alias."] : [],
  );

  const byHandle = new Map<string, Finding[]>();
  for (const f of accounts.filter((x) => x.identifier_type === "username")) {
    byHandle.set(f.identifier_value, [...(byHandle.get(f.identifier_value) ?? []), f]);
  }
  const [topHandle, reused] = [...byHandle.entries()].sort((a, b) => b[1].length - a[1].length)[0] ?? [
    "",
    [],
  ];
  const handle = factor(
    "handle_reuse",
    "Handle reuse",
    10,
    10 * share(Math.max(0, reused.length - 1), 25),
    reused.length > 1
      ? `The handle "${topHandle}" is registered on ${plural(reused.length, "platform")}.`
      : "No handle is reused across platforms.",
    reused,
    reused.length > 1 ? ["Use different handles for accounts you want kept separate."] : [],
  );

  const gps = found.filter((f) => f.extra_metadata.gps_present === true);
  const media = factor(
    "media_location",
    "Image location metadata",
    5,
    5 * Math.min(1, Math.sqrt(gps.length / 2)),
    gps.length ? `${plural(gps.length, "image")} carry GPS coordinates.` : "No image carries GPS coordinates.",
    gps,
    gps.length ? ["Strip location metadata before publishing photos."] : [],
  );

  const factors = [breach, footprint, linkability, infra, contact, handle, media].sort(
    (a, b) => b.points - a.points || a.key.localeCompare(b.key),
  );
  const score = Math.round(Math.min(100, factors.reduce((sum, f) => sum + f.points, 0)));
  return {
    score,
    band: bandFor(score),
    factors,
    computed_from: { findings: found.length, approved_correlations: approved.length },
    method: found.length ? FIXTURE_METHOD : `No findings with status 'found' yet, so the score is 0. ${FIXTURE_METHOD}`,
  };
}
