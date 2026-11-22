import { describe, expect, it } from "vitest";
import { createFixtureDataSource } from "./data/fixtures";
import { GEO_PHOTO_URL, PHOTO_CASE_ID, demoSun, geoFindings } from "./data/fixtures/geo";
import {
  buildClaim,
  claimTime,
  dialPoint,
  fitZoom,
  geoView,
  isGeoFinding,
  pointInView,
  project,
  shadowSegment,
  sortChecks,
  splitClaimTime,
  sunSentence,
  unproject,
  verdictCounts,
  visibleTiles,
  type GeoCheck,
} from "./geo";
import { toPlaceHits } from "./geo-search";

const NOW = Date.parse("2026-11-22T10:00:00Z");

describe("geoView", () => {
  const rows = geoFindings(
    "case-1",
    GEO_PHOTO_URL,
    { place: "Eiffel Tower, Paris", taken_at: "2025-06-14T08:30:00+02:00" },
    NOW,
    {
      camera: true,
      lens: true,
    },
  );

  it("reads every facet of the location check", () => {
    const v = geoView(rows, GEO_PHOTO_URL);
    expect(v.ran).toBe(true);
    expect(v.cameraPoint).toEqual({ lat: 48.86, lon: 2.29 });
    expect(v.claimPoint).toEqual({ lat: 48.86, lon: 2.29 });
    expect(v.location).toEqual({ lat: 48.86, lon: 2.29, source: "camera" });
    expect(v.placeLabel).toBe("16th Arrondissement, Paris, France");
    expect(v.sun.map((s) => s.label)).toEqual(["camera", "claim"]);
    expect(v.sun[0]).toMatchObject({
      localTime: "2025-06-14T20:40",
      compass: "WNW",
      shadowCompass: "ESE",
    });
    expect(v.weather.map((w) => w.summary)).toEqual(["clear sky", "light rain"]);
    expect(v.webcams).toHaveLength(2);
    expect(v.streetLinks.map((l) => l.label)).toEqual([
      "OpenStreetMap",
      "Google Maps",
      "Street View",
      "Mapillary",
    ]);
    expect(v.claim).toEqual({
      place: "Eiffel Tower, Paris",
      taken_at: "2025-06-14T08:30:00+02:00",
    });
    const byKey = Object.fromEntries(v.checks.map((c) => [c.key, c.verdict]));
    expect(byKey).toMatchObject({
      location_distance: "consistent",
      time_difference: "inconsistent",
      time_zone: "consistent",
      lens_place: "consistent",
    });
    expect(v.attributions.join(" ")).toContain("OpenStreetMap");
  });

  it("only looks at this photo's location rows, and skipped facets become notes", () => {
    expect(geoView(rows, "https://other.example/x.jpg").ran).toBe(false);
    const empty = geoView(geoFindings("c", "v", null, NOW), "v");
    expect(empty.location).toBeNull();
    expect(empty.notes[0]?.text).toMatch(/^No location to check/);
    expect(empty.checks[0]?.title).toBe("No camera time or location in the file");
  });

  it("rounds coordinates and ignores malformed checks", () => {
    const f = { ...rows.find((r) => r.platform === "geo-checks")! };
    f.extra_metadata = {
      ...f.extra_metadata,
      checks: [{ title: "ok", reason: "r", verdict: "weird" }, { verdict: "consistent" }, "x"],
      basis: {
        lat: 48.856613,
        lon: 2.352222,
        location_source: "claim",
        camera_gps: { lat: 1.234567, lon: 2.345678 },
      },
    };
    const v = geoView([f], GEO_PHOTO_URL);
    expect(v.checks).toEqual([
      { key: "ok", verdict: "cant_tell", title: "ok", reason: "r", lookFor: null },
    ]);
    expect(v.location).toEqual({ lat: 48.86, lon: 2.35, source: "claim" });
    expect(v.cameraPoint).toEqual({ lat: 1.23, lon: 2.35 });
  });

  it("knows which rows are location context, not accounts", () => {
    expect(isGeoFinding({ module: "geo_context" })).toBe(true);
    expect(isGeoFinding({ module: "geo_webcams" })).toBe(true);
    expect(isGeoFinding({ module: "reverse_image" })).toBe(false);
  });
});

