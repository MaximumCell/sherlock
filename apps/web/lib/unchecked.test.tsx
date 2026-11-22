import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UncheckedSection } from "@/components/case/found/unchecked-section";
import { buildSummarySentence } from "./case-summary";
import { DEMO_CASE_ID } from "./data/fixtures/demo-case";
import { createFixtureState } from "./data/fixtures/state";
import { countAccounts, groupFindings } from "./finding-groups";
import { computeStats } from "./findings";
import type { Finding } from "./types";
import {
  coverageText,
  foundSiteCount,
  isUnknownFinding,
  uncheckedReasonText,
  uncheckedSites,
} from "./unchecked";

let n = 0;
function row(
  platform: string,
  status: Finding["status"],
  meta: Record<string, unknown> = {},
): Finding {
  n += 1;
  return {
    id: `f${n}`,
    case_id: "c",
    identifier_type: "username",
    identifier_value: "alice",
    source_tool: "whatsmyname",
    module: "whatsmyname",
    platform,
    status,
    finding_key: `k${n}`,
    extra_metadata: { url: null, extra: {}, ...meta } as Finding["extra_metadata"],
    curated: false,
    job_id: null,
    collected_at: "2026-11-22T10:00:00Z",
  };
}

const wall = (platform: string, url: string) =>
  row(platform, "error", { reason: "login_wall", unknown: true, url });

describe("unknown rows", () => {
  it("are error rows with a known reason, never plain errors or summaries", () => {
    expect(isUnknownFinding(wall("Instagram", "https://www.instagram.com/alice/"))).toBe(true);
    expect(isUnknownFinding(row("X", "error", { reason: "rate_limited" }))).toBe(true);
    expect(isUnknownFinding(row("Reddit", "error", { reason: "upstream returned HTTP 500" }))).toBe(
      false,
    );
    expect(isUnknownFinding(row("GitHub", "found"))).toBe(false);
    expect(isUnknownFinding(row("x", "error", { summary: true, reason: "blocked" }))).toBe(false);
  });

  it("say the reason in plain words", () => {
    expect(uncheckedReasonText("login_wall", "Instagram")).toBe(
      "Instagram only shows profiles to signed-in users",
    );
    expect(uncheckedReasonText("rate_limited", "Reddit")).toMatch(/slow down/);
  });

  it("list one entry per platform, walls first, leaving out platforms someone found", () => {
    const findings = [
      wall("Instagram", "https://www.instagram.com/alice/"),
      wall("Instagram", "https://www.instagram.com/alice/"),
      row("Telegram", "error", { reason: "blocked", unknown: true, url: "https://t.me/alice" }),
      wall("Facebook", "https://www.facebook.com/alice"),
      row("Threads", "error", { reason: "blocked", unknown: true }),
      row("Threads", "found", { url: "https://www.threads.com/@alice" }),
      row("Reddit", "error", { reason: "HTTP 500" }),
      row("GitLab", "not_found"),
      row("Unsafe", "error", { reason: "ambiguous", unknown: true, url: "javascript:alert(1)" }),
    ];
    const sites = uncheckedSites(findings);
    expect(sites.map((s) => s.label)).toEqual(["Facebook", "Instagram", "Unsafe", "Telegram"]);
    expect(sites[1]).toMatchObject({
      url: "https://www.instagram.com/alice/",
      reason: "login_wall",
      text: "Instagram only shows profiles to signed-in users",
    });
    expect(sites[2]?.url).toBeNull();
    expect(coverageText(foundSiteCount(findings), sites.length)).toBe(
      "Found on 1 site · 4 couldn't be checked",
    );
    expect(coverageText(12, 0)).toBe("Found on 12 sites");
  });

  it("are not accounts, results or misses", () => {
    const findings = [
      row("GitHub", "found"),
      wall("Instagram", "https://www.instagram.com/alice/"),
    ];
    expect(countAccounts(findings)).toBe(1);
    expect(computeStats(findings, []).accountsFound).toBe(1);
    const [accounts] = groupFindings(findings);
    expect(accounts?.items).toHaveLength(1);
    expect(accounts?.misses).toBe(0);
  });
});

describe("summary sentence", () => {
  it("adds the sites that couldn't be checked", () => {
    const base = {
      subject: "alice",
      accounts: 12,
      results: 12,
      sources: 80,
      breaches: 0,
      pendingLinks: 0,
    };
    expect(buildSummarySentence({ ...base, unchecked: 4 })).toBe(
      "We found 12 accounts for alice across 80 sites. 4 sites couldn't be checked automatically.",
    );
    expect(buildSummarySentence(base)).toBe("We found 12 accounts for alice across 80 sites.");
  });
});

describe("demo case", () => {
  const state = createFixtureState(Date.parse("2026-06-01T12:00:00Z"));
  const findings = state.findings.filter((f) => f.case_id === DEMO_CASE_ID);

  it("has a couldn't-check section with exact profile links", () => {
    const sites = uncheckedSites(findings);
    expect(sites.map((s) => s.label)).toEqual(
      expect.arrayContaining(["Instagram", "TikTok", "Facebook", "X (Twitter)"]),
    );
    expect(sites[0]).toMatchObject({ label: "Instagram", reason: "login_wall" });
    expect(sites.every((s) => s.url?.startsWith("https://"))).toBe(true);
  });
});

describe("UncheckedSection", () => {
  it("renders each site with its reason and an Open profile link", async () => {
    const sites = uncheckedSites([
      wall("Instagram", "https://www.instagram.com/alice/"),
      ...Array.from({ length: 9 }, (_, i) =>
        row(`Site ${i}`, "error", {
          reason: "blocked",
          unknown: true,
          url: `https://s${i}.example/alice`,
        }),
      ),
    ]);
    render(<UncheckedSection sites={sites} />);
    expect(screen.getByRole("heading", { name: /Couldn't check automatically/ })).toBeTruthy();
    const list = screen.getByRole("list", { name: "Couldn't check automatically" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(8);
    expect(screen.getByText("Instagram only shows profiles to signed-in users")).toBeTruthy();
    const open = screen.getByRole("link", { name: "Open the Instagram profile in a new tab" });
    expect(open.getAttribute("href")).toBe("https://www.instagram.com/alice/");
    expect(open.getAttribute("target")).toBe("_blank");
    await userEvent.click(screen.getByRole("button", { name: "Show all 10" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
  });

  it("renders nothing when every site was checked", () => {
    const { container } = render(<UncheckedSection sites={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
