"use client";
/** The right-hand "go deeper" panel on the deep-investigation page.
 *  Shows the pivot chain (emails / handles / URLs) extracted from the
 *  focused finding, with one-click actions that scan each pivot and
 *  merge results into the CURRENT case (no new case). Also offers
 *  suggest-variations with per-variation manual link UI, a manual search
 *  box, and live correlation count.
 *
 *  Note: "Enrich" is intentionally NOT here — it lives on the case
 *  investigation page, where you can fire it on any finding. Stage 2 is
 *  about pivots + manual link, not scraping. */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { scanUsername, scanEmail, getVariations, curateFinding, createManualLink } from "@/lib/api";
import type { Finding, Correlation, Identifier } from "@/lib/api";
import { Icon } from "../../../../_components/icon";

const PIVOT_FIELDS_EMAIL = ["email", "business_email", "gravatar_email", "emails_in_page"] as const;
const PIVOT_FIELDS_URL = [
  "website",
  "external_url",
  "links",
  "blog",
  "url",
  "channel_url",
  "urls_in_page",
] as const;
const HANDLE_KEY_MAP: Record<string, string> = {
  twitter: "twitter",
  twitter_username: "twitter",
  github: "github",
  instagram: "instagram",
  youtube: "youtube",
  tiktok: "tiktok",
  linkedin: "linkedin",
};

function extractEmails(f: Finding): string[] {
  const meta = (f.extra_metadata || {}) as Record<string, unknown>;
  const extra = (meta.extra as Record<string, unknown>) || {};
  const out = new Set<string>();
  for (const field of PIVOT_FIELDS_EMAIL) {
    const v = extra[field];
    if (typeof v === "string") {
      for (const e of v.split(/[,\s]+/)) {
        const t = e.trim().toLowerCase();
        if (t.includes("@")) out.add(t);
      }
    }
  }
  return [...out];
}