describe("checks", () => {
  const c = (key: string, verdict: GeoCheck["verdict"]): GeoCheck => ({
    key,
    verdict,
    title: key,
    reason: "r",
    lookFor: null,
  });
  it("puts inconsistent first and keeps order otherwise, with counts and no score", () => {
    const list = [
      c("a", "consistent"),
      c("b", "cant_tell"),
      c("d", "inconsistent"),
      c("e", "cant_tell"),
    ];
    expect(sortChecks(list).map((x) => x.key)).toEqual(["d", "b", "e", "a"]);
    expect(verdictCounts(list)).toEqual({ consistent: 1, inconsistent: 1, cant_tell: 2 });
  });
});

describe("sun dial geometry", () => {
  it("puts the zenith in the centre and the horizon on the rim, north up", () => {
    expect(dialPoint(0, 90, 100)).toEqual({ x: 0, y: 0 });
    expect(dialPoint(0, 0, 100)).toEqual({ x: 0, y: -100 });
    expect(dialPoint(90, 0, 100)).toEqual({ x: 100, y: 0 });
    expect(dialPoint(180, 45, 100, 120, 120)).toEqual({ x: 120, y: 170 });
    expect(dialPoint(270, -10, 100)).toEqual({ x: -100, y: 0 }); // below the horizon stays on the rim
  });

  it("draws the shadow away from the sun, longer when the sun is low, capped on the dial", () => {
    const s = shadowSegment(
      { azimuth: 180, elevation: 45, shadowAzimuth: 0, shadowRatio: 1 },
      20,
      80,
    );
    expect(s).toEqual({ x: 0, y: -20, length: 20, capped: false });
    const low = shadowSegment(
      { azimuth: 294.35, elevation: 9.9, shadowAzimuth: 114.35, shadowRatio: 5.73 },
      20,
      80,
    )!;
    expect(low.capped).toBe(true);
    expect(low.length).toBe(80);
    expect(low.x).toBeGreaterThan(0); // towards the east-south-east
    expect(low.y).toBeGreaterThan(0);
    expect(
      shadowSegment({ azimuth: 0, elevation: -3, shadowAzimuth: null, shadowRatio: null }, 20, 80),
    ).toBeNull();
    // computed from the elevation when the ratio is missing
    expect(
      shadowSegment({ azimuth: 90, elevation: 45, shadowAzimuth: null, shadowRatio: null }, 10, 80)!
        .x,
    ).toBeCloseTo(-10, 2);
  });

  it("says it in words", () => {
    const v = geoView(geoFindings("c", GEO_PHOTO_URL, null, NOW, { camera: true }), GEO_PHOTO_URL);
    expect(sunSentence(v.sun[0]!)).toMatch(
      /^At 20:40 local time the sun was 10° up in the WNW; shadows point ESE and are about 5\.\d× as long/,
    );
  });

  it("the demo's sun matches the reference within a tenth of a degree", () => {
    const s = demoSun(48.86, 2.29, new Date("2025-06-14T18:40:00Z"));
    expect(s.azimuth).toBeCloseTo(294.35, 1);
    expect(s.elevation).toBeCloseTo(9.9, 1);
  });
});

describe("OpenStreetMap tiles", () => {
  it("projects and unprojects (rounded to 2 decimals)", () => {
    expect(project({ lat: 0, lon: 0 }, 1)).toEqual({ x: 256, y: 256 });
    const p = project({ lat: 48.86, lon: 2.29 }, 14);
    expect(unproject(p.x, p.y, 14)).toEqual({ lat: 48.86, lon: 2.29 });
  });

  it("covers the viewport and wraps columns", () => {
    const tiles = visibleTiles({ lat: 0, lon: 179.9 }, 2, 512, 256);
    expect(tiles.length).toBeGreaterThanOrEqual(4);
    expect(tiles.every((t) => t.x >= 0 && t.x < 4)).toBe(true);
    expect(pointInView({ lat: 10, lon: 10 }, { lat: 10, lon: 10 }, 5, 400, 300)).toEqual({
      x: 200,
      y: 150,
    });
  });

  it("fits two far points at a lower zoom than two near ones", () => {
    const near = fitZoom(
      [
        { lat: 48.86, lon: 2.29 },
        { lat: 48.87, lon: 2.3 },
      ],
      600,
      320,
    );
    const far = fitZoom(
      [
        { lat: 48.86, lon: 2.29 },
        { lat: 45.76, lon: 4.84 },
      ],
      600,
      320,
    );
    expect(far).toBeLessThan(near);
    expect(fitZoom([{ lat: 1, lon: 1 }], 600, 320)).toBe(14);
  });
});

