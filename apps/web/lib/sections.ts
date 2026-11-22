/** The sections of the single scrollable case page, and how old `?tab=` links map onto them. */

export const CASE_SECTIONS = [
  "summary",
  "where",
  "found",
  "links",
  "people",
  "map",
  "next",
  "history",
  "report",
] as const;
export type CaseSection = (typeof CASE_SECTIONS)[number];

export const SECTION_LABEL: Record<CaseSection, string> = {
  summary: "Summary",
  where: "Where and when",
  found: "What we found",
  links: "Possible links",
  people: "People",
  map: "Connections map",
  next: "Next steps",
  history: "History",
  report: "Report",
};

/** The anchor of the scan progress panel (step 1 of the rail); it lives inside Summary. */
export const SCAN_ANCHOR = "scan";

const LEGACY_TABS: Record<string, CaseSection> = {
  overview: "summary",
  people: "people",
  findings: "found",
  graph: "map",
  timeline: "history",
  review: "links",
  report: "report",
};

export function isCaseSection(value: string | null | undefined): value is CaseSection {
  return (CASE_SECTIONS as readonly string[]).includes(value ?? "");
}

/** People shows for name searches, "Where and when" for photo investigations. */
export function visibleSections(hasPeople: boolean, hasPhoto = false): CaseSection[] {
  return CASE_SECTIONS.filter((s) => (s !== "people" || hasPeople) && (s !== "where" || hasPhoto));
}

/**
 * Which section a URL points at: `#links`, `?section=links`, or a legacy `?tab=review`.
 * Returns null when nothing (or an unavailable section) is requested.
 */
export function sectionFromUrl(
  params: { get(name: string): string | null },
  hash: string,
  hasPeople: boolean,
  hasPhoto = false,
): CaseSection | null {
  const fromHash = hash.replace(/^#/, "");
  const candidates = [fromHash, params.get("section"), LEGACY_TABS[params.get("tab") ?? ""]];
  for (const value of candidates) {
    if (value === SCAN_ANCHOR) return "summary";
    if (isCaseSection(value) && (value !== "people" || hasPeople) && (value !== "where" || hasPhoto))
      return value;
  }
  return null;
}

/** The URL fragment for a section. */
export const sectionHash = (section: CaseSection | typeof SCAN_ANCHOR) => `#${section}`;
