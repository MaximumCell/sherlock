import Link from "next/link";
import { notFound } from "next/navigation";
import { getCase, listFindings, listCorrelations } from "@/lib/api";
import { Icon } from "../../../_components/icon";
import { StatusBadge } from "../../../_components/status-badge";
import { FindingDetails } from "../../../_components/finding-details";

/** Shortlist overview page — every curated + every enriched finding
 *  in one place, with the tools to investigate each one in depth.
 *
 *  This is the navigation hub for the "follow up" workflow:
 *   - See all starred accounts at a glance
 *   - See all firecrawl-enriched profiles
 *   - One click to the deep-investigation view for any of them
 *   - Bulk actions (enrich all curated, clear curation) live here too
 *     so the case page stays focused on the active scan results.
 */
export default async function ShortlistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  // The /findings endpoint surfaces `curated` as a top-level boolean (we
  // surface it from extra_metadata.curated in the router). For the
  // shortlist view, we want BOTH starred and firecrawl-enriched findings.
  const curated = findings.filter((f) => f.curated === true);
  const enriched = findings.filter((f) => f.source_tool === "firecrawl");
  // Build a real Set of curated ids so the .has() check actually works
  // (the previous helper was called like a Set method, which crashed at
  // runtime — the page is a server component, so this happens at render).
  const curatedIdSet = new Set(curated.map((f) => f.id));
  // Uniqued union: anything the user has flagged OR scraped
  const all = [...curated, ...enriched.filter((f) => !curatedIdSet.has(f.id))];

  // Count correlations per finding for the "this account is linked to N" badge
  const correlationCount = new Map<string, number>();
  for (const co of correlations) {
    if (!Array.isArray(co.entities_involved)) continue;
    for (const e of co.entities_involved) {
      if (typeof e !== "string") continue;
      const fid = e.split(":").pop();
      if (fid) correlationCount.set(fid, (correlationCount.get(fid) ?? 0) + 1);
    }
  }

  return (
    <div>
      {/* Back to case */}
      <div className="row" style={{ gap: 8, marginBottom: 14, fontSize: 12 }}>
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
          Back to case
        </Link>
        <span className="muted">·</span>
        <span className="muted" style={{ fontSize: 11 }}>
          {c.identifiers[0]?.value ?? id}
        </span>
      </div>

      {/* Header */}
      <section
        className="rounded-xl border p-5 sm:p-6"
        style={{
          background:
            "linear-gradient(180deg, hsl(38 95% 53% / 0.06) 0%, hsl(var(--card)) 60%)",
          borderColor: "hsl(38 95% 53% / 0.25)",
        }}
      >
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <div
            className="flex items-center justify-center w-11 h-11 rounded-md shrink-0"
            style={{ background: "hsl(38 95% 53% / 0.15)", color: "hsl(38 95% 53%)" }}
          >
            <Icon name="star" size={20} fill="currentColor" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 600,
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              Shortlist
            </h1>
            <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
              Every account you've starred, plus every profile-page you've enriched.
              One click to drill into any of them.
            </div>
          </div>
        </div>

        {/* Stat tiles */}
        <div
          className="row"
          style={{
            gap: 16,
            marginTop: 18,
            paddingTop: 18,
            borderTop: "1px solid var(--color-border-soft)",
            flexWrap: "wrap",
          }}
        >
          <Stat label="Curated" value={curated.length} color="hsl(38 95% 53%)" />
          <Stat label="Enriched" value={enriched.length} color="var(--color-cyan)" />
          <Stat label="Unique profiles" value={all.length} color="var(--color-accent)" />
          <Stat label="Total findings" value={findings.length} color="var(--color-foreground)" />
        </div>
      </section>

      {/* Curated section */}
      <Section title="Curated (starred for follow-up)" icon="star" count={curated.length} muted={curated.length === 0}>
        {curated.length === 0 ? (
          <Empty
            text="No starred findings yet. On the case page, click the star button on any account you want to investigate further."
          />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}
          >
            {curated.map((f) => (
              <ShortlistCard
                key={f.id}
                caseId={id}
                finding={f}
                linkCount={correlationCount.get(f.id) ?? 0}
                variant="curated"
              />
            ))}
          </div>
        )}
      </Section>

      {/* Enriched section */}
      <Section
        title="Enriched profiles (Firecrawl scrapes)"
        icon="link"
        count={enriched.length}
        muted={enriched.length === 0}
      >
        {enriched.length === 0 ? (
          <Empty
            text="No enriched findings yet. On the case page, click 'Enrich all curated' to scrape the starred profiles and pull emails/locations/links out of their public pages."
          />
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))" }}
          >
            {enriched
              .filter((f) => !curatedIdSet.has(f.id))
              .map((f) => (
                <ShortlistCard
                  key={f.id}
                  caseId={id}
                  finding={f}
                  linkCount={correlationCount.get(f.id) ?? 0}
                  variant="enriched"
                />
              ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          opacity: 0.55,
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color }}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  muted,
  children,
}: {
  title: string;
  icon: string;
  count: number;
  muted: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border p-5"
      style={{
        marginTop: 20,
        background: muted ? "transparent" : "hsl(var(--card))",
        borderColor: "var(--color-border-soft)",
        opacity: muted ? 0.85 : 1,
      }}
    >
      <div
        className="row"
        style={{ gap: 8, marginBottom: 12, alignItems: "center" }}
      >
        <Icon name={icon} size={13} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.02em" }}>
          {title}
        </span>
        <span
          className="badge muted"
          style={{ fontSize: 10, padding: "1px 6px" }}
        >
          {count}
        </span>
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div
      className="muted"
      style={{
        fontSize: 12,
        padding: "16px 0",
        textAlign: "center",
        fontStyle: "italic",
      }}
    >
      {text}
    </div>
  );
}

