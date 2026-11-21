import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DataSourceProvider } from "@/components/providers/data-provider";
import { ReadOnlyProvider } from "@/components/providers/read-only";
import { createFixtureDataSource } from "@/lib/data/fixtures";
import { DEMO_CASE_ID } from "@/lib/data/fixtures/demo-case";
import { createReadOnlyDataSource } from "@/lib/data/read-only-source";
import { CaseHeader } from "./case-header";
import { PinToggle } from "./found/account-card";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/cases/x",
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

function wrap(children: ReactNode, readOnly: boolean) {
  const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <DataSourceProvider ds={ds}>
        {readOnly ? <ReadOnlyProvider>{children}</ReadOnlyProvider> : children}
      </DataSourceProvider>
    </QueryClientProvider>
  );
}

async function demoCase() {
  const ds = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
  const c = await ds.getCase(DEMO_CASE_ID);
  if (!c) throw new Error("demo case missing");
  return { ...c, notes: "" };
}

describe("read-only case view", () => {
  it("hides rename, tags, menu and notes in the header", async () => {
    const c = await demoCase();
    const { unmount } = render(wrap(<CaseHeader c={c} />, false));
    expect(screen.getByRole("button", { name: "Rename" })).toBeInTheDocument();
    unmount();
    render(wrap(<CaseHeader c={c} />, true));
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    expect(screen.queryByRole("button", { name: /notes/i })).toBeNull();
    expect(screen.getByRole("link", { name: /operator panel/i })).toHaveAttribute("href", "/admin");
  });

  it("shows a pin as a mark, not a control", () => {
    const onPin = vi.fn();
    const { unmount } = render(wrap(<PinToggle pinned label="x" onPin={onPin} />, false));
    expect(screen.getByRole("button", { name: "Unpin x" })).toBeInTheDocument();
    unmount();
    render(wrap(<PinToggle pinned label="x" onPin={onPin} />, true));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();
  });
});

describe("read-only data source", () => {
  it("serves the snapshot and refuses every write", async () => {
    const base = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    const view = await base.admin.viewCase(DEMO_CASE_ID);
    const ds = createReadOnlyDataSource(base, view);
    expect((await ds.getCase(DEMO_CASE_ID))?.id).toBe(DEMO_CASE_ID);
    expect((await ds.listFindings(DEMO_CASE_ID)).length).toBe(view.findings.length);
    expect(await ds.getCase("other")).toBeNull();
    expect(await ds.getReport(DEMO_CASE_ID)).toContain("#");
    const writes = [
      ds.updateCase(DEMO_CASE_ID, { title: "x" }),
      ds.deleteCase(DEMO_CASE_ID),
      ds.scan(DEMO_CASE_ID, { type: "username", value: "x1" }),
      ds.curateFinding(DEMO_CASE_ID, "f", true),
      ds.reviewCorrelation("c", "approve"),
      ds.cancelJob(DEMO_CASE_ID, "j"),
      ds.cancelBatch(DEMO_CASE_ID, "b"),
      ds.confirmCandidate(DEMO_CASE_ID, "p"),
      ds.createCase({ identifiers: [{ type: "username", value: "x1" }] }),
    ];
    for (const w of writes) await expect(w).rejects.toMatchObject({ status: 403 });
  });

  it("logs each opening in the case's own history (demo)", async () => {
    const base = createFixtureDataSource({ latencyMs: 0, tickMs: 0 });
    const view = await base.admin.viewCase(DEMO_CASE_ID);
    expect(view.audit.some((a) => a.action === "admin_case_viewed")).toBe(true);
    await expect(base.admin.viewCase("00000000-0000-4000-8000-00000000dead")).rejects.toMatchObject(
      {
        status: 404,
      },
    );
  });
});
