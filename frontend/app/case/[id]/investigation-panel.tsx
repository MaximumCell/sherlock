"use client";
/** Investigation panel: search + tabs (Cards / Pivots / Graph / Findings / Correlations).
 * Designed for the case detail page. All data passed in as props from the Server Component.
 *
 * Filter system (sticky FilterBar above the tabs):
 *  - Status quick chips (Found / Not found / Errors) with live counts.
 *  - "More filters" popover: Platform / Source / Identifier type / Category / Location
 *    (all multi-checkbox with counts) plus "Has…" toggles for rich fields.
 *  - Sort dropdown + direction toggle.
 *  - Active filters shown as removable chips below the controls.
 *  - Density toggle (comfortable / compact) for the cards view.
 *  - Live selection summary ("12 findings · 5 platforms · 3 with location…").
 *  - All Findings table is now sortable by every column.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star, Sparkles, X, Users } from "lucide-react";
import { Icon } from "../../_components/icon";
import { StatusBadge } from "../../_components/status-badge";
import { FindingDetails, buildCrossLinks } from "../../_components/finding-details";
import {
  scanUsername, scanEmail, enrichFinding, getJob, curateFinding, enrichCurated,
  getVariations,
  type Job,
} from "@/lib/api";
import type { Finding, Correlation, Identifier } from "@/lib/api";

type Tab = "cards" | "pivots" | "graph" | "findings" | "correlations";

type Status = "found" | "not_found" | "error";
type SortKey = "status" | "platform" | "identifier" | "display_name" | "recent";
type DensityMode = "comfortable" | "compact";
type HasFlag =
  | "avatar"
  | "display_name"
  | "bio"
  | "email"
  | "website"
  | "links"
  | "location"
  | "company"
  | "verified"
  | "private"
  | "pivots";

const HAS_FLAGS: { id: HasFlag; label: string; icon: "image" | "user" | "info" | "mail" | "link" | "pin" | "check" | "tag" | "branch" }[] = [
  { id: "avatar", label: "Avatar", icon: "image" },
  { id: "display_name", label: "Display name", icon: "user" },
  { id: "bio", label: "Bio", icon: "info" },
  { id: "email", label: "Email", icon: "mail" },
  { id: "website", label: "Website", icon: "link" },
  { id: "links", label: "Links", icon: "link" },
  { id: "location", label: "Location", icon: "pin" },
  { id: "company", label: "Company", icon: "tag" },
  { id: "verified", label: "Verified", icon: "check" },
  { id: "private", label: "Private", icon: "info" },
  { id: "pivots", label: "Pivots", icon: "branch" },
];

interface Props {
  caseId: string;
  findings: Finding[];
  correlations: Correlation[];
  identifiers: Identifier[];
  /** Job to poll on mount — used when the case was just created from the
   *  home form so the user lands on a page that's already scanning. */
  initialJobId?: string | null;
}

const TABS: { id: Tab; label: string; icon: "list" | "branch" | "info" | "check" }[] = [
  { id: "cards", label: "Connected accounts", icon: "check" },
  { id: "pivots", label: "Pivots", icon: "branch" },
  { id: "graph", label: "Graph", icon: "info" },
  { id: "findings", label: "All findings", icon: "list" },
  { id: "correlations", label: "Correlations", icon: "info" },
];

const STATUS_RANK: Record<string, number> = { found: 0, not_found: 1, error: 2 };

