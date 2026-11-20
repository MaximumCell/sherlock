import { describe, expect, it } from "vitest";
import { parseFinding } from "./findings";
import type { Finding, FindingMetadata } from "./types";

const finding = (meta: FindingMetadata, platform = "x"): Finding => ({
  id: "f1",
  case_id: "c1",
  identifier_type: "username",
  identifier_value: "ada",
  source_tool: "m",
  module: "m",
  platform,
  status: "found",
  finding_key: "k",
  extra_metadata: meta,
  curated: false,
  job_id: null,
  collected_at: "2025-01-01T00:00:00Z",
});

describe("parseFinding module renderers", () => {
  it("reads dns_records rows with SPF and DMARC flags", () => {
    const v = parseFinding(finding({ records: { a: ["192.0.2.1"], txt: ["v=spf1 -all"] }, has_spf: true, has_dmarc: false }));
    expect(v.dns?.records).toEqual({ A: ["192.0.2.1"], TXT: ["v=spf1 -all"] });
    expect(v.dns?.dmarc).toBe(false);
    expect(v.other).toEqual([]);
  });

  it("reads internetdb ports and vulns", () => {
    const v = parseFinding(finding({ ports: [443, 22], vulns: ["CVE-1"], hostnames: [] }));
    expect(v.network).toMatchObject({ ports: [22, 443], vulns: ["CVE-1"] });
  });

  it("reads activity histograms and the UTC offset estimate", () => {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const v = parseFinding(
      finding({ activity: { hours_utc: hours, weekdays: [1, 2, 3, 4, 5, 6, 7], sample_size: 9 }, utc_offset_label: "UTC+2" }),
    );
    expect(v.activity).toMatchObject({ hours, sampleSize: 9, offsetLabel: "UTC+2", matrix: null });
  });

  it("reads wallet and image metadata", () => {
    expect(parseFinding(finding({ chain: "bitcoin", balance_btc: "0.1", tx_count: 3 })).wallet).toMatchObject({
      unit: "BTC",
      balance: "0.1",
      txCount: 3,
    });
    const img = parseFinding(finding({ width: 10, height: 20, exif: { camera_make: "A", camera_model: "B" }, gps_present: true }));
    expect(img.image).toMatchObject({ camera: "A B", gpsPresent: true, width: 10 });
  });

  it("falls back to a flattened key/value view for unknown keys", () => {
    const v = parseFinding(finding({ extra: { karma: 12, nested: { a: 1 } }, mystery: ["x", "y"] }));
    expect(v.other).toEqual([
      ["karma", "12"],
      ["nested · a", "1"],
      ["mystery", "x, y"],
    ]);
    expect(v.dns ?? v.network ?? v.wallet ?? v.image ?? v.activity).toBeNull();
  });
});
