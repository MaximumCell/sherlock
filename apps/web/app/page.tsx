import { listCases } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import NewCaseForm from "./new-case-form";
import CaseCard from "./case-card";
import { Icon } from "./_components/icon";
import { Search, BarChart3, Layers } from "lucide-react";

// This page reads live data from the FastAPI backend, so it must be rendered
// per request. Without this, `next build` tries to prerender it during the
// static-generation pass and fails (no backend reachable at build time).
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ pivot?: string; type?: string }>;
}) {
  const cases = await listCases();
  const sp = await searchParams;
  const pivotValue = typeof sp.pivot === "string" ? sp.pivot : "";
  const pivotType: "username" | "email" | "domain" =
    sp.type === "email" || sp.type === "domain" ? sp.type : "username";

  // Derived stats for the strip
  const thisWeek = cases.filter(
    (c) => Date.now() - new Date(c.created_at).getTime() < 7 * 86400_000,
  ).length;
  const byType = cases.reduce<Record<string, number>>((acc, c) => {
    const t = c.identifiers[0]?.type ?? "unknown";
    acc[t] = (acc[t] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-16 sm:space-y-20">
      {/* ─────────────────────────── HERO ─────────────────────────── */}
      <section className="relative pt-4 sm:pt-8 pb-2">
        {/* Soft glow behind the headline — pure decoration */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        >
          <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[420px] w-[860px] rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr] gap-10 lg:gap-16 items-start">
          {/* Left: copy */}
          <div className="max-w-2xl pt-2 sm:pt-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.1em] text-cyan">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse-accent" />
              Open-source OSINT
            </div>

            <h1 className="mt-7 sm:mt-9 font-semibold leading-[0.95] tracking-[-0.04em] text-foreground text-[clamp(2.5rem,7vw,5rem)]">
              Investigate anyone,
              <br />
              <span className="text-accent">connect the dots</span>.
            </h1>

            <p className="mt-7 text-[15px] sm:text-base leading-[1.7] text-foreground/70 max-w-[560px]">
              Sweep public sources for any username, email, or domain.
              Correlate findings, surface pivots, and write a report — all in one workspace.
            </p>

            <ul className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-sm text-foreground/80">
              <li className="inline-flex items-center gap-2">
                <Icon name="check" size={14} style={{ color: "var(--color-accent)" }} />
                200+ platforms
              </li>
              <li className="inline-flex items-center gap-2">
                <Icon name="branch" size={14} style={{ color: "var(--color-cyan)" }} />
                8 correlation rules
              </li>
              <li className="inline-flex items-center gap-2">
                <Icon name="report" size={14} style={{ color: "var(--color-warning)" }} />
                LLM-narrated reports
              </li>
            </ul>
          </div>

          {/* Right: case-creation form in a soft glass card */}
          <div
            className="rounded-xl border border-border/50 bg-card/60 p-6 sm:p-7 backdrop-blur-sm"
            style={{ boxShadow: "var(--shadow-inset), 0 0 0 1px rgba(255,255,255,0.02)" }}
          >
            <div className="mb-5 flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/10 text-accent border border-accent/20">
                <Search className="h-3.5 w-3.5" />
              </div>
              <h2 className="text-sm font-semibold tracking-tight">Start a new investigation</h2>
            </div>
            <NewCaseForm
              initialValue={pivotValue}
              initialType={pivotType}
              pivoting={!!pivotValue}
            />
          </div>
        </div>
      </section>

      {/* ─────────────────────────── STATS STRIP ─────────────────────────── */}
      {cases.length > 0 && (
        <section>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            <StatTile
              label="Active cases"
              value={cases.length}
              icon={<Layers className="h-4 w-4" />}
              tone="info"
            />
            <StatTile
              label="This week"
              value={thisWeek}
              icon={<BarChart3 className="h-4 w-4" />}
              tone="cyan"
            />
            <StatTile
              label="Usernames"
              value={byType.username ?? 0}
              icon={<Icon name="at" size={14} />}
              tone="found"
            />
            <StatTile
              label="Emails"
              value={byType.email ?? 0}
              icon={<Icon name="mail" size={14} />}
              tone="found"
            />
          </div>
        </section>
      )}

      {/* ─────────────────────────── RECENT CASES ─────────────────────────── */}
      <section>
        <header className="mb-7 flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Recent cases</h2>
            <p className="mt-1.5 text-sm text-foreground/55">
              {cases.length === 0
                ? "Your investigations will appear here"
                : `${cases.length} ${cases.length === 1 ? "case" : "cases"} — click any to dive in`}
            </p>
          </div>
        </header>

        {cases.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}
          >
            {cases.map((c) => (
              <CaseCard key={c.id} caseRow={c} createdLabel={timeAgo(c.created_at)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Stat tile
// ────────────────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "info" | "found" | "cyan";
}) {
  const colorMap = {
    info: { text: "text-status-info", border: "before:bg-status-info-border" },
    found: { text: "text-status-found", border: "before:bg-status-found" },
    cyan: { text: "text-cyan", border: "before:bg-cyan" },
  } as const;
  const t = colorMap[tone];

  return (
    <div
      className={`relative rounded-lg border border-border/50 bg-card/60 p-4 sm:p-5 backdrop-blur-sm overflow-hidden stat-card ${t.border}`}
    >
      <div className="flex items-center gap-2 text-foreground/55">
        {icon}
        <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em]">
          {label}
        </span>
      </div>
      <div className={`mt-3 font-mono text-2xl sm:text-[28px] font-bold leading-none ${t.text}`}>
        {value}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty state
// ────────────────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/30 px-6 py-16 sm:py-20 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-accent/10 text-accent border border-accent/20">
        <Search className="h-7 w-7" />
      </div>
      <h3 className="mt-5 text-lg font-semibold tracking-tight">No cases yet</h3>
      <p className="mt-2 text-sm text-foreground/60 max-w-md mx-auto leading-relaxed">
        Spin up your first investigation above. Pick a username, email, or domain
        and let the collectors do the sweep.
      </p>
    </div>
  );
}
