import { afterEach, describe, expect, it } from "vitest";
import { buildAccounts } from "./accounts";
import { brandColours, contrast, hexToRgb, CARD_DARK, CARD_LIGHT, initials, monogram, monogramHue } from "./brand-colour";
import { parseFinding } from "./findings";
import { PLATFORM_GLYPHS } from "./platform-glyphs";
import {
  PLATFORM_SNAPSHOT,
  bestPlatformLabel,
  canonicalPlatform,
  installPlatforms,
  resolvePlatform,
  toPlatformEntries,
} from "./platforms";
import {
  LINKEDIN_PROVENANCE,
  distinctFaces,
  findingPlatform,
  profileLevel,
  provenanceLabel,
  sortRichFirst,
} from "./profile";
import type { Finding, JsonObject } from "./types";

let n = 0;
function row(platform: string, extra: JsonObject = {}, over: Partial<Finding> = {}): Finding {
  n += 1;
  return {
    id: `f${n}`,
    case_id: "c",
    identifier_type: "username",
    identifier_value: "kit",
    source_tool: "user_scanner",
    module: "user_scanner",
    platform,
    status: "found",
    finding_key: `k${n}`,
    extra_metadata: { url: null, extra },
    curated: false,
    job_id: null,
    collected_at: "2026-01-01T00:00:00Z",
    ...over,
  };
}

describe("platform resolution", () => {
  afterEach(() => installPlatforms(PLATFORM_SNAPSHOT));

  it("maps spellings, registry aliases and local aliases to one key and label", () => {
    for (const name of ["github", "GitHub", "GitHub (User)", "gh", "github user", "Github Gists"]) {
      expect(resolvePlatform(name)).toMatchObject({ key: "github", label: "GitHub", known: true });
    }
    expect(resolvePlatform("x").key).toBe("twitter");
    expect(resolvePlatform("Twitter archived profile").key).toBe("twitter");
    expect(resolvePlatform("scraped:Instagram").label).toBe("Instagram");
    expect(resolvePlatform("Docker Hub User").key).toBe("dockerhub");
    expect(resolvePlatform("ok.ru").key).toBe("okru");
    expect(canonicalPlatform("YT")).toBe("youtube");
  });

  it("maps profile URLs and hosts, including subdomains", () => {
    expect(resolvePlatform(null, "https://www.linkedin.com/in/ada").key).toBe("linkedin");
    expect(resolvePlatform("twitter.com").key).toBe("twitter");
    expect(resolvePlatform("Some Site", "https://gist.github.com/ada").key).toBe("github");
    expect(resolvePlatform(null, "https://netflixtechblog.medium.com/").key).toBe("medium");
  });

  it("keeps unknown platforms readable", () => {
    expect(resolvePlatform("Personal site")).toMatchObject({
      key: "personalsite",
      label: "Personal site",
      known: false,
      category: "other",
    });
    expect(resolvePlatform("forum.example.org")).toMatchObject({
      key: "forum.example.org",
      label: "forum.example.org",
      known: false,
    });
    expect(resolvePlatform("")).toMatchObject({ key: "", known: false });
    expect(bestPlatformLabel(["linkedin", "LinkedIn"])).toBe("LinkedIn");
  });

  it("uses the live registry once installed and validates its rows", () => {
    expect(resolvePlatform("Fediforum").known).toBe(false);
    installPlatforms(
      toPlatformEntries([
        { key: "fediforum", label: "FediForum", domain: "fedi.example", category: "forum", aliases: ["ff"], hosts: [] },
        { label: "no key" },
        "junk",
      ]),
    );
    expect(resolvePlatform("ff")).toMatchObject({ key: "fediforum", label: "FediForum", category: "forum" });
    expect(resolvePlatform(null, "https://fedi.example/u/a").key).toBe("fediforum");
    installPlatforms([]); // an empty answer never wipes the registry
    expect(resolvePlatform("ff").known).toBe(true);
  });
});

