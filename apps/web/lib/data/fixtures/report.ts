import { caseDisplayTitle } from "../../case-status";
import { describeRule } from "../../rules";
import type { Case, Correlation, Finding } from "../../types";

const cell = (text: string) => text.replace(/\|/g, "\\|");

/** Markdown report with the same sections the gateway produces. */
export function renderFixtureReport(
  c: Case,
  findings: Finding[],
  correlations: Correlation[],
  now: number = Date.now(),
): string {
  const found = findings.filter((f) => f.status === "found");
  const accounts = found.filter((f) => f.module === "user_scanner");
  const breaches = found.filter((f) => f.platform === "breach");
  const infra = found.filter((f) => ["domain", "ip"].includes(f.identifier_type));
  const approved = correlations.filter((x) => x.status === "approved");
  const pending = correlations.filter((x) => x.status === "pending");
  const byId = new Map(findings.map((f) => [f.id, f]));
  const lines: string[] = [];

  lines.push(`# ${caseDisplayTitle(c)}`, "");
  lines.push(`_Generated ${new Date(now).toISOString().slice(0, 16).replace("T", " ")} UTC from fixture data. Every subject and value in this report is fictional._`, "");
  lines.push("## Targets", "");
  for (const id of c.identifiers) lines.push(`- **${id.type}**: \`${id.value}\``);
  lines.push("", "## Summary", "");
  lines.push("| Measure | Count |", "|---|---|");
  lines.push(`| Sources checked | ${findings.length} |`);
  lines.push(`| Accounts found | ${accounts.length} |`);
  lines.push(`| Breaches | ${breaches.length} |`);
  lines.push(`| Confirmed links | ${approved.length} |`);
  lines.push(`| Links awaiting review | ${pending.length} |`);

  lines.push("", "## Accounts", "");
  if (accounts.length === 0) lines.push("No accounts found.");
  else {
    lines.push("| Platform | Handle | Category | Shortlisted |", "|---|---|---|---|");
    for (const f of accounts) {
      const category = typeof f.extra_metadata.category === "string" ? f.extra_metadata.category : "";
      lines.push(
        `| ${cell(f.platform)} | \`${cell(f.identifier_value)}\` | ${category} | ${f.curated ? "yes" : ""} |`,
      );
    }
  }

  lines.push("", "## Breach exposure", "");
  lines.push("Exposure metadata only: breach name, date and data classes. No leaked records are stored.", "");
  if (breaches.length === 0) lines.push("No breach exposure found.");
  for (const f of breaches) {
    const m = f.extra_metadata;
    const classes = Array.isArray(m.data_classes) ? m.data_classes.join(", ") : "";
    lines.push(`- **${String(m.breach_name ?? "Unknown")}** (${String(m.breach_date ?? "n/a")}): ${classes}`);
  }

  lines.push("", "## Infrastructure", "");
  if (infra.length === 0) lines.push("No infrastructure findings.");
  for (const f of infra) lines.push(`- \`${f.identifier_value}\` via ${f.module ?? f.source_tool} (${f.platform})`);

  lines.push("", "## Confirmed links", "");
  if (approved.length === 0) lines.push("No links have been approved yet.");
  for (const x of approved) {
    const who = x.entities_involved
      .map((id) => byId.get(id))
      .filter((f): f is Finding => f !== undefined)
      .map((f) => `${f.platform} (\`${f.identifier_value}\`)`)
      .join(", ");
    lines.push(`- **${describeRule(x.type).title}**, ${Math.round(x.confidence * 100)}% confidence: ${who}`);
    if (x.review_note) lines.push(`  - Reviewer note: ${x.review_note}`);
  }

  lines.push("", "## Method and limits", "");
  lines.push(
    "Public sources only. Correlations are suggestions until a person approves them. The tool performs no face recognition, no phone or ID to identity lookup, and collects no home addresses or relatives.",
  );
  return lines.join("\n");
}