function extractUrls(f: Finding): string[] {
  const meta = (f.extra_metadata || {}) as Record<string, unknown>;
  const extra = (meta.extra as Record<string, unknown>) || {};
  const out = new Set<string>();
  for (const field of PIVOT_FIELDS_URL) {
    const v = extra[field];
    if (typeof v === "string") {
      for (const u of v.split(/[,\s]+/)) {
        const t = u.trim();
        if (t.startsWith("http")) out.add(t.replace(/[.,;:!?)>'"]+$/, ""));
      }
    }
  }
  return [...out];
}

function extractHandles(f: Finding): { platform: string; handle: string }[] {
  const meta = (f.extra_metadata || {}) as Record<string, unknown>;
  const extra = (meta.extra as Record<string, unknown>) || {};
  const out: { platform: string; handle: string }[] = [];
  for (const [field, plat] of Object.entries(HANDLE_KEY_MAP)) {
    const v = extra[field];
    if (typeof v === "string" && v.trim()) {
      out.push({ platform: plat, handle: v.trim().replace(/^@/, "") });
    }
  }
  return out;
}

/** Stable display label for a finding: "<platform>: <identifier>" with the
 *  display name added when it differs from the identifier. */
function findingLabel(f: Finding): string {
  const meta = (f.extra_metadata || {}) as Record<string, unknown>;
  const extra = (meta.extra as Record<string, unknown>) || {};
  const dn =
    (typeof extra.display_name === "string" && extra.display_name.trim()) ||
    (typeof extra.fullname === "string" && extra.fullname.trim()) ||
    (typeof extra.name === "string" && extra.name.trim()) ||
    "";
  if (dn && dn.toLowerCase() !== f.identifier_value.toLowerCase()) {
    return `${dn} (${f.platform}: ${f.identifier_value})`;
  }
  return `${f.platform}: ${f.identifier_value}`;
}

export function InvestigateActions({
  caseId,
  finding,
  caseIdentifiers,
  myCorrelations,
  linkedFindings,
  totalFindings,
  allFindings,
}: {
  caseId: string;
  finding: Finding;
  caseIdentifiers: Identifier[];
  myCorrelations: Correlation[];
  linkedFindings: Finding[];
  totalFindings: number;
  allFindings: Finding[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [variations, setVariations] = useState<string[] | null>(null);
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [curated, setCurated] = useState(false);
  /** When the user opens the "link to" picker for a given variation,
   *  we hold the variation string here. Clicking a finding closes the
   *  picker and fires createManualLink. */
  const [linkingVariation, setLinkingVariation] = useState<string | null>(null);
  /** Per-variation "linked" tracker so we can show a check after a
   *  successful manual link without reloading. */
  const [linkedVariations, setLinkedVariations] = useState<Set<string>>(
    () => new Set(),
  );
  /** Track every variation we've already loaded (across all "Get 5 more"
   *  clicks in this session). Sent back to the backend as `exclude` so
   *  each rerun returns fresh variations instead of the same 5. Lives
   *  in a ref so it survives StrictMode double-render and we always
   *  read the latest value from inside the async function. */
  const seenVariationsRef = useRef<Set<string>>(new Set());

  const emails = extractEmails(finding);
  const urls = extractUrls(finding);
  const handles = extractHandles(finding);
  const pivotsCount = emails.length + urls.length + handles.length;

  // Findings eligible for manual link from this page: every other finding
  // in the case. Filter out the current one (no self-link) and de-dupe
  // by id. Sort by platform then identifier for stable browsing.
  const linkable = (allFindings ?? [])
    .filter((f) => f.id !== finding.id)
    .slice()
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.identifier_value.localeCompare(b.identifier_value));

  async function scanEmailHere(email: string) {
    if (busy) return;
    setBusy(`email:${email}`);
    setErr(null);
    try {
      await scanEmail(caseId, email);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function scanHandleHere(handle: string) {
    if (busy) return;
    setBusy(`handle:${handle}`);
    setErr(null);
    try {
      await scanUsername(caseId, handle);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function suggestVariations() {
    if (busy || variationsLoading) return;
    setVariationsLoading(true);
    setErr(null);
    try {
      // Send the variations we've already shown so the backend returns
      // *new* ones. The 5 default is fine — repeated clicks keep widening
      // the pool until the transformation space is exhausted.
      const exclude = [...seenVariationsRef.current];
      const r = await getVariations(caseId, 5, exclude);
      const flat: string[] = [];
      for (const vs of Object.values(r.variations)) flat.push(...vs);
      for (const v of flat) seenVariationsRef.current.add(v);
      setVariations((prev) => (prev ? [...prev, ...flat] : flat));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVariationsLoading(false);
    }
  }

  async function toggleCurated() {
    setCurated((v) => !v);
    try {
      await curateFinding(caseId, finding.id, !curated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setCurated((v) => !v);
    }
  }

  async function linkVariationTo(variation: string, targetFinding: Finding) {
    if (busy) return;
    setBusy(`link:${variation}`);
    setErr(null);
    try {
      await createManualLink(
        caseId,
        finding.id,
        targetFinding.id,
        `variation "${variation}" linked to ${targetFinding.platform}:${targetFinding.identifier_value}`,
      );
      setLinkedVariations((s) => new Set(s).add(variation));
      setLinkingVariation(null);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: "hsl(var(--card))",
        borderColor: "var(--color-border-soft)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Summary stats */}
      <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
        <Stat label="Pivots" value={pivotsCount} hint="emails + URLs + handles" />
        <Stat label="Linked" value={linkedFindings.length} hint="correlated findings" />
        <Stat label="Case total" value={totalFindings} hint="findings" />
      </div>

      {/* Manual search — add a new identifier (username / email) to this case.
          The investigator decides what to search, not the LLM. We put this
          near the top so the search option is always one click away. */}
      <div>
        <SectionTitle icon="search" label="Search another profile" />
        <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>
          Manually add a related username or email — scan runs against 280 platforms
          and merges findings into this same case. Auto-detects email vs handle.
        </div>
        <ManualSearchBox
          onScan={async (value, kind) => {
            if (kind === "email") {
              await scanEmailHere(value);
            } else {
              await scanHandleHere(value);
            }
          }}
          busy={busy !== null}
        />
      </div>

      {/* Quick actions (no enrich here — that's on the case page) */}
      <div>
        <SectionTitle icon="zap" label="Quick actions" />
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <ActionButton
            icon="sparkles"
            label={variations ? "Get 5 more variations" : "Suggest name variations"}
            onClick={suggestVariations}
            busy={variationsLoading}
            title={
              variations
                ? "Ask the LLM for 5 MORE close variations (already-shown ones are sent back as 'seen' so you don't get duplicates)"
                : "LLM-pick 5 close variations of the case's subject identifier"
            }
          />
          <ActionButton
            icon={curated ? "star-filled" : "star"}
            label={curated ? "Remove from shortlist" : "Add to shortlist"}
            onClick={toggleCurated}
            busy={false}
            title="Mark this finding for follow-up — see it in the Curated quick filter"
            variant={curated ? "active" : "default"}
          />
        </div>
      </div>

      {/* Suggested name variations — the heart of Stage 2's manual review.
          Each variation is a username/handle LLM thinks might be the same
          person. For each one the user can:
            - Scan: kick off a scan for that handle, creating a new finding
            - Link to: pick an EXISTING finding in the case that the user
                       has eyeballed as the same person — we create a
                       manual correlation with the variation as the note.
          The user is in charge: nothing happens until they click. */}
      {variations && variations.length > 0 && (
        <div>
          <SectionTitle
            icon="users"
            label={`${variations.length} name variation${variations.length === 1 ? "" : "s"} suggested`}
          />
          <div className="muted" style={{ fontSize: 10.5, marginBottom: 8, lineHeight: 1.5 }}>
            LLM-suggested handles the same person might use. Click <strong>Scan</strong> to add
            it as a new finding, or <strong>Link to…</strong> to manually mark it as the
            same person as a profile you already see in this case.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {variations.map((v) => {
              const isLinked = linkedVariations.has(v);
              const pickerOpen = linkingVariation === v;
              const linkingBusy = busy === `link:${v}`;
              return (
                <div
                  key={v}
                  className="rounded-md border"
                  style={{
                    background: isLinked
                      ? "hsl(var(--accent) / 0.06)"
                      : "hsl(var(--muted) / 0.4)",
                    borderColor: isLinked
                      ? "hsl(var(--accent) / 0.35)"
                      : "var(--color-border-soft)",
                    padding: 8,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div className="row" style={{ gap: 8, alignItems: "center" }}>
                    <Icon name="at" size={11} style={{ color: "var(--color-accent)" }} />
                    <span className="mono" style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 0, wordBreak: "break-all" }}>
                      {v}
                    </span>
                    {isLinked && (
                      <span
                        className="badge"
                        style={{
                          fontSize: 9,
                          padding: "1px 5px",
                          background: "hsl(var(--accent) / 0.15)",
                          color: "var(--color-accent)",
                          border: "1px solid hsl(var(--accent) / 0.35)",
                        }}
                      >
                        <Icon name="check" size={9} /> linked
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => scanHandleHere(v)}
                      disabled={busy !== null}
                      className="secondary"
                      style={{ fontSize: 10, padding: "3px 8px", opacity: busy === `handle:${v}` ? 0.6 : 1 }}
                      title={`Scan "${v}" as a username and add to this case`}
                    >
                      {busy === `handle:${v}` ? (
                        <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} />
                      ) : (
                        <Icon name="search" size={9} />
                      )}
                      Scan
                    </button>
                    <button
                      type="button"
                      onClick={() => setLinkingVariation(pickerOpen ? null : v)}
                      disabled={busy !== null}
                      className={pickerOpen ? "" : "ghost"}
                      style={{ fontSize: 10, padding: "3px 8px" }}
                      title="Pick an existing finding in this case that this variation represents"
                    >
                      <Icon name="link" size={9} />
                      {pickerOpen ? "Cancel" : "Link to…"}
                    </button>
                  </div>
                  {pickerOpen && (
                    <div
                      className="rounded-md border"
                      style={{
                        background: "hsl(var(--card))",
                        borderColor: "var(--color-border-soft)",
                        padding: 6,
                        maxHeight: 240,
                        overflowY: "auto",
                      }}
                    >
                      <div className="muted" style={{ fontSize: 10, marginBottom: 4, padding: "2px 4px" }}>
                        Pick the existing finding that <span className="mono">{v}</span> is the same person as:
                      </div>
                      {linkable.length === 0 ? (
                        <div className="muted" style={{ fontSize: 11, padding: 8 }}>
                          No other findings in this case yet. Use <strong>Scan</strong> to add one first.
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          {linkable.slice(0, 40).map((other) => (
                            <button
                              key={other.id}
                              type="button"
                              onClick={() => linkVariationTo(v, other)}
                              disabled={linkingBusy}
                              className="row"
                              style={{
                                fontSize: 11,
                                padding: "4px 8px",
                                background: "transparent",
                                border: "1px solid transparent",
                                borderRadius: 4,
                                textAlign: "left",
                                gap: 8,
                                cursor: linkingBusy ? "wait" : "pointer",
                                color: "var(--color-foreground)",
                                opacity: linkingBusy ? 0.6 : 1,
                              }}
                              onMouseEnter={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "hsl(var(--muted) / 0.6)";
                              }}
                              onMouseLeave={(e) => {
                                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                              }}
                              title={`Link ${v} → ${other.platform}: ${other.identifier_value}`}
                            >
                              <span
                                className="mono"
                                style={{ fontSize: 9, fontWeight: 600, opacity: 0.7, minWidth: 64, flexShrink: 0 }}
                              >
                                {other.platform}
                              </span>
                              <span className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>
                                {findingLabel(other)}
                              </span>
                              {linkingBusy && (
                                <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} />
                              )}
                            </button>
                          ))}
                          {linkable.length > 40 && (
                            <div className="muted" style={{ fontSize: 10, padding: 6 }}>
                              + {linkable.length - 40} more — narrow the case to see them
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state — no variations loaded yet */}
      {variations === null && !variationsLoading && (
        <div
          className="hint"
          style={{ fontSize: 12, flexDirection: "column", alignItems: "flex-start", gap: 6 }}
        >
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <Icon name="users" size={12} />
            <strong>Suggested name variations not loaded yet.</strong>
          </div>
          <div className="muted" style={{ lineHeight: 1.5 }}>
            Click <strong>Suggest name variations</strong> above to have the LLM pick 5 close
            handles, then for each one you can scan it or manually link it to an existing
            profile in the case.
          </div>
        </div>
      )}

      {/* Emails */}
      {emails.length > 0 && (
        <PivotSection
          icon="mail"
          label={`${emails.length} email${emails.length === 1 ? "" : "s"} found`}
          hint="click to scan this address across 280 platforms + Gravatar"
        >
          {emails.map((email) => (
            <PivotChip
              key={email}
              value={email}
              kind="email"
              onClick={() => scanEmailHere(email)}
              busy={busy === `email:${email}`}
            />
          ))}
        </PivotSection>
      )}

      {/* Handles */}
      {handles.length > 0 && (
        <PivotSection
          icon="at"
          label={`${handles.length} handle${handles.length === 1 ? "" : "s"} found`}
          hint="click to scan this handle across 280 platforms"
        >
          {handles.map((h) => (
            <PivotChip
              key={`${h.platform}-${h.handle}`}
              value={`${h.platform}:${h.handle}`}
              kind="handle"
              onClick={() => scanHandleHere(h.handle)}
              busy={busy === `handle:${h.handle}`}
            />
          ))}
        </PivotSection>
      )}

      {/* URLs */}
      {urls.length > 0 && (
        <PivotSection
          icon="link"
          label={`${urls.length} URL${urls.length === 1 ? "" : "s"} found`}
          hint="click to visit, or right-click to copy"
        >
          {urls.slice(0, 8).map((u) => (
            <a
              key={u}
              href={u}
              target="_blank"
              rel="noopener noreferrer"
              className="mono"
              style={{
                fontSize: 11,
                padding: "4px 10px",
                background: "hsl(var(--muted) / 0.5)",
                border: "1px solid var(--color-border-soft)",
                borderRadius: 4,
                color: "var(--color-foreground)",
                textDecoration: "none",
                maxWidth: 240,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={u}
            >
              {u.replace(/^https?:\/\//, "").slice(0, 32)}
            </a>
          ))}
          {urls.length > 8 && (
            <span className="muted" style={{ fontSize: 11 }}>
              + {urls.length - 8} more
            </span>
          )}
        </PivotSection>
      )}

      {/* Empty state — no pivots extracted */}
      {pivotsCount === 0 && (
        <div className="hint" style={{ fontSize: 12 }}>
          <Icon name="info" size={12} />
          No emails / handles / URLs were extracted from this account yet.
          Use <strong>Enrich</strong> on the case page to scrape the public
          page and pull pivots out of the markdown.
        </div>
      )}

      {/* Error */}
      {err && (
        <div
          className="hint"
          style={{ borderLeftColor: "var(--color-destructive)", fontSize: 12 }}
        >
          <Icon name="warning" size={12} /> {err}
        </div>
      )}

      {/* Correlations summary */}
      {myCorrelations.length > 0 && (
        <div>
          <SectionTitle icon="branch" label="Why this is linked" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {myCorrelations.slice(0, 5).map((co) => (
              <div
                key={co.id}
                className="row"
                style={{
                  fontSize: 11.5,
                  padding: "6px 10px",
                  background: "hsl(var(--muted) / 0.5)",
                  borderRadius: 4,
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <span
                  className="badge info"
                  style={{ fontSize: 9, padding: "1px 5px" }}
                >
                  {co.type}
                </span>
                <span className="muted">conf {(co.confidence * 100).toFixed(0)}%</span>
                {Array.isArray(co.evidence) && co.evidence.length > 0 && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    {co.evidence[0]}
                  </span>
                )}
              </div>
            ))}
            {myCorrelations.length > 5 && (
              <div className="muted" style={{ fontSize: 11 }}>
                + {myCorrelations.length - 5} more correlations on the case page
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
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
        style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: "var(--color-accent)" }}
      >
        {value}
      </div>
      <div className="muted" style={{ fontSize: 10.5 }}>
        {hint}
      </div>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <div
      className="row"
      style={{ gap: 6, marginBottom: 8, alignItems: "center" }}
    >
      <Icon name={icon} size={11} />
      <span
        style={{
          fontSize: 10.5,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          opacity: 0.7,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  busy,
  title,
  variant = "default",
}: {
  icon: string;
  label: string;
  onClick: () => void;
  busy: boolean;
  title: string;
  variant?: "default" | "active";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={title}
      className={variant === "active" ? "" : "secondary"}
      style={{
        fontSize: 11,
        padding: "5px 10px",
        opacity: busy ? 0.6 : 1,
        background: variant === "active" ? "hsl(38 95% 53% / 0.15)" : undefined,
        color: variant === "active" ? "hsl(38 95% 53%)" : undefined,
        border: variant === "active" ? "1px solid hsl(38 95% 53% / 0.35)" : undefined,
      }}
    >
      {busy ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : <Icon name={icon} size={11} />}
      {label}
    </button>
  );
}

function PivotSection({
  icon,
  label,
  hint,
  children,
}: {
  icon: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <SectionTitle icon={icon} label={label} />
      <div className="muted" style={{ fontSize: 10.5, marginBottom: 6 }}>
        {hint}
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function PivotChip({
  value,
  kind,
  onClick,
  busy,
}: {
  value: string;
  kind: "email" | "handle";
  onClick: () => void;
  busy: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={`Scan ${value} and merge findings into this case`}
      className="mono pivot-chip"
      style={{
        fontSize: 11,
        padding: "4px 10px",
        background: "hsl(var(--muted) / 0.6)",
        border: "1px solid var(--color-border-soft)",
        borderRadius: 4,
        color: "var(--color-foreground)",
        cursor: busy ? "wait" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      {busy ? <span className="spinner" style={{ width: 8, height: 8, borderWidth: 1.5 }} /> : <Icon name={kind === "email" ? "mail" : "at"} size={10} />}
      {value}
    </button>
  );
}

/** Manual search box — let the investigator type a username or email
 *  to add to the case as a new scan. Auto-detects which kind. */
function ManualSearchBox({
  onScan,
  busy,
}: {
  onScan: (value: string, kind: "username" | "email") => void | Promise<void>;
  busy: boolean;
}) {
  const [val, setVal] = useState("");
  const kind: "username" | "email" = val.includes("@") ? "email" : "username";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = val.trim();
        if (!v || busy) return;
        onScan(v, kind);
        setVal("");
      }}
      className="row"
      style={{ gap: 6 }}
    >
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={kind === "email" ? "e.g. someone@gmail.com" : "e.g. octocat_dev"}
        aria-label="Username or email to scan"
        className="mono"
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12,
          padding: "6px 10px",
          background: "hsl(var(--muted) / 0.5)",
          border: "1px solid var(--color-border-soft)",
          borderRadius: 4,
          color: "var(--color-foreground)",
        }}
      />
      <button
        type="submit"
        disabled={busy || !val.trim()}
        className="secondary"
        style={{ fontSize: 11, padding: "6px 12px" }}
        title={`Scan this ${kind} and merge findings into the case`}
      >
        {busy ? <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : <Icon name={kind === "email" ? "mail" : "at"} size={11} />}
        Add {kind}
      </button>
    </form>
  );
}