describe("platform icons", () => {
  it("has a real glyph for common platforms and none for the rest (monogram)", () => {
    for (const key of ["github", "twitter", "instagram", "youtube", "mastodon", "bluesky", "reddit", "gravatar"]) {
      expect(PLATFORM_GLYPHS[key]?.path.length).toBeGreaterThan(10);
    }
    expect(PLATFORM_GLYPHS.linkedin).toBeUndefined(); // not in simple-icons: monogram
    const known = PLATFORM_SNAPSHOT.filter((p) => PLATFORM_GLYPHS[p.key]).length;
    expect(known).toBeGreaterThan(120);
  });

  it("keeps glyph colours readable on both themes, including near-black and pale brands", () => {
    for (const hex of ["181717", "000000", "FFFC00", "FFFFFF", "FF0069", "1185FE"]) {
      const c = brandColours(hex)!;
      expect(contrast(hexToRgb(c.light)!, CARD_LIGHT)).toBeGreaterThanOrEqual(3);
      expect(contrast(hexToRgb(c.dark)!, CARD_DARK)).toBeGreaterThanOrEqual(3);
    }
    expect(brandColours("nope")).toBeNull();
  });

  it("builds monograms and initials deterministically", () => {
    expect(monogram("Hacker News")).toBe("HN");
    expect(monogram("Pixelfed")).toBe("Pi");
    expect(monogram("LinkedIn", "linkedin")).toBe("in");
    expect(monogram("Weibo", "weibo")).toBe("We");
    expect(monogram("")).toBe("?");
    expect(monogramHue("linkedin")).toBe(monogramHue("linkedin"));
    expect(initials("Ada Fixture")).toBe("AF");
    expect(initials("@ada")).toBe("AD");
    expect(initials("Marlow Q. Quince")).toBe("MQ");
    expect(initials("")).toBe("?");
  });
});

describe("profiles", () => {
  it("sorts accounts with a picture or name before bare ones, keeping order inside", () => {
    const rows = [
      row("Reddit"),
      row("GitHub", { bio: "hi" }),
      row("Steam", { avatar_url: "https://img.example/a.png" }),
      row("Twitch"),
      row("GitLab", { fullname: "Kit" }),
    ];
    const { accounts } = buildAccounts(rows, []);
    expect(accounts.map((a) => profileLevel(a.view))).toEqual([0, 1, 2, 0, 2]);
    expect(sortRichFirst(accounts).map((a) => a.primary.platform)).toEqual([
      "Steam",
      "GitLab",
      "GitHub",
      "Reddit",
      "Twitch",
    ]);
  });

  it("dedupes faces by image URL and by stored image fingerprint, up to the limit", () => {
    const a = "https://img.example/a.png";
    const rows = [
      row("GitHub", { avatar_url: a, fullname: "Kit" }),
      row("GitLab", { avatar_url: a }),
      row("Mastodon", { avatar_url: "https://img.example/b.png", avatar_phash: "ff00" }),
      row("avatar", { avatar_url: "https://img.example/b-copy.png", avatar_phash: "ff00", source_platform: "Bluesky" }, { identifier_type: "image" }),
      row("Steam", { avatar_url: "https://img.example/c.png" }),
      row("Reddit"),
    ];
    const { accounts } = buildAccounts(rows, []);
    const faces = distinctFaces(accounts);
    expect(faces.map((f) => f.url)).toEqual([a, "https://img.example/b.png", "https://img.example/c.png"]);
    expect(faces[0]).toMatchObject({ name: "Kit", platform: "GitHub" });
    expect(distinctFaces(accounts, 2)).toHaveLength(2);
    expect(findingPlatform(rows[3]!)).toBe("Bluesky");
  });

  it("labels where profile details came from", () => {
    expect(provenanceLabel(null)).toBeNull();
    expect(provenanceLabel({ source: "page-meta" })?.label).toBe("From the public profile page");
    expect(provenanceLabel({ source: "search-snippet" }, "Mastodon")?.label).toBe("From search results");
    expect(provenanceLabel({ source: "search-snippet" }, "linkedin")?.label).toBe(LINKEDIN_PROVENANCE);
    const v = parseFinding(
      row("linkedin", {
        fullname: "Kit",
        headline: "Engineer",
        employer: "Example Ltd",
        preview: { source: "search-snippet", fetched_at: "2026-11-20T08:00:00Z", title: "Kit | LinkedIn" },
      }),
    );
    expect(v.preview).toMatchObject({ source: "search-snippet", fetchedAt: "2026-11-20T08:00:00Z" });
    expect(v.headline).toBe("Engineer");
    expect(v.other.map(([k]) => k)).not.toContain("preview · source");
    expect(parseFinding(row("x", { preview: { source: "scraper" } })).preview).toBeNull();
  });
});

describe("links", () => {
  it("names an unknown link by its host", () => {
    expect(resolvePlatform(null, "https://ada-fixture.example/blog")).toMatchObject({
      key: "ada-fixture.example",
      known: false,
    });
  });
});
