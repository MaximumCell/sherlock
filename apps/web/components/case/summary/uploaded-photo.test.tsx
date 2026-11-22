import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DataSourceProvider } from "@/components/providers/data-provider";
import { createFixtureDataSource } from "@/lib/data/fixtures";
import { photoResults } from "@/lib/photo-results";
import type { Finding } from "@/lib/types";
import { UploadedPhoto } from "./uploaded-photo";

const VALUE = "storage://media/uploads/00000000-0000-4000-8000-0000000000aa/0a0b0c0d-1e1f-4a2b-8c3d-4e5f6a7b8c9d.jpg";

function row(module: string, status: Finding["status"], meta: Record<string, unknown>, i = 0): Finding {
  return {
    id: `${module}-${i}`,
    case_id: "c",
    identifier_type: "image",
    identifier_value: VALUE,
    source_tool: module,
    module,
    platform: module,
    status,
    finding_key: `${module}-${i}`,
    extra_metadata: meta as Finding["extra_metadata"],
    curated: false,
    job_id: null,
    collected_at: "2026-11-22T10:00:00Z",
  };
}

const FINDINGS: Finding[] = [
  row("image_meta", "found", {
    url: null,
    extra: { avatar_phash: "abcd", note: "This photo contains location data" },
    format: "JPEG", width: 40, height: 30, size_bytes: 1_234_567, gps_present: true,
    exif: { gps_present: true, gps_lat: 51.5, gps_lon: -0.12 },
  }),
  row("reverse_image", "found", { url: "https://b.example/2", title: "Second", source: "B", position: 2 }, 2),
  row("reverse_image", "found", { url: "https://a.example/1", title: "First copy", position: 1, thumbnail: "javascript:alert(1)" }, 1),
  row("reverse_image_links", "found", {
    url: "https://lens.google.com/uploadbyurl?url=x",
    extra: { note: "These links use a private link to your photo that stops working after an hour." },
    engines: { google_lens: "https://lens.google.com/uploadbyurl?url=x", tineye: "https://tineye.com/search?url=x", bad: "javascript:x" },
  }),
];

describe("photoResults", () => {
  it("gathers details, location, ordered matches and safe links", () => {
    const r = photoResults(FINDINGS, VALUE);
    expect(r.hasLocation).toBe(true);
    expect(r.details?.width).toBe(40);
    expect(r.matches.map((m) => m.title)).toEqual(["First copy", "Second"]);
    expect(r.matches[0]).toMatchObject({ source: "a.example", thumbnail: null });
    expect(r.links.map((l) => l.label)).toEqual(["Google Lens", "TinEye"]);
    expect(r.linksNote).toContain("after an hour");
    expect(photoResults(FINDINGS, "https://other.example/a.png").matches).toEqual([]);
  });
});

describe("UploadedPhoto", () => {
  it("shows the location warning, matches, links and the one-hour note", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DataSourceProvider ds={ds}>
          <UploadedPhoto value={VALUE} findings={FINDINGS} />
        </DataSourceProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This photo contains location data");
    expect(screen.getByRole("alert")).not.toHaveTextContent("51.5");
    expect(screen.getByRole("link", { name: /First copy/ })).toHaveAttribute("href", "https://a.example/1");
    expect(screen.getByRole("link", { name: /TinEye/ })).toBeInTheDocument();
    expect(screen.getByTestId("links-note")).toHaveTextContent("stops working after an hour");
    expect(screen.getByText(/not the same face/)).toBeInTheDocument();
    // the demo never "uploaded" this photo, so there is nothing to show
    expect(await screen.findByText(/cannot be shown here/)).toBeInTheDocument();
  });
});

describe("fixture upload", () => {
  it("simulates the upload and produces photo results with the real location flag", async () => {
    const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]);
    const value = await ds.uploadPhoto(new Blob([jpeg], { type: "image/jpeg" }), "jpg");
    expect(value).toMatch(/^storage:\/\/media\/uploads\/00000000-0000-4000-8000-0000000000aa\/[0-9a-f-]{36}\.jpg$/);
    expect(await ds.photoUrl(value)).toMatch(/^blob:/);
    const { case: c } = await ds.createCase({ identifiers: [{ type: "image", value }] });
    for (let i = 0; i < 40; i++) ds.tick();
    const findings = await ds.listFindings(c.id);
    const r = photoResults(findings, value);
    expect(r.details?.sizeBytes).toBe(jpeg.length);
    expect(r.hasLocation).toBe(false);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.linksNote).toContain("after an hour");
    await ds.deleteCase(c.id);
    expect(await ds.photoUrl(value)).toBeNull();
  });
});