export function InvestigationPanel({ caseId, findings, correlations, identifiers, initialJobId }: Props) {
  const router = useRouter();
  // Default tab: "pivots" for email-only cases (no rich profile data on the
  // "connected accounts" tab), "cards" for username/email+username cases.
  const hasEmail = identifiers.some((i) => i.type === "email");
  const hasUsername = identifiers.some((i) => i.type === "username");
  const defaultTab: Tab = hasEmail && !hasUsername ? "pivots" : "cards";
  const [tab, setTab] = useState<Tab>(defaultTab);
  const [query, setQuery] = useState("");
  const [pivotFilter, setPivotFilter] = useState<string | null>(null);
  const [scanning, setScanning] = useState<string | null>(null);
  const [scanErr, setScanErr] = useState<string | null>(null);
  const [lastScanResult, setLastScanResult] = useState<{ scanned: string; type: string; findings_added: number; correlations_total: number } | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  // Related profiles (LLM-picked close variations) — like Instagram's
  // "related accounts" row, but as pivots instead of profiles to follow.
  const [relatedVars, setRelatedVars] = useState<{ value: string; type: "username" | "email" }[] | null>(null);
  // Variants the user has already seen in THIS session. We send this set
  // back to the backend on "Get 5 more" so each rerun returns fresh ones
  // instead of the same 5 (the backend uses it to nudge the LLM and to
  // filter dedup). Persisted across renders in a ref so it survives
  // StrictMode double-render and the component being recreated.
  const seenVariantsRef = useRef<Set<string>>(new Set());
  const [relatedBusy, setRelatedBusy] = useState(false);
  const [relatedErr, setRelatedErr] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enriching, setEnriching] = useState<string | null>(null);
  const [enrichErr, setEnrichErr] = useState<string | null>(null);

  // -- Curation state (shortlist) --
  // Set of finding IDs the investigator has starred. Optimistic — the
  // server is the source of truth on next refetch.
  const [curatedIds, setCuratedIds] = useState<Set<string>>(
    () => new Set(findings.filter((f) => f.curated).map((f) => f.id)),
  );
  const [enrichCuratedBusy, setEnrichCuratedBusy] = useState(false);
  const [enrichCuratedErr, setEnrichCuratedErr] = useState<string | null>(null);
  const [curatedOnly, setCuratedOnly] = useState(false);
  const [scrapedOnly, setScrapedOnly] = useState(false);

  // -- Filter state --
  const [statuses, setStatuses] = useState<Set<Status>>(new Set());
  const [platforms, setPlatforms] = useState<Set<string>>(new Set());
  const [sources, setSources] = useState<Set<string>>(new Set());
  const [idTypes, setIdTypes] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<Set<string>>(new Set());
  const [locations, setLocations] = useState<Set<string>>(new Set());
  const [hasFlags, setHasFlags] = useState<Set<HasFlag>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [density, setDensity] = useState<DensityMode>("comfortable");

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  // If the user just created this case from the home form, the form kicked off
  // a scan and passed the job_id in ?job=. Start polling it on mount so the
  // user lands on a page that's already mid-investigation.
  useEffect(() => {
    if (initialJobId) {
      setScanning(`auto:${initialJobId}`);
      pollJob(initialJobId, `auto:${initialJobId}`);
    }
    // We only want to do this on first mount — not re-fire if initialJobId
    // changes (it won't, but be explicit).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJobId]);

  async function runScan(value: string, kind: "username" | "email") {
    const v = value.trim();
    if (!v) return;
    if (kind === "email" && !v.includes("@")) {
      setScanErr("not a valid email address");
      return;
    }
    const key = `${kind}:${v}`;
    setScanning(key);
    setScanErr(null);
    setLastScanResult(null);
    try {
      const queued = kind === "username" ? await scanUsername(caseId, v) : await scanEmail(caseId, v);
      setActiveJob({
        id: queued.job_id,
        case_id: caseId,
        kind: `scan_${kind}`,
        target: queued.scanned,
        status: "running",
        started_at: Date.now() / 1000,
        finished_at: null,
        elapsed_s: 0,
        result: null,
        error: null,
      });
      pollJob(queued.job_id, key);
    } catch (e) {
      setScanErr(e instanceof Error ? e.message : String(e));
      setScanning(null);
    }
  }

  function pollJob(jobId: string, scanKey: string) {
    const tick = async () => {
      try {
        const job = await getJob(caseId, jobId);
        setActiveJob(job);
        if (job.status === "completed") {
          setLastScanResult(job.result || null);
          setScanning(null);
          setActiveJob(null);
          router.refresh();
          return;
        }
        if (job.status === "failed") {
          setScanErr(job.error || "scan failed");
          setScanning(null);
          setActiveJob(null);
          return;
        }
        pollRef.current = setTimeout(tick, 2000);
      } catch (e) {
        setScanErr(e instanceof Error ? e.message : String(e));
        setScanning(null);
        setActiveJob(null);
      }
    };
    pollRef.current = setTimeout(tick, 1500);
  }

  async function loadRelated() {
    if (relatedBusy) return;
    setRelatedBusy(true);
    setRelatedErr(null);
    try {
      // Send the variants we've already shown so the backend can return
      // *new* ones. The 5 default is fine — if the user wants more, they
      // click the button again and we keep widening the pool.
      const exclude = [...seenVariantsRef.current];
      const r = await getVariations(caseId, 5, exclude);
      // Flatten to [{value, type}] for uniform rendering.
      const flat: { value: string; type: "username" | "email" }[] = [];
      for (const [k, vs] of Object.entries(r.variations)) {
        const t = (k === "email" ? "email" : "username") as "username" | "email";
        for (const v of vs) flat.push({ value: v, type: t });
      }
      // Record everything we just got as seen, then append to the existing
      // list. If this is the first call (relatedVars null), just use the
      // new list. Otherwise append so the user can build up a working set
      // of variations without losing the ones already shown.
      for (const f of flat) seenVariantsRef.current.add(f.value);
      setRelatedVars((prev) => (prev ? [...prev, ...flat] : flat));
    } catch (e) {
      setRelatedErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRelatedBusy(false);
    }
  }

  async function scanRelated(value: string, type: "username" | "email") {
    // Reuse the manual-scan path. It sets scanning state + opens the job
    // indicator; user sees the live progress in the existing scan panel.
    await runScan(value, type);
  }

  async function runEnrich(findingId: string) {
    try {
      await enrichFinding(caseId, findingId);
      router.refresh();
    } catch (e) {
      setEnrichErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEnriching(null);
    }
  }

  // Toggle curation on a single finding. Optimistic — flip the local set
  // immediately, then sync to the server. On error, revert.
  async function toggleCurate(findingId: string, next: boolean) {
    const prev = new Set(curatedIds);
    const nextSet = new Set(curatedIds);
    if (next) nextSet.add(findingId);
    else nextSet.delete(findingId);
    setCuratedIds(nextSet);
    try {
      await curateFinding(caseId, findingId, next);
    } catch (e) {
      setCuratedIds(prev);
      setEnrichErr(e instanceof Error ? e.message : String(e));
    }
  }

  // Enrich every curated finding in one go (background job on the backend).
  async function runEnrichCurated() {
    if (enrichCuratedBusy) return;
    setEnrichCuratedBusy(true);
    setEnrichCuratedErr(null);
    try {
      const queued = await enrichCurated(caseId);
      setActiveJob({
        id: queued.job_id,
        case_id: caseId,
        kind: queued.type,
        target: queued.scanned,
        status: "running",
        started_at: Date.now() / 1000,
        finished_at: null,
        elapsed_s: 0,
        result: null,
        error: null,
      });
      pollJob(queued.job_id, `enrich-curated:${queued.job_id}`);
    } catch (e) {
      setEnrichCuratedErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEnrichCuratedBusy(false);
    }
  }

  function clearAllCuration() {
    // Optimistic local clear
    const prev = new Set(curatedIds);
    setCuratedIds(new Set());
    Promise.all(
      [...prev].map((id) => curateFinding(caseId, id, false).catch(() => null)),
    ).then(() => router.refresh());
  }

  // ---------------------------------------------------------------------
  // Filter chain
  // ---------------------------------------------------------------------
  // 1. Base: all findings
  // 2. + active filter state (statuses, platforms, sources, idTypes, hasFlags, locations, categories)
  // 3. + text search
  // 4. + pivot filter
  // 5. + sort
  // ---------------------------------------------------------------------

  const found = useMemo(() => findings.filter((f) => f.status === "found"), [findings]);
  const crossLinks = useMemo(() => buildCrossLinks(found), [found]);

  // Apply the new filter state (NOT text search or pivot — those come after)
  const afterStateFilter = useMemo(() => {
    return findings.filter((f) => {
      // Curated-only quick filter
      if (curatedOnly && !curatedIds.has(f.id)) return false;
      // Scraped-only quick filter (firecrawl enrichments)
      if (scrapedOnly && f.source_tool !== "firecrawl") return false;
      // Status
      if (statuses.size > 0 && !statuses.has(f.status as Status)) return false;
      // Platform
      if (platforms.size > 0 && !platforms.has(f.platform)) return false;
      // Source tool
      if (sources.size > 0 && !sources.has(f.source_tool)) return false;
      // Identifier type
      if (idTypes.size > 0 && !idTypes.has(f.identifier_type)) return false;
      const meta = f.extra_metadata || {};
      const extra = (meta.extra as Record<string, unknown>) || {};
      // Category
      if (categories.size > 0) {
        const cat = (meta.category as string) || "";
        if (!categories.has(cat)) return false;
      }
      // Location (specific value)
      if (locations.size > 0) {
        const loc = (typeof extra.location === "string" ? extra.location : null) || "";
        if (!locations.has(loc)) return false;
      }
      // Has flags
      if (hasFlags.size > 0) {
        for (const flag of hasFlags) {
          switch (flag) {
            case "avatar": {
              const m = (meta.media as Record<string, unknown>) || {};
              if (!(m.avatar || m.image || extra.avatar || extra.image)) return false;
              break;
            }
            case "display_name":
              if (!(typeof extra.display_name === "string" && extra.display_name.trim())
                && !(typeof extra.fullname === "string" && extra.fullname.trim())
                && !(typeof extra.name === "string" && extra.name.trim())) return false;
              break;
            case "bio":
              if (!(typeof extra.bio === "string" && extra.bio.trim())
                && !(typeof extra.about === "string" && extra.about.trim())
                && !(typeof extra.description === "string" && extra.description.trim())) return false;
              break;
            case "email":
              if (!(typeof extra.email === "string" && extra.email.includes("@"))
                && !(typeof extra.business_email === "string" && extra.business_email.includes("@"))) return false;
              break;
            case "website":
              if (!(typeof extra.website === "string" && extra.website.trim())) return false;
              break;
            case "links":
              if (!(typeof extra.links === "string" && extra.links.trim())) return false;
              break;
            case "location":
              if (!(typeof extra.location === "string" && extra.location.trim())) return false;
              break;
            case "company":
              if (!(typeof extra.company === "string" && extra.company.trim())) return false;
              break;
            case "verified":
              if (!(extra.is_verified === true || extra.is_verified === "true")) return false;
              break;
            case "private":
              if (!(extra.private === true || extra.private === "True" || extra.private === "true")) return false;
              break;
            case "pivots": {
              // Quick check: any pivot-related field
              const hasPivot =
                (typeof extra.email === "string" && extra.email.includes("@")) ||
                (typeof extra.website === "string" && extra.website.includes("http")) ||
                !!extra.twitter || !!extra.twitter_username || !!extra.github ||
                !!extra.instagram || !!extra.youtube || !!extra.tiktok || !!extra.linkedin;
              if (!hasPivot) return false;
              break;
            }
          }
        }
      }
      return true;
    });
  }, [findings, statuses, platforms, sources, idTypes, categories, locations, hasFlags]);

  // Live text search (over the state-filtered set, so users see counts update)
  const searched = useMemo(() => {
    if (!query.trim()) return afterStateFilter;
    const q = query.toLowerCase();
    return afterStateFilter.filter((f) => {
      if (f.identifier_value.toLowerCase().includes(q)) return true;
      if (f.platform.toLowerCase().includes(q)) return true;
      const extra = (f.extra_metadata?.extra as Record<string, unknown>) || {};
      for (const v of Object.values(extra)) {
        if (typeof v === "string" && v.toLowerCase().includes(q)) return true;
      }
      const m = f.extra_metadata || {};
      if (typeof m.url === "string" && m.url.toLowerCase().includes(q)) return true;
      if (typeof m.category === "string" && m.category.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [afterStateFilter, query]);

  // Pivot filter
  const filtered = useMemo(() => {
    if (!pivotFilter) return searched;
    const [kind, value] = pivotFilter.split(":", 2);
    const v = value.toLowerCase();
    return searched.filter((f) => {
      if (kind === "platform") return f.platform.toLowerCase() === v;
      if (kind === "identifier") return f.identifier_value.toLowerCase() === v;
      if (kind === "email" || kind === "url" || kind === "handle") {
        const haystack = JSON.stringify(f.extra_metadata || {}).toLowerCase();
        return haystack.includes(v);
      }
      return true;
    });
  }, [searched, pivotFilter]);

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "status":
          cmp = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
          if (cmp === 0) cmp = a.platform.localeCompare(b.platform);
          break;
        case "platform":
          cmp = a.platform.localeCompare(b.platform);
          if (cmp === 0) cmp = a.identifier_value.localeCompare(b.identifier_value);
          break;
        case "identifier":
          cmp = a.identifier_value.localeCompare(b.identifier_value);
          break;
        case "display_name": {
          const aExtra = (a.extra_metadata?.extra as Record<string, unknown>) || {};
          const bExtra = (b.extra_metadata?.extra as Record<string, unknown>) || {};
          const aDn = (aExtra.display_name as string) || (aExtra.fullname as string) || (aExtra.name as string) || "";
          const bDn = (bExtra.display_name as string) || (bExtra.fullname as string) || (bExtra.name as string) || "";
          cmp = aDn.localeCompare(bDn);
          if (cmp === 0) cmp = a.platform.localeCompare(b.platform);
          break;
        }
        case "recent":
          cmp = (a.collected_at || "").localeCompare(b.collected_at || "");
          break;
      }
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const originalSet = useMemo(
    () => new Set(identifiers.map((i) => i.value.toLowerCase())),
    [identifiers],
  );
  const isOriginal = (f: Finding) => originalSet.has(f.identifier_value.toLowerCase());

  // Aggregate pivots across all found findings (for the Pivots tab)
  // Pivots tab is the unfiltered "found" view, since pivots are intrinsic to the data.
  const pivots = useMemo(() => aggregatePivots(found), [found]);

  // Group by platform
  const foundByPlatform = useMemo(() => {
    const m: Record<string, Finding[]> = {};
    for (const f of found) (m[f.platform] ??= []).push(f);
    return m;
  }, [found]);

  // -- Option lists for the "More filters" popover --
  // Counts reflect the state where THIS option's filter is *not* applied
  // (i.e. the "would-be count" if user added this option). Computed against
  // `afterStateFilter` minus the current dimension, so the user sees how their
  // selection will affect each individual choice.
  const optionFacets = useMemo(() => buildOptionFacets(findings, {
    statuses, platforms, sources, idTypes, categories, locations, hasFlags,
  }), [findings, statuses, platforms, sources, idTypes, categories, locations, hasFlags]);

  // Active-filter count for the popover trigger badge
  const activeFilterCount =
    statuses.size + platforms.size + sources.size + idTypes.size + categories.size + locations.size + hasFlags.size;

  // Has any active filter?
  const hasAnyFilter = activeFilterCount > 0;

  function clearAllFilters() {
    setStatuses(new Set());
    setPlatforms(new Set());
    setSources(new Set());
    setIdTypes(new Set());
    setCategories(new Set());
    setLocations(new Set());
    setHasFlags(new Set());
    setCuratedOnly(false);
    setScrapedOnly(false);
  }

  return (
    <div>
      {/* Curate & Enrich banner — shows when at least one finding is starred */}
      {curatedIds.size > 0 && (
        <CurateBanner
          caseId={caseId}
          count={curatedIds.size}
          busy={enrichCuratedBusy}
          error={enrichCuratedErr}
          onEnrich={runEnrichCurated}
          onClear={clearAllCuration}
        />
      )}

      {/* Related profiles panel — "5 related accounts" like Instagram */}
      <RelatedProfilesPanel
        variants={relatedVars}
        busy={relatedBusy}
        error={relatedErr}
        onLoad={loadRelated}
        onScanHere={scanRelated}
        identifiers={identifiers}
      />

      {/* Manual scan panel — add a username/email pivot to THIS case */}
      <ManualScanPanel
        onScan={runScan}
        scanning={scanning}
        error={scanErr}
        lastResult={lastScanResult}
        activeJob={activeJob}
      />

      {/* Sticky filter bar */}
      <FilterBar
        totalCount={findings.length}
        foundCount={found.length}
        notFoundCount={findings.filter((f) => f.status === "not_found").length}
        errorCount={findings.filter((f) => f.status === "error").length}
        curatedCount={curatedIds.size}
        curatedOnly={curatedOnly}
        onToggleCuratedOnly={() => setCuratedOnly((v) => !v)}
        scrapedCount={findings.filter((f) => f.source_tool === "firecrawl").length}
        scrapedOnly={scrapedOnly}
        onToggleScrapedOnly={() => setScrapedOnly((v) => !v)}
        statuses={statuses}
        onToggleStatus={(s) => toggleInSet(statuses, s, setStatuses)}
        facets={optionFacets}
        platforms={platforms}
        onTogglePlatform={(p) => toggleInSet(platforms, p, setPlatforms)}
        sources={sources}
        onToggleSource={(s) => toggleInSet(sources, s, setSources)}
        idTypes={idTypes}
        onToggleIdType={(t) => toggleInSet(idTypes, t, setIdTypes)}
        categories={categories}
        onToggleCategory={(c) => toggleInSet(categories, c, setCategories)}
        locations={locations}
        onToggleLocation={(l) => toggleInSet(locations, l, setLocations)}
        hasFlags={hasFlags}
        onToggleHasFlag={(f) => toggleInSet(hasFlags, f, setHasFlags)}
        sortKey={sortKey}
        onChangeSortKey={setSortKey}
        sortDir={sortDir}
        onToggleSortDir={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
        density={density}
        onChangeDensity={setDensity}
        activeFilterCount={activeFilterCount}
        onClearAll={clearAllFilters}
      />

      {/* Live selection summary — only when filters are active */}
      {hasAnyFilter && (
        <SelectionSummary findings={sorted} />
      )}

      {/* Live text search + pivot filter chip */}
      <div className="card" style={{ padding: "10px 14px", marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--color-foreground)", opacity: 0.5, pointerEvents: "none" }}>
              <Icon name="search" size={14} />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search findings — identifier, platform, bio, email, URL, handle…"
              style={{ paddingLeft: 32, fontFamily: "var(--font-mono)", fontSize: 12.5 }}
              aria-label="Search findings"
            />
          </div>
          {pivotFilter && (
            <button
              type="button"
              onClick={() => setPivotFilter(null)}
              className="active-chip is-muted"
              style={{ cursor: "pointer", padding: "4px 8px" }}
              title="Click to clear pivot filter"
            >
              <Icon name="x" size={9} /> {pivotFilter}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div
        className="row"
        style={{
          gap: 2,
          marginBottom: 16,
          borderBottom: "1px solid var(--color-border-soft)",
          paddingBottom: 0,
          overflowX: "auto",
        }}
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          const count =
            t.id === "correlations" ? correlations.length :
            t.id === "findings" ? sorted.length :
            t.id === "cards" ? Object.keys(foundByPlatform).length :
            null;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={active ? "" : "ghost"}
              style={{
                background: "transparent",
                border: "1px solid transparent",
                borderBottom: active ? "2px solid var(--color-accent)" : "2px solid transparent",
                borderRadius: 0,
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                opacity: active ? 1 : 0.55,
                color: active ? "var(--color-foreground)" : "var(--color-foreground)",
                position: "relative",
                top: 1,
              }}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
              {count !== null && count > 0 && (
                <span
                  className="badge"
                  style={{
                    marginLeft: 8,
                    padding: "0 6px",
                    fontSize: 10,
                    background: active ? "var(--color-accent-soft)" : "var(--color-muted)",
                    color: active ? "var(--color-accent)" : "var(--color-foreground)",
                    border: "1px solid var(--color-border-soft)",
                    opacity: active ? 1 : 0.7,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === "cards" && (
        <CardsView
          caseId={caseId}
          findings={sorted}
          crossLinks={crossLinks}
          isOriginal={isOriginal}
          onEnrich={runEnrich}
          enriching={enriching}
          density={density}
          curatedIds={curatedIds}
          onToggleCurate={toggleCurate}
        />
      )}
      {tab === "pivots" && (
        <PivotsView pivots={pivots} foundByPlatform={foundByPlatform} onPivotClick={setPivotFilter} activeFilter={pivotFilter} identifiers={identifiers} onScan={runScan} scanning={scanning} />
      )}
      {tab === "graph" && (
        <GraphView findings={found} pivots={pivots} identifiers={identifiers} onPlatformClick={(p) => setPivotFilter(`platform:${p}`)} onPivotClick={setPivotFilter} />
      )}
      {tab === "findings" && (
        <AllFindingsView
          findings={sorted}
          crossLinks={crossLinks}
          isOriginal={isOriginal}
          sortKey={sortKey}
          sortDir={sortDir}
          onChangeSort={setSortKey}
          curatedIds={curatedIds}
          onToggleCurate={toggleCurate}
        />
      )}
      {tab === "correlations" && (
        <CorrelationsView correlations={correlations} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toggleInSet<T>(set: Set<T>, value: T, setter: (s: Set<T>) => void) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  setter(next);
}

interface OptionFacets {
  platforms: { value: string; count: number }[];
  sources: { value: string; count: number }[];
  idTypes: { value: string; count: number }[];
  categories: { value: string; count: number }[];
  locations: { value: string; count: number }[];
}

function buildOptionFacets(
  findings: Finding[],
  active: {
    statuses: Set<string>;
    platforms: Set<string>;
    sources: Set<string>;
    idTypes: Set<string>;
    categories: Set<string>;
    locations: Set<string>;
    hasFlags: Set<string>;
  },
): OptionFacets {
  // "Would-be" counts: for each value in each dimension, count how many
  // findings would match if that value was selected, *holding all other
  // dimensions' filters constant*. This way the count is meaningful both
  // for unselected options (preview what would happen) and selected options
  // (current scope of that filter).
  const platCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const idTypeCounts = new Map<string, number>();
  const catCounts = new Map<string, number>();
  const locCounts = new Map<string, number>();

  for (const f of findings) {
    const meta = f.extra_metadata || {};
    const extra = (meta.extra as Record<string, unknown>) || {};
    const cat = (meta.category as string) || "";
    const loc = (typeof extra.location === "string" ? extra.location : "") || "";

    // Per-dimension gate: each dimension excludes ITSELF from the check.
    const passes = (dim: "platform" | "source" | "idType" | "category" | "location" | "status") => {
      if (dim !== "status" && active.statuses.size > 0 && !active.statuses.has(f.status)) return false;
      if (dim !== "source" && active.sources.size > 0 && !active.sources.has(f.source_tool)) return false;
      if (dim !== "idType" && active.idTypes.size > 0 && !active.idTypes.has(f.identifier_type)) return false;
      if (dim !== "category" && active.categories.size > 0 && !active.categories.has(cat)) return false;
      if (dim !== "location" && active.locations.size > 0 && !active.locations.has(loc)) return false;
      return true;
    };

    if (passes("platform")) {
      platCounts.set(f.platform, (platCounts.get(f.platform) ?? 0) + 1);
    }
    if (passes("source")) {
      sourceCounts.set(f.source_tool, (sourceCounts.get(f.source_tool) ?? 0) + 1);
    }
    if (passes("idType")) {
      idTypeCounts.set(f.identifier_type, (idTypeCounts.get(f.identifier_type) ?? 0) + 1);
    }
    if (passes("category") && cat) {
      catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
    }
    if (passes("location") && loc) {
      locCounts.set(loc, (locCounts.get(loc) ?? 0) + 1);
    }
  }

  const sorter = (m: Map<string, number>) => [...m.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  return {
    platforms: sorter(platCounts),
    sources: sorter(sourceCounts),
    idTypes: sorter(idTypeCounts),
    categories: sorter(catCounts),
    locations: sorter(locCounts).slice(0, 30), // cap locations to top 30
  };
}

// ---------------------------------------------------------------------------
// FilterBar — sticky top bar with status chips, popover, sort, density
// ---------------------------------------------------------------------------

interface FilterBarProps {
  totalCount: number;
  foundCount: number;
  notFoundCount: number;
  errorCount: number;
  curatedCount: number;
  curatedOnly: boolean;
  onToggleCuratedOnly: () => void;
  scrapedCount: number;
  scrapedOnly: boolean;
  onToggleScrapedOnly: () => void;
  statuses: Set<Status>;
  onToggleStatus: (s: Status) => void;
  facets: OptionFacets;
  platforms: Set<string>;
  onTogglePlatform: (p: string) => void;
  sources: Set<string>;
  onToggleSource: (s: string) => void;
  idTypes: Set<string>;
  onToggleIdType: (t: string) => void;
  categories: Set<string>;
  onToggleCategory: (c: string) => void;
  locations: Set<string>;
  onToggleLocation: (l: string) => void;
  hasFlags: Set<HasFlag>;
  onToggleHasFlag: (f: HasFlag) => void;
  sortKey: SortKey;
  onChangeSortKey: (k: SortKey) => void;
  sortDir: "asc" | "desc";
  onToggleSortDir: () => void;
  density: DensityMode;
  onChangeDensity: (d: DensityMode) => void;
  activeFilterCount: number;
  onClearAll: () => void;
}

function FilterBar(props: FilterBarProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click outside to close
  useEffect(() => {
    if (!popoverOpen) return;
    function onDown(e: MouseEvent) {
      if (
        popoverRef.current?.contains(e.target as Node) ||
        triggerRef.current?.contains(e.target as Node)
      ) return;
      setPopoverOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopoverOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  const statusActiveCount = props.statuses.size;

  return (
    <div className="filter-bar">
      <div className="filter-bar-row">
        {/* Status quick chips */}
        <button
          type="button"
          className={`status-chip is-found ${props.statuses.has("found") ? "is-active" : ""}`}
          onClick={() => props.onToggleStatus("found")}
          title="Show only findings that were found on the target platform"
        >
          <span className="dot" />
          Found
          <span className="count">{props.foundCount}</span>
        </button>
        <button
          type="button"
          className={`status-chip is-muted ${props.statuses.has("not_found") ? "is-active" : ""}`}
          onClick={() => props.onToggleStatus("not_found")}
          title="Show only platforms where the subject was NOT found"
        >
          <span className="dot" />
          Not found
          <span className="count">{props.notFoundCount}</span>
        </button>
        <button
          type="button"
          className={`status-chip is-error ${props.statuses.has("error") ? "is-active" : ""}`}
          onClick={() => props.onToggleStatus("error")}
          title="Show only collector errors (rate limits, timeouts, etc.)"
        >
          <span className="dot" />
          Errors
          <span className="count">{props.errorCount}</span>
        </button>

        {/* Curated quick chip — shows the shortlist only */}
        {props.curatedCount > 0 && (
          <button
            type="button"
            className={`status-chip is-muted ${props.curatedOnly ? "is-active" : ""}`}
            onClick={props.onToggleCuratedOnly}
            title="Show only the findings you've starred for follow-up (curated shortlist)"
            style={{
              borderColor: props.curatedOnly ? "var(--color-warning)" : undefined,
              color: props.curatedOnly ? "var(--color-warning)" : undefined,
              background: props.curatedOnly ? "hsl(38 95% 53% / 0.10)" : undefined,
            }}
          >
            <Star size={11} fill={props.curatedOnly ? "currentColor" : "none"} />
            Curated
            <span className="count">{props.curatedCount}</span>
          </button>
        )}

        {/* Scraped quick chip — Firecrawl enrichments */}
        {props.scrapedCount > 0 && (
          <button
            type="button"
            className={`status-chip is-muted ${props.scrapedOnly ? "is-active" : ""}`}
            onClick={props.onToggleScrapedOnly}
            title="Show only Firecrawl-enriched findings (the profile-page data we scraped)"
            style={{
              borderColor: props.scrapedOnly ? "var(--color-accent)" : undefined,
              color: props.scrapedOnly ? "var(--color-accent)" : undefined,
              background: props.scrapedOnly ? "hsl(var(--accent) / 0.10)" : undefined,
            }}
          >
            <Icon name="link" size={11} />
            Scraped
            <span className="count">{props.scrapedCount}</span>
          </button>
        )}

        {/* More filters popover anchor */}
        <div ref={triggerRef} style={{ position: "relative" }}>
          <button
            type="button"
            className={`filter-trigger ${props.activeFilterCount > statusActiveCount ? "is-active" : ""}`}
            onClick={() => setPopoverOpen((v) => !v)}
            aria-expanded={popoverOpen}
            title="Open advanced filters (platform, source, location, etc.)"
          >
            <Icon name="sliders" size={12} />
            Filters
            {props.activeFilterCount > statusActiveCount && (
              <span className="filter-count">{props.activeFilterCount - statusActiveCount}</span>
            )}
            <Icon name={popoverOpen ? "chevron-up" : "chevron-down"} size={11} />
          </button>
          {popoverOpen && (
            <div ref={popoverRef} className="filter-popover" role="dialog" aria-label="Filters">
              <FilterPopover {...props} onClose={() => setPopoverOpen(false)} />
            </div>
          )}
        </div>

        {/* Sort */}
        <div className="sort-control">
          <span>Sort</span>
          <div className="select-wrap">
            <select
              value={props.sortKey}
              onChange={(e) => props.onChangeSortKey(e.target.value as SortKey)}
              aria-label="Sort by"
            >
              <option value="status">Status</option>
              <option value="platform">Platform</option>
              <option value="identifier">Identifier</option>
              <option value="display_name">Display name</option>
              <option value="recent">Recently added</option>
            </select>
            <Icon name="chevron-down" size={11} className="select-chevron" />
          </div>
          <button
            type="button"
            className="sort-direction"
            onClick={props.onToggleSortDir}
            title={props.sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
            aria-label="Toggle sort direction"
          >
            <Icon name={props.sortDir === "asc" ? "arrow-up" : "arrow-down"} size={11} />
          </button>
        </div>

        {/* Density toggle (only affects the cards view) */}
        <div className="density-toggle" role="group" aria-label="Card density">
          <button
            type="button"
            className={props.density === "comfortable" ? "is-active" : ""}
            onClick={() => props.onChangeDensity("comfortable")}
            title="Comfortable — full cards with bio and metadata"
            aria-label="Comfortable density"
            aria-pressed={props.density === "comfortable"}
          >
            <Icon name="list" size={11} />
          </button>
          <button
            type="button"
            className={props.density === "compact" ? "is-active" : ""}
            onClick={() => props.onChangeDensity("compact")}
            title="Compact — denser rows for quick scanning"
            aria-label="Compact density"
            aria-pressed={props.density === "compact"}
          >
            <Icon name="layers" size={11} />
          </button>
        </div>
      </div>

      {/* Active filter chips row */}
      {(props.platforms.size + props.sources.size + props.idTypes.size + props.categories.size + props.locations.size + props.hasFlags.size) > 0 && (
        <div className="filter-bar-row">
          <span className="muted" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em" }}>Active</span>
          {[...props.platforms].map((p) => (
            <span key={`p-${p}`} className="active-chip is-found">
              <span className="active-chip-label">platform:</span>
              <span className="mono">{p}</span>
              <button type="button" className="chip-remove" onClick={() => props.onTogglePlatform(p)} aria-label={`Remove platform filter ${p}`}>
                <Icon name="x" size={9} />
              </button>
            </span>
          ))}
          {[...props.sources].map((s) => (
            <span key={`s-${s}`} className="active-chip is-muted">
              <span className="active-chip-label">source:</span>
              <span className="mono">{s}</span>
              <button type="button" className="chip-remove" onClick={() => props.onToggleSource(s)} aria-label={`Remove source filter ${s}`}>
                <Icon name="x" size={9} />
              </button>
            </span>
          ))}
          {[...props.idTypes].map((t) => (
            <span key={`t-${t}`} className="active-chip is-muted">
              <span className="active-chip-label">type:</span>
              <span className="mono">{t}</span>
              <button type="button" className="chip-remove" onClick={() => props.onToggleIdType(t)} aria-label={`Remove type filter ${t}`}>
                <Icon name="x" size={9} />
              </button>
            </span>
          ))}
          {[...props.categories].map((c) => (
            <span key={`c-${c}`} className="active-chip is-muted">
              <span className="active-chip-label">cat:</span>
              <span className="mono">{c}</span>
              <button type="button" className="chip-remove" onClick={() => props.onToggleCategory(c)} aria-label={`Remove category filter ${c}`}>
                <Icon name="x" size={9} />
              </button>
            </span>
          ))}
          {[...props.locations].map((l) => (
            <span key={`l-${l}`} className="active-chip is-found">
              <Icon name="pin" size={9} />
              <span>{l}</span>
              <button type="button" className="chip-remove" onClick={() => props.onToggleLocation(l)} aria-label={`Remove location filter ${l}`}>
                <Icon name="x" size={9} />
              </button>
            </span>
          ))}
          {[...props.hasFlags].map((f) => {
            const def = HAS_FLAGS.find((h) => h.id === f);
            return (
              <span key={`h-${f}`} className="active-chip">
                <Icon name={def?.icon ?? "info"} size={9} />
                <span>has {def?.label ?? f}</span>
                <button type="button" className="chip-remove" onClick={() => props.onToggleHasFlag(f)} aria-label={`Remove has-${f} filter`}>
                  <Icon name="x" size={9} />
                </button>
              </span>
            );
          })}
          <button type="button" className="clear-link" onClick={props.onClearAll}>
            clear all
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterPopover — multi-select panel for Platform / Source / Type / Category /
// Location / Has...
// ---------------------------------------------------------------------------

function FilterPopover(props: FilterBarProps & { onClose: () => void }) {
  const [platQuery, setPlatQuery] = useState("");
  const [locQuery, setLocQuery] = useState("");

  const filterOptions = (opts: { value: string; count: number }[], q: string) =>
    q.trim() ? opts.filter((o) => o.value.toLowerCase().includes(q.toLowerCase())) : opts;

  return (
    <div>
      <PopoverSection title="Platform" count={props.platforms.size} onClear={() => props.platforms.forEach((p) => props.onTogglePlatform(p))}>
        <input
          type="text"
          placeholder="Search platforms…"
          value={platQuery}
          onChange={(e) => setPlatQuery(e.target.value)}
          style={{ marginBottom: 6, fontSize: 11.5, padding: "4px 8px" }}
        />
        <div style={{ maxHeight: 160, overflowY: "auto" }}>
          {filterOptions(props.facets.platforms, platQuery).slice(0, 50).map((o) => (
            <FilterOption
              key={o.value}
              label={o.value}
              count={o.count}
              checked={props.platforms.has(o.value)}
              onToggle={() => props.onTogglePlatform(o.value)}
            />
          ))}
        </div>
      </PopoverSection>

      <PopoverSection title="Source" count={props.sources.size} onClear={() => props.sources.forEach((s) => props.onToggleSource(s))}>
        {props.facets.sources.slice(0, 20).map((o) => (
          <FilterOption
            key={o.value}
            label={o.value}
            count={o.count}
            checked={props.sources.has(o.value)}
            onToggle={() => props.onToggleSource(o.value)}
          />
        ))}
      </PopoverSection>

      <PopoverSection title="Identifier type" count={props.idTypes.size} onClear={() => props.idTypes.forEach((t) => props.onToggleIdType(t))}>
        {props.facets.idTypes.map((o) => (
          <FilterOption
            key={o.value}
            label={o.value}
            count={o.count}
            checked={props.idTypes.has(o.value)}
            onToggle={() => props.onToggleIdType(o.value)}
          />
        ))}
      </PopoverSection>

      {props.facets.categories.length > 0 && (
        <PopoverSection title="Category" count={props.categories.size} onClear={() => props.categories.forEach((c) => props.onToggleCategory(c))}>
          {props.facets.categories.map((o) => (
            <FilterOption
              key={o.value}
              label={o.value}
              count={o.count}
              checked={props.categories.has(o.value)}
              onToggle={() => props.onToggleCategory(o.value)}
            />
          ))}
        </PopoverSection>
      )}

      <PopoverSection title="Location" count={props.locations.size} onClear={() => props.locations.forEach((l) => props.onToggleLocation(l))}>
        {props.facets.locations.length === 0 ? (
          <div className="muted" style={{ fontSize: 11.5, padding: "4px 6px", lineHeight: 1.5 }}>
            <Icon name="info" size={11} /> No location data yet. Run <strong>Enrich</strong> on a finding (open a profile → click Enrich) to scrape the page and extract location info.
          </div>
        ) : (
          <>
            <input
              type="text"
              placeholder="Search locations…"
              value={locQuery}
              onChange={(e) => setLocQuery(e.target.value)}
              style={{ marginBottom: 6, fontSize: 11.5, padding: "4px 8px" }}
            />
            <div style={{ maxHeight: 140, overflowY: "auto" }}>
              {filterOptions(props.facets.locations, locQuery).slice(0, 30).map((o) => (
                <FilterOption
                  key={o.value}
                  label={o.value}
                  count={o.count}
                  checked={props.locations.has(o.value)}
                  onToggle={() => props.onToggleLocation(o.value)}
                />
              ))}
            </div>
          </>
        )}
      </PopoverSection>

      <PopoverSection title="Has…" count={props.hasFlags.size} onClear={() => props.hasFlags.forEach((f) => props.onToggleHasFlag(f))}>
        <div className="has-toggles">
          {HAS_FLAGS.map((h) => (
            <button
              key={h.id}
              type="button"
              className={`has-toggle ${props.hasFlags.has(h.id) ? "is-active" : ""}`}
              onClick={() => props.onToggleHasFlag(h.id)}
              aria-pressed={props.hasFlags.has(h.id)}
            >
              <Icon name={h.icon} size={11} />
              {h.label}
            </button>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 10.5, marginTop: 8, lineHeight: 1.5, padding: "0 4px" }}>
          Tip: profile metadata (avatar, bio, location, email, website) is only present on platforms that expose it.
          Run <strong>Enrich</strong> on a card to scrape a profile and pull more fields.
        </div>
      </PopoverSection>
    </div>
  );
}

function PopoverSection({
  title, count, onClear, children,
}: {
  title: string;
  count: number;
  onClear: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="filter-popover-section">
      <div className="filter-popover-section-head">
        <span>{title}</span>
        {count > 0 ? (
          <button type="button" className="head-action" onClick={onClear}>clear ({count})</button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function FilterOption({
  label, count, checked, onToggle,
}: {
  label: string;
  count: number;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={`filter-option ${count === 0 ? "is-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={count === 0 && !checked}
      />
      <span className="opt-label" title={label}>{label}</span>
      <span className="opt-count">{count}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// SelectionSummary — live aggregate stats for the current filter selection
// ---------------------------------------------------------------------------

function SelectionSummary({ findings }: { findings: Finding[] }) {
  const platforms = new Set(findings.map((f) => f.platform));
  let withLocation = 0;
  let withEmail = 0;
  let withWebsite = 0;
  let withAvatar = 0;
  let withBio = 0;
  let withDisplayName = 0;
  let verified = 0;
  let totalFollowers = 0;
  for (const f of findings) {
    const m = f.extra_metadata || {};
    const e = (m.extra as Record<string, unknown>) || {};
    const media = (m.media as Record<string, unknown>) || {};
    if (typeof e.location === "string" && e.location.trim()) withLocation++;
    if ((typeof e.email === "string" && e.email.includes("@")) || (typeof e.business_email === "string" && e.business_email.includes("@"))) withEmail++;
    if (typeof e.website === "string" && e.website.trim()) withWebsite++;
    if (media.avatar || media.image || e.avatar || e.image) withAvatar++;
    if (typeof e.bio === "string" && e.bio.trim()) withBio++;
    if (typeof e.display_name === "string" && e.display_name.trim()) withDisplayName++;
    if (e.is_verified === true || e.is_verified === "true") verified++;
    if (typeof e.followers === "number") totalFollowers += e.followers;
    else if (typeof e.followers === "string" && /^\d+$/.test(e.followers)) totalFollowers += parseInt(e.followers, 10);
    else if (typeof e.follower_count === "number") totalFollowers += e.follower_count;
  }
  const found = findings.filter((f) => f.status === "found").length;
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="selection-summary">
      <span className="ss-item">
        <span className="ss-num">{findings.length}</span>
        <span className="ss-label">findings</span>
      </span>
      <span className="ss-item">
        <span className="ss-num">{found}</span>
        <span className="ss-label">found</span>
      </span>
      <span className="ss-item">
        <span className="ss-num">{platforms.size}</span>
        <span className="ss-label">platforms</span>
      </span>
      {withLocation > 0 && (
        <span className="ss-item">
          <Icon name="pin" size={11} />
          <span className="ss-num">{withLocation}</span>
          <span className="ss-label">with location</span>
        </span>
      )}
      {withEmail > 0 && (
        <span className="ss-item">
          <Icon name="mail" size={11} />
          <span className="ss-num">{withEmail}</span>
          <span className="ss-label">with email</span>
        </span>
      )}
      {withWebsite > 0 && (
        <span className="ss-item">
          <Icon name="link" size={11} />
          <span className="ss-num">{withWebsite}</span>
          <span className="ss-label">with website</span>
        </span>
      )}
      {withAvatar > 0 && (
        <span className="ss-item">
          <Icon name="image" size={11} />
          <span className="ss-num">{withAvatar}</span>
          <span className="ss-label">with avatar</span>
        </span>
      )}
      {withDisplayName > 0 && (
        <span className="ss-item">
          <Icon name="user" size={11} />
          <span className="ss-num">{withDisplayName}</span>
          <span className="ss-label">named</span>
        </span>
      )}
      {withBio > 0 && (
        <span className="ss-item">
          <Icon name="info" size={11} />
          <span className="ss-num">{withBio}</span>
          <span className="ss-label">with bio</span>
        </span>
      )}
      {verified > 0 && (
        <span className="ss-item">
          <Icon name="check" size={11} />
          <span className="ss-num">{verified}</span>
          <span className="ss-label">verified</span>
        </span>
      )}
      {totalFollowers > 0 && (
        <span className="ss-item">
          <span className="ss-num">{fmt(totalFollowers)}</span>
          <span className="ss-label">total followers</span>
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregated pivots
// ---------------------------------------------------------------------------

interface AggregatedPivots {
  emails: { value: string; platforms: string[]; findingIds: string[] }[];
  urls: { value: string; platforms: string[]; findingIds: string[] }[];
  handles: { platform: string; handle: string; findingIds: string[] }[];
  sharedPlatforms: [platform: string, findings: Finding[]][];
}

function aggregatePivots(found: Finding[]): AggregatedPivots {
  const emails = new Map<string, { platforms: Set<string>; ids: Set<string> }>();
  const urls = new Map<string, { platforms: Set<string>; ids: Set<string> }>();
  const handles = new Map<string, { platform: string; handle: string; ids: Set<string> }>();
  const platformCounts = new Map<string, Finding[]>();

  for (const f of found) {
    platformCounts.set(f.platform, [...(platformCounts.get(f.platform) ?? []), f]);
    const extra = (f.extra_metadata?.extra as Record<string, unknown>) || {};
    const bio = (typeof extra.bio === "string" ? extra.bio : "")
      || (typeof extra.about === "string" ? extra.about : "")
      || (typeof extra.description === "string" ? extra.description : "");
    const haystack = JSON.stringify(extra) + " " + bio;

    const emailRe = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g;
    for (const m of haystack.matchAll(emailRe)) {
      const e = m[0].toLowerCase();
      const ent = emails.get(e) ?? { platforms: new Set(), ids: new Set() };
      ent.platforms.add(f.platform);
      ent.ids.add(f.id);
      emails.set(e, ent);
    }
    const urlRe = /https?:\/\/[^\s<>"',;]+/g;
    for (const m of haystack.matchAll(urlRe)) {
      const u = m[0].replace(/[.,;:!?)>'"]+$/, "");
      const ent = urls.get(u) ?? { platforms: new Set(), ids: new Set() };
      ent.platforms.add(f.platform);
      ent.ids.add(f.id);
      urls.set(u, ent);
    }
    for (const field of ["twitter", "twitter_username", "github", "instagram", "youtube", "tiktok", "linkedin"]) {
      const v = extra[field];
      if (typeof v === "string" && v.trim()) {
        const h = v.trim().replace(/^@/, "").toLowerCase();
        const key = `${field}:${h}`;
        const ent = handles.get(key) ?? { platform: field.replace("_username", ""), handle: h, ids: new Set() };
        ent.ids.add(f.id);
        handles.set(key, ent);
      }
    }
  }

  return {
    emails: [...emails.entries()]
      .map(([value, v]) => ({ value, platforms: [...v.platforms], findingIds: [...v.ids] }))
      .sort((a, b) => b.platforms.length - a.platforms.length || a.value.localeCompare(b.value)),
    urls: [...urls.entries()]
      .map(([value, v]) => ({ value, platforms: [...v.platforms], findingIds: [...v.ids] }))
      .sort((a, b) => b.platforms.length - a.platforms.length || a.value.localeCompare(b.value)),
    handles: [...handles.values()].map((h) => ({ ...h, findingIds: [...h.ids] })),
    sharedPlatforms: [...platformCounts.entries()].sort((a, b) => b[1].length - a[1].length),
  };
}

// ---------------------------------------------------------------------------
// Cards view: per-platform rich cards (default landing tab)
// ---------------------------------------------------------------------------

function CardsView({
  caseId,
  findings,
  crossLinks,
  isOriginal,
  onEnrich,
  enriching,
  density,
  curatedIds,
  onToggleCurate,
}: {
  caseId: string;
  findings: Finding[];
  crossLinks: ReturnType<typeof buildCrossLinks>;
  isOriginal: (f: Finding) => boolean;
  onEnrich: (findingId: string) => void;
  enriching: string | null;
  density: DensityMode;
  curatedIds: Set<string>;
  onToggleCurate: (id: string, next: boolean) => void;
}) {
  const found = findings.filter((f) => f.status === "found");
  const byPlatform: Record<string, Finding[]> = {};
  for (const f of found) (byPlatform[f.platform] ??= []).push(f);
  const sorted = Object.entries(byPlatform).sort((a, b) => a[0].localeCompare(b[0]));

  if (found.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><Icon name="search" size={20} /></div>
        <h3>No matching findings</h3>
        <p>Try clearing filters or running a new scan.</p>
      </div>
    );
  }

  const canEnrich = (f: Finding) => {
    const meta = f.extra_metadata || {};
    const extra = (meta.extra as Record<string, unknown>) || {};
    return !!(meta.url || extra.website || (f.identifier_value || "").startsWith("http"));
  };

  const compact = density === "compact";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "1fr" : "repeat(auto-fill, minmax(380px, 1fr))",
        gap: compact ? 4 : 12,
        alignItems: "start",
      }}
    >
      {sorted.map(([platform, fs]) => (
        <div
          key={platform}
          className={`card-entity is-found ${compact ? "is-compact" : ""}`}
          style={{ marginBottom: 0 }}
        >
          <div className="card-entity-head">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "var(--color-accent-soft)",
                border: "1px solid var(--color-border-soft)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-accent)",
                flexShrink: 0,
              }}
            >
              <Icon name="check" size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{platform}</div>
              {fs.length > 1 && (
                <div className="muted" style={{ fontSize: 10.5, marginTop: 1 }}>
                  {fs.length} matches
                </div>
              )}
            </div>
            <span className="badge found" style={{ fontSize: 9 }}>found</span>
          </div>
          <div className="card-entity-body">
            {fs.map((f, i) => {
              const isCurated = curatedIds.has(f.id);
              return (
                <div key={f.id}>
                  {i > 0 && <div className="divider" />}
                  <FindingDetails finding={f} crossLinks={crossLinks} />
                  {!compact && (
                    <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
                      {/* Star toggle — shortlist this finding for follow-up */}
                      <button
                        type="button"
                        onClick={() => onToggleCurate(f.id, !isCurated)}
                        aria-pressed={isCurated}
                        style={{
                          fontSize: 11,
                          padding: "4px 10px",
                          background: isCurated ? "hsl(38 95% 53% / 0.15)" : "transparent",
                          color: isCurated ? "hsl(38 95% 53%)" : "var(--color-foreground)",
                          border: isCurated ? "1px solid hsl(38 95% 53% / 0.35)" : "1px solid hsl(var(--border) / 0.5)",
                          borderRadius: "0.5rem",
                          cursor: "pointer",
                        }}
                        title={isCurated ? "Remove from curated shortlist" : "Star for follow-up (curate)"}
                      >
                        <Star
                          size={10}
                          fill={isCurated ? "currentColor" : "none"}
                          style={{ marginRight: 4, verticalAlign: "-1px" }}
                        />
                        {isCurated ? "Curated" : "Curate"}
                      </button>
                      {/* Investigate — opens the deep-dive page for this account.
                          This is the "next stage" the user asked for: a focused
                          view of one curated account with one-click pivot actions,
                          all within the same case (no new case created). */}
                      <Link
                        href={`/case/${caseId}/investigate/${f.id}`}
                        className="secondary"
                        style={{
                          fontSize: 11,
                          padding: "4px 10px",
                          textDecoration: "none",
                        }}
                        title="Open the deep-investigation view for this account"
                      >
                        <Icon name="search" size={10} style={{ marginRight: 4, verticalAlign: "-1px" }} />
                        Investigate →
                      </Link>
                      {canEnrich(f) && (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => onEnrich(f.id)}
                          disabled={enriching !== null}
                          style={{
                            fontSize: 11,
                            padding: "4px 10px",
                            opacity: enriching === f.id ? 0.7 : 1,
                            cursor: enriching === f.id ? "wait" : "pointer",
                          }}
                          title="Scrape this profile page and pull more data (emails, links, content)"
                        >
                          {enriching === f.id ? <span className="spinner" style={{ width: 9, height: 9 }} /> : <Icon name="link" size={10} />}
                          {enriching === f.id ? "Scraping…" : "Enrich"}
                        </button>
                      )}
                    </div>
                  )}
                  {compact && (
                    <div className="row" style={{ marginTop: 4, gap: 6 }}>
                      <button
                        type="button"
                        onClick={() => onToggleCurate(f.id, !isCurated)}
                        aria-pressed={isCurated}
                        style={{
                          fontSize: 10,
                          padding: "2px 6px",
                          background: isCurated ? "hsl(38 95% 53% / 0.15)" : "transparent",
                          color: isCurated ? "hsl(38 95% 53%)" : "var(--color-foreground) / 0.6",
                          border: isCurated ? "1px solid hsl(38 95% 53% / 0.35)" : "1px solid transparent",
                          borderRadius: 4,
                          cursor: "pointer",
                        }}
                        title="Toggle curated"
                      >
                        <Star
                          size={9}
                          fill={isCurated ? "currentColor" : "none"}
                          style={{ marginRight: 3, verticalAlign: "-1px" }}
                        />
                        {isCurated ? "Curated" : "Curate"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="card-entity-foot">
            {fs.map((f) => (
              <span
                key={f.id}
                className={`badge ${isOriginal(f) ? "info" : "muted"}`}
                style={{ fontSize: 9 }}
                title={f.identifier_value}
              >
                {isOriginal(f) ? "original" : "variation"}: <span className="mono" style={{ marginLeft: 3 }}>{f.identifier_value}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pivots view: groups of connected accounts / emails / urls / handles
// ---------------------------------------------------------------------------

function PivotsView({
  pivots,
  foundByPlatform,
  onPivotClick,
  activeFilter,
  identifiers,
  onScan,
  scanning,
}: {
  pivots: AggregatedPivots;
  foundByPlatform: Record<string, Finding[]>;
  onPivotClick: (filter: string) => void;
  activeFilter: string | null;
  identifiers: Identifier[];
  onScan: (value: string, kind: "username" | "email") => void;
  scanning: string | null;
}) {
  const hasAny =
    pivots.emails.length + pivots.urls.length + pivots.handles.length + pivots.sharedPlatforms.length > 0;
  if (!hasAny) {
    return (
      <div className="empty-state">
        <div className="icon"><Icon name="branch" size={20} /></div>
        <h3>No pivots extracted yet</h3>
        <p>Run collectors on profiles with rich bios (emails, links, social handles) to surface pivots.</p>
      </div>
    );
  }
  return (
    <div>
      {(() => {
        const emails = identifiers.filter((i) => i.type === "email").map((i) => i.value);
        if (emails.length === 0) return null;
        const localParts = emails.map((e) => e.split("@")[0]).filter((lp) => lp && lp.length >= 3);
        if (localParts.length === 0) return null;
        const gravatarNames = new Set<string>();
        for (const f of (pivots.handles ?? [])) {
          if (f.handle && f.handle.length >= 3) gravatarNames.add(f.handle);
        }
        const guesses = [...new Set([...localParts, ...gravatarNames])].slice(0, 8);
        return (
          <PivotGroup title="Username guesses" icon="at" subtitle="For email-only findings — click to scan as a username and add results to this case">
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {guesses.map((g) => {
                const key = `username:${g}`;
                const busy = scanning === key;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => onScan(g, "username")}
                    disabled={busy || (scanning !== null && !busy)}
                    className="badge info"
                    style={{ cursor: busy ? "wait" : "pointer", fontFamily: "var(--font-mono)", fontSize: 11.5, padding: "4px 10px", opacity: busy ? 0.7 : 1 }}
                    title={`Scan "${g}" as a username and add findings to this case`}
                  >
                    {busy ? <span className="spinner" style={{ width: 8, height: 8 }} /> : <Icon name="at" size={10} />} {g}
                    {!busy && <Icon name="external" size={9} style={{ marginLeft: 4, opacity: 0.5 }} />}
                  </button>
                );
              })}
            </div>
          </PivotGroup>
        );
      })()}

      <PivotGroup title="Connected accounts" icon="check" subtitle="Platforms where the subject was found">
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          {Object.entries(foundByPlatform)
            .sort((a, b) => b[1].length - a[1].length)
            .map(([platform, fs]) => (
              <button
                key={platform}
                type="button"
                onClick={() => onPivotClick(`platform:${platform}`)}
                className={`badge ${activeFilter === `platform:${platform}` ? "info" : "muted"}`}
                style={{ cursor: "pointer", padding: "6px 10px", fontSize: 12 }}
              >
                {platform}
                <span style={{ marginLeft: 6, opacity: 0.7 }}>{fs.length}</span>
              </button>
            ))}
        </div>
      </PivotGroup>

      {pivots.emails.length > 0 && (
        <PivotGroup title="Emails" icon="mail" subtitle="Found in profile metadata or bios">
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {pivots.emails.slice(0, 30).map((e) => (
              <button
                key={`e-${e.value}`}
                type="button"
                onClick={() => onPivotClick(`email:${e.value}`)}
                className={`badge ${activeFilter === `email:${e.value}` ? "info" : "muted"}`}
                style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11.5, padding: "4px 8px" }}
                title={`On ${e.platforms.length} platform(s): ${e.platforms.join(", ")}`}
              >
                <Icon name="mail" size={10} /> {e.value}
                {e.platforms.length > 1 && (
                  <span className="badge found" style={{ marginLeft: 6, padding: "0 5px", fontSize: 9 }}>
                    {e.platforms.length}×
                  </span>
                )}
              </button>
            ))}
          </div>
        </PivotGroup>
      )}

      {pivots.urls.length > 0 && (
        <PivotGroup title="URLs" icon="link" subtitle="Websites, profiles, and other links found in metadata">
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {pivots.urls.slice(0, 30).map((u) => (
              <button
                key={`u-${u.value}`}
                type="button"
                onClick={() => onPivotClick(`url:${u.value}`)}
                className={`badge ${activeFilter === `url:${u.value}` ? "info" : "muted"}`}
                style={{ cursor: "pointer", fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 8px", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={u.value}
              >
                <Icon name="link" size={10} /> {u.value.replace(/^https?:\/\//, "").slice(0, 36)}
                {u.platforms.length > 1 && (
                  <span className="badge found" style={{ marginLeft: 6, padding: "0 5px", fontSize: 9 }}>
                    {u.platforms.length}×
                  </span>
                )}
              </button>
            ))}
          </div>
        </PivotGroup>
      )}

      {pivots.handles.length > 0 && (
        <PivotGroup title="Cross-platform handles" icon="at" subtitle="Other social accounts referenced in profiles — click to scan and add to this case">
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {pivots.handles.slice(0, 30).map((h) => {
              const key = `username:${h.handle}`;
              const busy = scanning === key;
              return (
                <button
                  key={`h-${h.platform}-${h.handle}`}
                  type="button"
                  onClick={() => onScan(h.handle, "username")}
                  disabled={busy || (scanning !== null && !busy)}
                  className="badge muted"
                  style={{ cursor: busy ? "wait" : "pointer", fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 8px", opacity: busy ? 0.7 : 1 }}
                  title={`Scan "${h.handle}" as a username and add findings to this case`}
                >
                  {busy ? <span className="spinner" style={{ width: 8, height: 8 }} /> : <Icon name="at" size={10} />} {h.platform}:{h.handle}
                  {!busy && <Icon name="external" size={9} style={{ marginLeft: 4, opacity: 0.5 }} />}
                </button>
              );
            })}
          </div>
        </PivotGroup>
      )}
    </div>
  );
}

function PivotGroup({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: "check" | "mail" | "link" | "at" | "branch" | "info";
  children: React.ReactNode;
}) {
  return (
    <div className="card-entity" style={{ marginBottom: 12, borderLeftColor: "var(--color-cyan)" }}>
      <div className="card-entity-head" style={{ background: "transparent" }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "var(--color-cyan-soft)",
            border: "1px solid rgba(6, 182, 212, 0.3)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-cyan)",
            flexShrink: 0,
          }}
        >
          <Icon name={icon} size={12} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 13 }}>{title}</strong>
          {subtitle && (
            <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{subtitle}</div>
          )}
        </div>
      </div>
      <div className="card-entity-body">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph view: radial SVG (case center, platforms inner ring, pivots outer ring)
// ---------------------------------------------------------------------------

function GraphView({
  findings,
  pivots,
  identifiers,
  onPlatformClick,
  onPivotClick,
}: {
  findings: Finding[];
  pivots: AggregatedPivots;
  identifiers: Identifier[];
  onPlatformClick: (platform: string) => void;
  onPivotClick: (filter: string) => void;
}) {
  const SIZE = 720;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const PLATFORM_R = 200;
  const PIVOT_R = 310;

  const platforms = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of findings) m[f.platform] = (m[f.platform] ?? 0) + 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [findings]);

  const pivotsFlat = useMemo(() => {
    const out: { kind: "email" | "url" | "handle"; value: string; count: number }[] = [];
    for (const e of pivots.emails.slice(0, 12)) out.push({ kind: "email", value: e.value, count: e.platforms.length });
    for (const u of pivots.urls.slice(0, 8)) out.push({ kind: "url", value: u.value, count: u.platforms.length });
    for (const h of pivots.handles.slice(0, 8)) out.push({ kind: "handle", value: `${h.platform}:${h.handle}`, count: 1 });
    return out.slice(0, 20);
  }, [pivots]);

  const totalNodes = platforms.length + pivotsFlat.length;
  if (totalNodes === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><Icon name="info" size={20} /></div>
        <h3>Not enough to graph yet</h3>
        <p>Run collectors to populate findings and pivots.</p>
      </div>
    );
  }

  const platformAngles = platforms.map((_, i) => (i / Math.max(platforms.length, 1)) * Math.PI * 2 - Math.PI / 2);
  const pivotAngles = pivotsFlat.map((_, i) => (i / Math.max(pivotsFlat.length, 1)) * Math.PI * 2 - Math.PI / 2);

  const subject = identifiers[0]?.value ?? "case";

  return (
    <div className="card" style={{ padding: 12, overflow: "auto" }}>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} style={{ maxWidth: "100%", height: "auto" }}>
          {platforms.map(([plat], i) => {
            const a = platformAngles[i];
            const x = CX + PLATFORM_R * Math.cos(a);
            const y = CY + PLATFORM_R * Math.sin(a);
            return (
              <line
                key={`e-${plat}`}
                x1={CX} y1={CY} x2={x} y2={y}
                stroke="var(--color-border)" strokeWidth={1} strokeOpacity={0.5}
              />
            );
          })}
          {pivotsFlat.map((p, i) => {
            const a = pivotAngles[i];
            const x = CX + PIVOT_R * Math.cos(a);
            const y = CY + PIVOT_R * Math.sin(a);
            return (
              <line
                key={`ep-${i}`}
                x1={CX + PLATFORM_R * 0.95 * Math.cos(a)} y1={CY + PLATFORM_R * 0.95 * Math.sin(a)}
                x2={x} y2={y}
                stroke="var(--color-info)" strokeWidth={0.6} strokeOpacity={0.25} strokeDasharray="2 3"
              />
            );
          })}
          <g>
            <circle cx={CX} cy={CY} r={48} fill="var(--color-secondary)" stroke="var(--color-accent)" strokeWidth={2} />
            <text x={CX} y={CY - 4} textAnchor="middle" fill="var(--color-foreground)" fontSize={11} fontWeight={600} fontFamily="var(--font-body)">
              SUBJECT
            </text>
            <text x={CX} y={CY + 12} textAnchor="middle" fill="var(--color-accent)" fontSize={12} fontWeight={500} fontFamily="var(--font-mono)">
              {subject.length > 14 ? subject.slice(0, 14) + "…" : subject}
            </text>
            <text x={CX} y={CY + 28} textAnchor="middle" fill="var(--color-foreground)" fontSize={9} opacity={0.5}>
              {platforms.length} platforms · {pivotsFlat.length} pivots
            </text>
          </g>
          {platforms.map(([plat, count], i) => {
            const a = platformAngles[i];
            const x = CX + PLATFORM_R * Math.cos(a);
            const y = CY + PLATFORM_R * Math.sin(a);
            return (
              <g
                key={`p-${plat}`}
                style={{ cursor: "pointer" }}
                onClick={() => onPlatformClick(plat)}
              >
                <circle cx={x} cy={y} r={20} fill="var(--status-found-bg)" stroke="var(--status-found-border)" strokeWidth={1.5} />
                <text x={x} y={y + 4} textAnchor="middle" fill="var(--status-found-text)" fontSize={11} fontWeight={600}>
                  {plat.length > 8 ? plat.slice(0, 8) + "…" : plat}
                </text>
                {count > 1 && (
                  <text x={x} y={y + 32} textAnchor="middle" fill="var(--color-foreground)" fontSize={9} opacity={0.7}>
                    {count}
                  </text>
                )}
              </g>
            );
          })}
          {pivotsFlat.map((p, i) => {
            const a = pivotAngles[i];
            const x = CX + PIVOT_R * Math.cos(a);
            const y = CY + PIVOT_R * Math.sin(a);
            const filterKey = `${p.kind}:${p.value}`;
            const label =
              p.kind === "email" ? p.value :
              p.kind === "url" ? p.value.replace(/^https?:\/\//, "").slice(0, 20) :
              p.value;
            return (
              <g
                key={`pv-${i}`}
                style={{ cursor: "pointer" }}
                onClick={() => onPivotClick(filterKey)}
              >
                <circle
                  cx={x} cy={y} r={Math.max(10, Math.min(16, 8 + p.count * 2))}
                  fill="var(--status-info-bg)" stroke="var(--status-info-border)" strokeWidth={1}
                />
                <text x={x} y={y + 3} textAnchor="middle" fill="var(--status-info-text)" fontSize={8.5} fontWeight={500}>
                  {p.kind === "email" ? "@" : p.kind === "url" ? "↗" : "#"}
                </text>
                <text
                  x={x + (Math.cos(a) > 0 ? 14 : -14)}
                  y={y}
                  textAnchor={Math.cos(a) > 0 ? "start" : "end"}
                  dominantBaseline="middle"
                  fill="var(--color-foreground)"
                  fontSize={9.5}
                  opacity={0.85}
                  fontFamily="var(--font-mono)"
                >
                  {label.length > 22 ? label.slice(0, 22) + "…" : label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="row" style={{ gap: 16, justifyContent: "center", marginTop: 10, fontSize: 11 }}>
        <span className="row" style={{ gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--status-found-border)", display: "inline-block" }} />
          <span className="muted">Platform ({platforms.length})</span>
        </span>
        <span className="row" style={{ gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--status-info-border)", display: "inline-block" }} />
          <span className="muted">Pivot ({pivotsFlat.length})</span>
        </span>
        <span className="muted">Click a node to filter the cards view</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// All findings (table view, sortable columns)
// ---------------------------------------------------------------------------

function AllFindingsView({
  findings,
  crossLinks,
  isOriginal,
  sortKey,
  sortDir,
  onChangeSort,
  curatedIds,
  onToggleCurate,
}: {
  findings: Finding[];
  crossLinks: ReturnType<typeof buildCrossLinks>;
  isOriginal: (f: Finding) => boolean;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onChangeSort: (k: SortKey) => void;
  curatedIds: Set<string>;
  onToggleCurate: (id: string, next: boolean) => void;
}) {
  if (findings.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><Icon name="search" size={20} /></div>
        <h3>No findings match</h3>
        <p>Try clearing filters or widening the search.</p>
      </div>
    );
  }
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table className="table-sortable">
        <thead>
          <tr>
            <th style={{ width: 36 }} title="Curated for follow-up">
              <Star size={11} style={{ display: "block", margin: "0 auto" }} />
            </th>
            <SortableTh
              label="Status" sortKey="status" active={sortKey} dir={sortDir}
              onClick={() => onChangeSort("status")} width={90}
            />
            <th style={{ width: 100 }}>Type</th>
            <SortableTh
              label="Platform" sortKey="platform" active={sortKey} dir={sortDir}
              onClick={() => onChangeSort("platform")} width={140}
            />
            <SortableTh
              label="Display name" sortKey="display_name" active={sortKey} dir={sortDir}
              onClick={() => onChangeSort("display_name")} width={150}
            />
            <SortableTh
              label="Identifier" sortKey="identifier" active={sortKey} dir={sortDir}
              onClick={() => onChangeSort("identifier")}
            />
            <th style={{ width: 110 }}>Source</th>
            <SortableTh
              label="Added" sortKey="recent" active={sortKey} dir={sortDir}
              onClick={() => onChangeSort("recent")} width={120}
            />
          </tr>
        </thead>
        <tbody>
          {findings.map((f) => {
            const extra = (f.extra_metadata?.extra as Record<string, unknown>) || {};
            const dn = (extra.display_name as string) ?? (extra.fullname as string) ?? (extra.name as string) ?? null;
            const dnMatch = dn && crossLinks.display_names.has(dn);
            const loc = (extra.location as string) || null;
            return (
              <tr key={f.id}>
                <td style={{ textAlign: "center" }}>
                  <button
                    type="button"
                    onClick={() => onToggleCurate(f.id, !curatedIds.has(f.id))}
                    aria-label={curatedIds.has(f.id) ? "Remove from curated" : "Curate this finding"}
                    aria-pressed={curatedIds.has(f.id)}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 4,
                      cursor: "pointer",
                      color: curatedIds.has(f.id) ? "hsl(38 95% 53%)" : "var(--color-foreground) / 0.4",
                      borderRadius: 4,
                    }}
                    title={curatedIds.has(f.id) ? "Curated — click to remove" : "Curate (star for follow-up)"}
                  >
                    <Star
                      size={13}
                      fill={curatedIds.has(f.id) ? "currentColor" : "none"}
                      strokeWidth={curatedIds.has(f.id) ? 0 : 1.6}
                    />
                  </button>
                </td>
                <td><StatusBadge status={f.status} variant="finding" /></td>
                <td>
                  <span className={`badge ${isOriginal(f) ? "info" : "muted"}`} style={{ fontSize: 10 }}>
                    {isOriginal(f) ? "original" : "variation"}
                  </span>
                </td>
                <td className="mono" style={{ fontSize: 12 }}>{f.platform}</td>
                <td style={{ fontSize: 12 }}>
                  {dn ? (
                    <span className={dnMatch ? "cross-link" : ""}>
                      {dn}
                      {dnMatch && <span className="badge found" style={{ fontSize: 9, marginLeft: 6, padding: "0 5px" }}>match</span>}
                    </span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td className="mono" style={{ fontSize: 12, fontWeight: f.status === "found" ? 600 : 400, color: f.status === "found" ? "var(--status-found-text)" : undefined }}>
                  {f.identifier_value}
                </td>
                <td className="muted mono" style={{ fontSize: 11 }}>{f.source_tool}</td>
                <td className="muted mono" style={{ fontSize: 10.5 }}>
                  {formatTime(f.collected_at)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label, sortKey, active, dir, onClick, width,
}: {
  label: string;
  sortKey: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onClick: () => void;
  width?: number;
}) {
  const isSorted = active === sortKey;
  return (
    <th
      onClick={onClick}
      className={isSorted ? "is-sorted" : ""}
      style={{ width }}
    >
      {label}
      <span className="sort-arrow">
        {isSorted ? (
          <Icon name={dir === "asc" ? "arrow-up" : "arrow-down"} size={10} />
        ) : (
          <Icon name="arrow-up" size={10} />
        )}
      </span>
    </th>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// Correlations view: focused list of correlations
// ---------------------------------------------------------------------------

function CorrelationsView({ correlations }: { correlations: Correlation[] }) {
  if (correlations.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon"><Icon name="info" size={20} /></div>
        <h3>No correlations yet</h3>
        <p>Run collectors to generate findings — correlations are derived.</p>
      </div>
    );
  }
  const sorted = [...correlations].sort((a, b) => b.priority - a.priority);
  return (
    <div>
      {sorted.map((corr) => (
        <div className="card" key={corr.id}>
          <div className="card-row" style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>
                <strong>{corr.type}</strong>{" "}
                <StatusBadge status={corr.reviewed ? "approved" : "pending"} variant="review" />
                <span className="muted mono" style={{ fontSize: 11, marginLeft: 8 }}>
                  conf={corr.confidence.toFixed(2)} · pri={corr.priority.toFixed(2)}
                </span>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {corr.entities_involved.join(" · ")}
              </div>
              <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 20, fontSize: 13 }}>
                {corr.evidence.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
              {corr.review_note && (
                <div className="muted" style={{ marginTop: 6, fontSize: 12, fontStyle: "italic" }}>
                  note: {corr.review_note}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Curate banner — surfaces the shortlist so the investigator can run
// enrichment on the curated findings in one shot.
// ---------------------------------------------------------------------------

function CurateBanner({
  caseId,
  count,
  busy,
  error,
  onEnrich,
  onClear,
}: {
  caseId: string;
  count: number;
  busy: boolean;
  error: string | null;
  onEnrich: () => void;
  onClear: () => void;
}) {
  return (
    <div
      className="rounded-lg border p-4 mb-4 flex items-center gap-3 flex-wrap"
      style={{
        background: "linear-gradient(180deg, hsl(38 95% 53% / 0.06) 0%, transparent 100%)",
        borderColor: "hsl(38 95% 53% / 0.35)",
      }}
    >
      <div
        className="flex items-center justify-center w-9 h-9 rounded-md shrink-0"
        style={{
          background: "hsl(38 95% 53% / 0.15)",
          color: "hsl(38 95% 53%)",
        }}
      >
        <Star size={16} fill="currentColor" />
      </div>
      <div className="flex-1 min-w-[200px]">
        <div className="text-sm font-semibold">
          {count} curated finding{count !== 1 ? "s" : ""}
        </div>
        <div className="text-xs text-foreground/60 mt-0.5">
          Starred for follow-up. Enrich them all to pull emails, locations, and links.
        </div>
        {error && (
          <div className="text-xs mt-1" style={{ color: "hsl(0 84% 60%)" }}>
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={`/case/${caseId}/shortlist`}
          className="secondary text-xs"
          style={{ padding: "6px 10px", textDecoration: "none" }}
          title="Open the shortlist overview — every curated + enriched account in one place"
        >
          <Icon name="star" size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />
          View shortlist →
        </Link>
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="ghost text-xs"
          style={{ padding: "6px 10px" }}
          title="Unstar every finding"
        >
          <X size={11} />
          Clear curation
        </button>
        <button
          type="button"
          onClick={onEnrich}
          disabled={busy}
          className="btn-primary text-sm"
          style={{
            padding: "8px 14px",
            background: "hsl(38 95% 53%)",
            borderColor: "hsl(38 95% 53%)",
          }}
          title="Run Firecrawl enrichment on every curated finding in the background"
        >
          {busy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Sparkles size={13} />}
          {busy ? "Queuing…" : "Enrich all curated"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual scan panel — add a username/email to this case without creating a new one
// ---------------------------------------------------------------------------

/** "Related profiles" panel — the investigator's "5 related accounts" row,
 *  matching the Instagram search-results UX. LLM picks 5 close variations
 *  of the case's username (or email) and we surface them as one-click pivots. */
function ChipSkeleton({ count, message }: { count: number; message?: string }) {
  // Shimmering placeholder chips — same shape as the real ones, so the
  // layout doesn't jump when the data lands. Randomised widths so the row
  // looks like real usernames (not a uniform bar).
  const widths = Array.from({ length: count }, (_, i) => 60 + ((i * 23) % 70));
  return (
    <div style={{ paddingTop: 4 }}>
      {message && (
        <div
          className="row"
          style={{ gap: 8, alignItems: "center", marginBottom: 8 }}
        >
          <span className="spinner" style={{ width: 12, height: 12, borderWidth: 1.5 }} />
          <span className="muted" style={{ fontSize: 11.5 }}>
            {message}
          </span>
        </div>
      )}
      <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
        {widths.map((w, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              border: "1px solid var(--color-border-soft)",
              borderRadius: 6,
              overflow: "hidden",
              background: "var(--color-muted)",
              opacity: 0.55,
            }}
          >
            <div
              className="skeleton-shimmer"
              style={{
                fontSize: 12,
                padding: "5px 10px",
                width: w,
                color: "transparent",
                background:
                  "linear-gradient(90deg, var(--color-muted) 0%, var(--color-border-soft) 50%, var(--color-muted) 100%)",
                backgroundSize: "200% 100%",
                animation: "shimmer 1.4s linear infinite",
              }}
            >
              .
            </div>
            <div
              className="skeleton-shimmer"
              style={{
                fontSize: 10,
                padding: "5px 8px",
                borderLeft: "1px solid var(--color-border-soft)",
                width: 38,
                color: "transparent",
                background:
                  "linear-gradient(90deg, var(--color-muted) 0%, var(--color-border-soft) 50%, var(--color-muted) 100%)",
                backgroundSize: "200% 100%",
                animation: "shimmer 1.4s linear infinite",
              }}
            >
              .
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelatedProfilesPanel({
  variants,
  busy,
  error,
  onLoad,
  onScanHere,
  identifiers,
}: {
  variants: { value: string; type: "username" | "email" }[] | null;
  busy: boolean;
  error: string | null;
  onLoad: () => void;
  onScanHere: (value: string, type: "username" | "email") => void;
  identifiers: { type: string; value: string }[];
}) {
  // Only useful for cases with a username or email identifier.
  const hasSubject = identifiers.some((i) => i.type === "username" || i.type === "email");
  if (!hasSubject) return null;

  return (
    <div
      className="card"
      style={{
        padding: "12px 14px",
        marginTop: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="row" style={{ alignItems: "center", gap: 8 }}>
        <Users size={13} style={{ color: "var(--color-cyan)" }} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.04em" }}>
          Related profiles
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          close variations to pivot on
        </span>
        {variants && variants.length > 0 && (
          <span
            className="badge"
            style={{
              fontSize: 9,
              padding: "0 6px",
              background: "var(--color-muted)",
              border: "1px solid var(--color-border-soft)",
            }}
            title={`${variants.length} variation${variants.length === 1 ? "" : "s"} loaded`}
          >
            {variants.length}
          </span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        {variants && !busy && (
          <button
            type="button"
            className="ghost"
            onClick={onLoad}
            style={{ fontSize: 10, padding: "2px 8px" }}
            title="Ask the LLM for 5 MORE close variations (the previously-shown ones will be sent back as 'already seen' so you don't get duplicates)"
          >
            <Sparkles size={10} /> Get 5 more
          </button>
        )}
      </div>

      {/* Initial state: prompt the user to generate */}
      {!variants && !busy && (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: 11.5, flex: 1, minWidth: 200 }}>
            LLM-picked close variations of the subject's identifier — useful for catching
            alternative accounts the subject maintains on the same or nearby handles.
          </span>
          <button
            type="button"
            onClick={onLoad}
            className="secondary"
            style={{ fontSize: 11, padding: "4px 10px" }}
            title="Generate 5 closely related usernames to investigate"
          >
            <Sparkles size={11} />
            Suggest 5 related
          </button>
        </div>
      )}

      {busy && (
        <ChipSkeleton count={5} message="Asking the LLM for 5 close variations…" />
      )}

      {error && (
        <div
          className="hint"
          style={{ borderLeftColor: "var(--color-destructive)", fontSize: 11.5, marginTop: 0 }}
        >
          <Icon name="warning" size={12} /> {error}
        </div>
      )}

      {/* Loaded: show the 5 chips */}
      {variants && variants.length > 0 && (
        <div className="row" style={{ flexWrap: "wrap", gap: 6, paddingTop: 4 }}>
          {variants.map((v, i) => (
            <div
              key={`${v.type}-${v.value}-${i}`}
              className="row"
              style={{
                gap: 0,
                border: "1px solid var(--color-border-soft)",
                borderRadius: 6,
                overflow: "hidden",
                background: "var(--color-muted)",
              }}
            >
              <Link
                href={`/?pivot=${encodeURIComponent(v.value)}&type=${v.type}`}
                className="mono pivot-chip"
                style={{
                  fontSize: 12,
                  padding: "5px 10px",
                  color: "var(--color-foreground)",
                  textDecoration: "none",
                }}
                title={`Open ${v.value} as a new case`}
              >
                {v.value}
              </Link>
              <button
                type="button"
                onClick={() => onScanHere(v.value, v.type)}
                style={{
                  fontSize: 10,
                  padding: "5px 8px",
                  borderLeft: "1px solid var(--color-border-soft)",
                  background: "transparent",
                  color: "var(--color-cyan)",
                  cursor: "pointer",
                }}
                title={`Scan ${v.value} as ${v.type} and merge findings into THIS case`}
              >
                <Icon name="search" size={10} />
                {" scan"}
              </button>
            </div>
          ))}
        </div>
      )}

      {variants && variants.length === 0 && (
        <div className="muted" style={{ fontSize: 11.5 }}>
          The LLM didn't return any variations. Try Refresh.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manual scan panel — add a username/email to this case without creating a new one
// ---------------------------------------------------------------------------

function ManualScanPanel({
  onScan,
  scanning,
  error,
  lastResult,
  activeJob,
}: {
  onScan: (value: string, kind: "username" | "email") => void;
  scanning: string | null;
  error: string | null;
  lastResult: { scanned: string; type: string; findings_added: number; correlations_total: number } | null;
  activeJob: Job | null;
}) {
  const [val, setVal] = useState("");
  const [kind, setKind] = useState<"username" | "email">("username");
  const busy = scanning !== null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!val.trim() || busy) return;
    onScan(val, kind);
  }

  return (
    <form
      onSubmit={submit}
      className="card"
      style={{
        padding: "14px 16px",
        marginBottom: 16,
        background: "linear-gradient(180deg, var(--color-secondary) 0%, var(--color-tertiary) 100%)",
        border: "1px solid var(--color-border-soft)",
      }}
    >
      <div className="row" style={{ gap: 8, alignItems: "center", marginBottom: 10 }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            background: "var(--color-accent-soft)",
            border: "1px solid var(--status-found-border)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-accent)",
          }}
        >
          <Icon name="search" size={13} />
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Add to this case</span>
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
            scan a new username or email and merge findings into this case
          </span>
        </div>
      </div>
      <div className="row" style={{ gap: 8, alignItems: "stretch" }}>
        <div className="select-wrap" style={{ width: 120, flexShrink: 0 }}>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "username" | "email")}
            aria-label="Type"
            disabled={busy}
          >
            <option value="username">username</option>
            <option value="email">email</option>
          </select>
          <Icon name="chevron-down" size={12} className="select-chevron" />
        </div>
        <input
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={kind === "email" ? "e.g. jane@example.com" : "e.g. janedoe"}
          aria-label="Value to scan"
          disabled={busy}
          style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 13 }}
        />
        <button type="submit" disabled={busy || !val.trim()} className="btn-primary">
          {busy ? <span className="spinner" /> : <Icon name="play" size={13} />}
          {busy ? "Scanning…" : "Scan"}
        </button>
      </div>
      {error && (
        <div className="hint" style={{ marginTop: 10, borderLeftColor: "var(--color-destructive)", fontSize: 12 }}>
          <Icon name="warning" size={12} /> {error}
        </div>
      )}
      {lastResult && !error && !activeJob && (
        <div className="hint" style={{ marginTop: 10, borderLeftColor: "var(--color-accent)", fontSize: 12 }}>
          <Icon name="check" size={12} />
          Scanned <code style={{ fontSize: 12 }}>{lastResult.scanned}</code> as <strong>{lastResult.type}</strong> ·
          {" "}added <strong>{lastResult.findings_added}</strong> findings,
          {" "}<strong>{lastResult.correlations_total}</strong> correlations total.
        </div>
      )}
      {activeJob && (
        <div className="hint" style={{ marginTop: 10, borderLeftColor: "var(--color-cyan)", fontSize: 12 }}>
          <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
          Scanning <code style={{ fontSize: 12 }}>{activeJob.target}</code> as <strong>{activeJob.kind.replace("scan_", "")}</strong> ·
          {" "}<span className="muted">{Math.floor(activeJob.elapsed_s)}s elapsed</span> ·
          {" "}<span className="muted">job {activeJob.id.slice(0, 8)}</span>
        </div>
      )}
    </form>
  );
}
