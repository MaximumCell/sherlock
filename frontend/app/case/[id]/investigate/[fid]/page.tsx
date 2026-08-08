import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase, listFindings, listCorrelations } from "@/lib/api";
import { Icon } from "../../../../_components/icon";
import { StatusBadge } from "../../../../_components/status-badge";
import { FindingDetails } from "../../../../_components/finding-details";
import { InvestigateActions } from "./investigate-actions";

// Live data from the FastAPI backend — never prerender.
export const dynamic = "force-dynamic";

/** Deep-dive page for a single finding.
 *
 * User flow:
 *   1. From the case page (first stage), star an interesting finding
 *   2. Click "Investigate" → land here (second stage)
 *   3. This page is dedicated to that ONE account: it shows the account's
 *      public data + the pivot chain (emails/handles/URLs) that have been
 *      extracted from it, with one-click actions to follow each pivot
 *      WITHOUT creating a new case — new findings are merged into the
 *      current case so the whole investigation stays in one place.
 *   4. The user can keep going: scan an email → find more accounts →
 *      correlate → repeat. Each step adds to the same case.
 */
export default async function InvestigatePage({
  params,
}: {
  params: Promise<{ id: string; fid: string }>;
}) {
  const { id, fid } = await params;

  let c;
  try {
    c = await getCase(id);
  } catch {
    notFound();
  }
  const [findings, correlations] = await Promise.all([
    listFindings(id).catch(() => []),
    listCorrelations(id).catch(() => []),
  ]);

  const finding = findings.find((f) => f.id === fid);
  if (!finding) notFound();

  // Find every correlation that touches this finding, then collect the
  // *other* entities involved so we can show "this account is linked to
  // N other findings via M correlations."
  const myCorrelations = correlations.filter(
    (co) =>
      Array.isArray(co.entities_involved) &&
      co.entities_involved.some(
        (e: unknown) => typeof e === "string" && e.includes(fid),
      ),
  );
  const linkedEntityIds = new Set<string>();
  for (const co of myCorrelations) {
    for (const e of co.entities_involved) {
      if (typeof e === "string" && !e.includes(fid)) linkedEntityIds.add(e);
    }
  }
  // entities_involved uses "<case_id>:<finding_id>" — match the suffix
  const linkedFindings = findings.filter((f) =>
    linkedEntityIds.has(`${id}:${f.id}`),
  );

  return (
    <div>
      {/* Top breadcrumb / back link */}
      <div
        className="row"
        style={{ gap: 8, marginBottom: 14, fontSize: 12 }}
      >
        <Link
          href={`/case/${id}`}
          className="row"
          style={{
            gap: 6,
            alignItems: "center",
            color: "var(--color-foreground)",
            opacity: 0.7,
            textDecoration: "none",
            padding: "4px 10px",
            border: "1px solid var(--color-border-soft)",
            borderRadius: 6,
          }}
        >
          <Icon name="arrow-left" size={12} />
          Back to case overview
        </Link>
        <span className="muted">·</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {c.identifiers[0]?.value ?? id}
        </span>
      </div>

      {/* Header card — the focused account */}
      <section
        className="rounded-xl border p-5 sm:p-6"
        style={{
          background:
            "linear-gradient(180deg, hsl(var(--card)) 0%, hsl(var(--tertiary)) 100%)",
          borderColor: "var(--color-border-soft)",
        }}
      >
        <div className="row" style={{ alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              opacity: 0.55,
            }}
          >
            Deep investigation
          </span>
          <span
            style={{
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 4,
              background: "hsl(var(--accent) / 0.12)",
              color: "var(--color-accent)",
              border: "1px solid hsl(var(--accent) / 0.3)",
              fontWeight: 600,
            }}
          >
            Stage 2
          </span>
        </div>
        <h1
          className="mono"
          style={{
            fontSize: 22,
            fontWeight: 600,
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {finding.platform}
          <span className="muted" style={{ fontSize: 16, fontWeight: 400, marginLeft: 8 }}>
            {finding.identifier_value}
          </span>
        </h1>
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <StatusBadge status={finding.status} />
          {finding.source_tool && (
            <span className="badge muted" style={{ fontSize: 10 }}>
              via {finding.source_tool}
            </span>
          )}
          <span className="muted mono" style={{ fontSize: 10.5 }}>
            id {finding.id.slice(0, 8)} · added {new Date(finding.collected_at).toLocaleString()}
          </span>
        </div>
      </section>

      {/* Two-column main area: account data on the left, pivot actions on the right */}
      <div
        className="grid gap-6"
        style={{
          marginTop: 20,
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
        }}
      >
        {/* Account data — the existing FindingDetails panel, full-width */}
        <div
          className="rounded-xl border p-5"
          style={{
            background: "hsl(var(--card))",
            borderColor: "var(--color-border-soft)",
          }}
        >
          <div
            className="row"
            style={{ gap: 6, marginBottom: 12, alignItems: "center" }}
          >
            <Icon name="info" size={12} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                opacity: 0.7,
              }}
            >
              Account data
            </span>
          </div>
          <FindingDetails finding={finding} compact={false} />
        </div>

        {/* Pivot actions — the "go deeper" controls */}
        <div>
          <InvestigateActions
            caseId={id}
            finding={finding}
            caseIdentifiers={c.identifiers}
            myCorrelations={myCorrelations}
            linkedFindings={linkedFindings}
            totalFindings={findings.length}
            allFindings={findings}
          />
        </div>
      </div>

      {/* Linked accounts — what this finding is correlated to */}
      {linkedFindings.length > 0 && (
        <section
          className="rounded-xl border p-5"
          style={{
            marginTop: 20,
            background: "hsl(var(--card))",
            borderColor: "var(--color-border-soft)",
          }}
        >
          <div className="row" style={{ gap: 6, marginBottom: 12, alignItems: "center" }}>
            <Icon name="branch" size={12} />
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                opacity: 0.7,
              }}
            >
              Linked to {linkedFindings.length} other finding{linkedFindings.length === 1 ? "" : "s"}
            </span>
            <span className="muted" style={{ fontSize: 11 }}>
              via {myCorrelations.length} correlation{myCorrelations.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
            {linkedFindings.slice(0, 8).map((f) => (
              <Link
                key={f.id}
                href={`/case/${id}/investigate/${f.id}`}
                className="rounded-lg border p-3"
                style={{
                  background: "hsl(var(--muted) / 0.4)",
                  borderColor: "var(--color-border-soft)",
                  textDecoration: "none",
                  color: "var(--color-foreground)",
                  fontSize: 12,
                }}
              >
                <div className="mono" style={{ fontWeight: 600, marginBottom: 2 }}>
                  {f.platform}
                </div>
                <div className="muted mono" style={{ fontSize: 11, wordBreak: "break-all" }}>
                  {f.identifier_value}
                </div>
                <div className="row" style={{ gap: 4, marginTop: 6 }}>
                  <StatusBadge status={f.status} />
                </div>
              </Link>
            ))}
            {linkedFindings.length > 8 && (
              <div className="muted" style={{ fontSize: 11, padding: 8 }}>
                + {linkedFindings.length - 8} more
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