function ShortlistCard({
  caseId,
  finding,
  linkCount,
  variant,
}: {
  caseId: string;
  finding: {
    id: string;
    platform: string;
    identifier_value: string;
    status: string;
    source_tool?: string;
    extra_metadata: Record<string, unknown>;
  };
  linkCount: number;
  variant: "curated" | "enriched";
}) {
  const meta = (finding.extra_metadata || {}) as Record<string, unknown>;
  const extra = (meta.extra as Record<string, unknown>) || {};
  const avatar =
    (meta.media as Record<string, unknown>)?.avatar ??
    (extra.og_image as string) ??
    null;
  const displayName =
    (extra.display_name as string) ??
    (extra.fullname as string) ??
    (extra.name as string) ??
    null;
  const bio = (extra.bio as string) ?? (extra.description as string) ?? null;
  const emails = (extra.emails_in_page as string) ?? "";

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        background: "hsl(var(--muted) / 0.3)",
        borderColor: variant === "curated" ? "hsl(38 95% 53% / 0.35)" : "var(--color-border-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {/* Card header */}
      <div className="row" style={{ gap: 10, alignItems: "center" }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatar}
            alt=""
            width={36}
            height={36}
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
              background: "var(--color-muted)",
            }}
          />
        ) : (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: "hsl(var(--accent) / 0.15)",
              color: "var(--color-accent)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {(displayName || finding.platform).slice(0, 2).toUpperCase()}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            className="row"
            style={{ gap: 6, alignItems: "center" }}
          >
            {displayName && displayName !== finding.identifier_value && (
              <span style={{ fontSize: 14, fontWeight: 600 }}>{displayName}</span>
            )}
            <StatusBadge status={finding.status} />
            {variant === "curated" && (
              <span
                className="badge"
                style={{
                  fontSize: 9,
                  padding: "1px 5px",
                  background: "hsl(38 95% 53% / 0.15)",
                  color: "hsl(38 95% 53%)",
                  border: "1px solid hsl(38 95% 53% / 0.35)",
                }}
              >
                <Icon name="star" size={9} fill="currentColor" /> curated
              </span>
            )}
            {finding.source_tool === "firecrawl" && (
              <span
                className="badge"
                style={{
                  fontSize: 9,
                  padding: "1px 5px",
                  background: "hsl(var(--cyan) / 0.12)",
                  color: "var(--color-cyan)",
                  border: "1px solid hsl(var(--cyan) / 0.3)",
                }}
              >
                <Icon name="link" size={9} /> enriched
              </span>
            )}
          </div>
          <div
            className="row"
            style={{ gap: 6, marginTop: 2, fontSize: 11 }}
          >
            <span style={{ fontWeight: 600 }}>{finding.platform}</span>
            <span className="muted mono" style={{ fontSize: 10.5, wordBreak: "break-all" }}>
              {finding.identifier_value}
            </span>
          </div>
        </div>
      </div>

      {/* Bio / preview */}
      {bio && (
        <div
          className="muted"
          style={{
            fontSize: 11.5,
            fontStyle: "italic",
            lineHeight: 1.4,
            padding: "8px 0 0",
            borderTop: "1px solid var(--color-border-soft)",
          }}
        >
          {bio.length > 220 ? `${bio.slice(0, 220)}…` : bio}
        </div>
      )}

      {/* Quick stats */}
      <div
        className="row"
        style={{ gap: 12, flexWrap: "wrap", fontSize: 11, color: "var(--color-foreground)" }}
      >
        {emails && (
          <div className="row" style={{ gap: 4, alignItems: "center" }}>
            <Icon name="mail" size={10} style={{ color: "var(--color-cyan)" }} />
            <span className="mono" style={{ fontSize: 10.5 }}>
              {emails.split(",")[0].trim()}
              {emails.split(",").length > 1 ? ` +${emails.split(",").length - 1}` : ""}
            </span>
          </div>
        )}
        {linkCount > 0 && (
          <div className="row" style={{ gap: 4, alignItems: "center" }}>
            <Icon name="branch" size={10} style={{ color: "var(--color-accent)" }} />
            <span style={{ fontSize: 10.5 }}>linked to {linkCount}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div
        className="row"
        style={{ gap: 6, marginTop: 4 }}
      >
        <Link
          href={`/case/${caseId}/investigate/${finding.id}`}
          className="secondary"
          style={{
            fontSize: 11,
            padding: "5px 10px",
            textDecoration: "none",
          }}
        >
          <Icon name="search" size={10} style={{ marginRight: 4, verticalAlign: "-1px" }} />
          Investigate →
        </Link>
        {finding.extra_metadata?.url && (
          <a
            href={finding.extra_metadata.url as string}
            target="_blank"
            rel="noopener noreferrer"
            className="ghost"
            style={{ fontSize: 11, padding: "5px 10px", textDecoration: "none" }}
          >
            <Icon name="external" size={10} style={{ marginRight: 4, verticalAlign: "-1px" }} />
            Profile
          </a>
        )}
      </div>
    </div>
  );
}
