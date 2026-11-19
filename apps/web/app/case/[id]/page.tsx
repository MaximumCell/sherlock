import { notFound } from "next/navigation";
import Link from "next/link";
import { getCase, listFindings, listCorrelations } from "@/lib/api";
import { Icon } from "../../_components/icon";
import { StatusBadge } from "../../_components/status-badge";
import { InvestigationPanel } from "./investigation-panel";

// Live data from the FastAPI backend — never prerender.
export const dynamic = "force-dynamic";

const TYPE_ICONS: Record<string, "at" | "mail" | "link"> = {
  username: "at",
  email: "mail",
  domain: "link",
};

const TYPE_LABELS: Record<string, string> = {
  username: "username",
  email: "email",
  domain: "domain",
};

export default async function CasePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const initialJobId = typeof sp.job === "string" && sp.job ? sp.job : null;

  let c;
  try {
    c = await getCase(id);
  } catch {
    notFound();
  }
  const [findings, corrs] = await Promise.all([
    listFindings(id).catch(() => []),
    listCorrelations(id).catch(() => []),
  ]);

  // counts
  const countFound = findings.filter((f) => f.status === "found").length;
  const countNotFound = findings.filter((f) => f.status === "not_found").length;
  const countError = findings.filter((f) => f.status === "error").length;
  const foundPlatforms = new Set(
    findings.filter((f) => f.status === "found").map((f) => f.platform),
  );
  const reviewed = corrs.filter((c) => c.reviewed).length;
  const unreviewed = corrs.length - reviewed;
  const subject = c.identifiers[0]?.value ?? id;
  const subjectType = c.identifiers[0]?.type ?? "username";

  return (
    <div>
      {/* SUBJECT HERO */}
      <section className="card-hero">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto",
            gap: 20,
            alignItems: "center",
          }}
        >
          {/* Subject avatar/icon */}
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 16,
              background: "linear-gradient(135deg, var(--color-accent-soft) 0%, var(--color-cyan-soft) 100%)",
              border: "1px solid var(--color-border-soft)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--color-accent)",
              boxShadow: "var(--shadow-glow)",
            }}
          >
            <Icon name={TYPE_ICONS[subjectType] ?? "at"} size={32} />
          </div>

          {/* Subject identity */}
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 6 }}>
              {c.identifiers.map((i, idx) => (
                <span
                  key={idx}
                  className="badge muted"
                  style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}
                >
                  <Icon name={TYPE_ICONS[i.type] ?? "at"} size={9} />
                  {TYPE_LABELS[i.type] ?? i.type}
                </span>
              ))}
              <StatusBadge status={c.status} />
            </div>
            <h1
              className="mono"
              style={{
                fontSize: 26,
                lineHeight: 1.15,
                margin: 0,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={subject}
            >
              {subject}
            </h1>
            {c.identifiers.length > 1 && (
              <div className="row" style={{ gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                {c.identifiers.slice(1).map((i, idx) => (
                  <code
                    key={idx}
                    style={{
                      fontSize: 11,
                      padding: "1px 6px",
                      background: "var(--color-muted)",
                      borderRadius: 3,
                    }}
                  >
                    {i.value}
                  </code>
                ))}
              </div>
            )}
            <div className="muted mono" style={{ fontSize: 11, marginTop: 6 }}>
              case <code style={{ background: "transparent", padding: 0 }}>{id.slice(0, 8)}</code>
              <span style={{ margin: "0 8px" }}>·</span>
              created {new Date(c.created_at).toLocaleString()}
            </div>
          </div>

          {/* Primary actions */}
          <div className="row" style={{ gap: 8, flexShrink: 0 }}>
            <Link href={`/review/${id}`} className="btn secondary">
              <Icon name="check" size={13} />
              Review
              {unreviewed > 0 && (
                <span className="badge warn" style={{ marginLeft: 4, padding: "0 6px" }}>
                  {unreviewed}
                </span>
              )}
            </Link>
            <Link href={`/report/${id}`} className="btn secondary">
              <Icon name="report" size={13} />
              Report
            </Link>
          </div>
        </div>

        {/* Inline stats */}
        <div
          className="row"
          style={{
            gap: 0,
            marginTop: 20,
            borderTop: "1px solid var(--color-border-soft)",
            paddingTop: 18,
            justifyContent: "space-between",
          }}
        >
          <HeroStat
            label="Found"
            value={countFound}
            sub={foundPlatforms.size > 0 ? `${foundPlatforms.size} platform${foundPlatforms.size === 1 ? "" : "s"}` : "—"}
            color="var(--color-accent)"
            icon="check"
          />
          <HeroStat
            label="Not found"
            value={countNotFound}
            sub="tried"
            color="var(--color-foreground)"
            opacity={0.5}
            icon="circle-dot"
          />
          <HeroStat
            label="Errors"
            value={countError}
            sub="unreachable"
            color="var(--status-error-text)"
            icon="warning"
          />
          <HeroStat
            label="Correlations"
            value={corrs.length}
            sub={`${unreviewed} pending review`}
            color="var(--color-cyan)"
            icon="branch"
          />
          <HeroStat
            label="Total findings"
            value={findings.length}
            sub="across all platforms"
            color="var(--status-info-text)"
            icon="list"
          />
        </div>
      </section>

      {/* INVESTIGATION WORKBENCH */}
      <h2 style={{ margin: "32px 0 12px" }}>
        <Icon name="search" size={12} />
        Investigation workbench
      </h2>
      <InvestigationPanel
        caseId={c.id}
        findings={findings}
        correlations={corrs}
        identifiers={c.identifiers}
        initialJobId={initialJobId}
      />
    </div>
  );
}

function HeroStat({
  label,
  value,
  sub,
  color,
  opacity,
  icon,
}: {
  label: string;
  value: number;
  sub: string;
  color: string;
  opacity?: number;
  icon: "check" | "circle-dot" | "warning" | "branch" | "list";
}) {
  return (
    <div style={{ minWidth: 0, opacity }}>
      <div
        className="row"
        style={{ gap: 6, marginBottom: 4, alignItems: "center" }}
      >
        <span style={{ color, opacity: 0.85 }}>
          <Icon name={icon} size={12} />
        </span>
        <span
          style={{
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            opacity: 0.55,
          }}
        >
          {label}
        </span>
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          fontFamily: "var(--font-mono)",
          color,
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        {sub}
      </div>
    </div>
  );
}