describe("claim form", () => {
  it("builds the time with its offset and splits it back", () => {
    expect(claimTime("2025-06-14T20:40", "+02:00")).toBe("2025-06-14T20:40:00+02:00");
    expect(claimTime("2025-06-14", "+02:00")).toBeNull();
    expect(splitClaimTime("2025-06-14T20:40:00+02:00")).toEqual({
      local: "2025-06-14T20:40",
      offset: "+02:00",
    });
    expect(splitClaimTime("2025-06-14T18:40:00Z")).toEqual({
      local: "2025-06-14T18:40",
      offset: "+00:00",
    });
    expect(splitClaimTime("nonsense")).toBeNull();
  });

  it("validates a draft into a claim body", () => {
    expect(
      buildClaim({
        place: "  Eiffel  Tower ",
        point: { lat: 48.85837, lon: 2.294481 },
        local: "2025-06-14T20:40",
        offset: "+02:00",
      }),
    ).toEqual({
      claim: {
        place: "Eiffel Tower",
        lat: 48.86,
        lon: 2.29,
        taken_at: "2025-06-14T20:40:00+02:00",
      },
      error: null,
    });
    expect(buildClaim({ place: "", point: null, local: "", offset: "+00:00" })).toEqual({
      claim: null,
      error: null,
    });
    expect(
      buildClaim({ place: "x".repeat(121), point: null, local: "", offset: "+00:00" }).error,
    ).toMatch(/120/);
    expect(
      buildClaim({ place: "", point: null, local: "2999-01-01T00:00", offset: "+00:00" }).error,
    ).toMatch(/future/);
  });

  it("maps place search results, coarse and rounded", () => {
    const hits = toPlaceHits({
      results: [
        {
          id: 2988507,
          name: "Paris",
          latitude: 48.85341,
          longitude: 2.3488,
          admin1: "Île-de-France Region",
          country: "France",
        },
        { name: "No coords" },
      ],
    });
    expect(hits).toEqual([
      {
        id: "2988507",
        label: "Paris",
        detail: "Île-de-France Region, France",
        lat: 48.85,
        lon: 2.35,
      },
    ]);
    expect(toPlaceHits({})).toEqual([]);
  });
});

describe("fixture data source", () => {
  it("has the demo photo case and re-checks a claim, replacing the location rows", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0, now: () => NOW });
    const before = (await ds.listFindings(PHOTO_CASE_ID)).filter(isGeoFinding);
    expect(before.length).toBeGreaterThanOrEqual(5);
    const res = await ds.geoCheck(PHOTO_CASE_ID, {
      claim: { lat: 45.7612, lon: 4.8355, taken_at: "2025-06-14T20:40:00+02:00" },
    });
    expect(res.jobs.map((j) => j.module)).toContain("geo_context");
    expect(res.jobs[0]!.params.claim).toEqual({
      lat: 45.76,
      lon: 4.84,
      taken_at: "2025-06-14T20:40:00+02:00",
    });
    for (let i = 0; i < 30; i++) ds.tick();
    const after = await ds.listFindings(PHOTO_CASE_ID);
    const v = geoView(after, GEO_PHOTO_URL);
    expect(after.filter(isGeoFinding).length).toBe(before.length); // replaced, not added
    expect(v.checks.find((c) => c.key === "location_distance")?.verdict).toBe("inconsistent");
    expect(v.checks.find((c) => c.key === "time_difference")?.verdict).toBe("consistent");
    await expect(
      ds.geoCheck(PHOTO_CASE_ID, { claim: null, value: "https://x.example/y.jpg" }),
    ).rejects.toThrow(/not part/);
    expect((await ds.searchPlaces("par")).map((p) => p.label)).toContain("Paris");
  });
});
