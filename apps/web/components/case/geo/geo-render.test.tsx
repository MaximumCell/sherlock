import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GEO_PHOTO_URL, geoFindings } from "@/lib/data/fixtures/geo";
import { geoView } from "@/lib/geo";
import { CheckList } from "./check-list";
import { SunDial } from "./sun-dial";

const view = geoView(
  geoFindings(
    "c",
    GEO_PHOTO_URL,
    { place: "Eiffel Tower, Paris", taken_at: "2025-06-14T08:30:00+02:00" },
    Date.now(),
    {
      camera: true,
      lens: true,
    },
  ),
  GEO_PHOTO_URL,
);

describe("CheckList", () => {
  it("shows each check with its verdict, inconsistent first, and what to look at", () => {
    render(<CheckList checks={view.checks} />);
    const items = within(screen.getByRole("list", { name: "Checks" })).getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-verdict", "inconsistent");
    expect(items[0]).toHaveTextContent("Inconsistent");
    expect(screen.getByText("Google Lens titles mention Eiffel Tower, Paris")).toBeInTheDocument();
    expect(screen.getAllByText(/What to look at:/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/score/i)).toBeNull();
  });

  it("explains an empty list", () => {
    render(<CheckList checks={[]} />);
    expect(screen.getByText(/No checks yet/)).toBeInTheDocument();
  });
});

describe("SunDial", () => {
  it("draws both moments with a shadow for each sun above the horizon and describes them", () => {
    const { container } = render(<SunDial moments={view.sun} />);
    expect(container.querySelector('[data-testid="sun-camera"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="shadow-camera"]')).not.toBeNull();
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/shadows point ESE/);
    expect(screen.getByText("Camera time.")).toBeInTheDocument();
    expect(screen.getByText("Claimed time.")).toBeInTheDocument();
  });
});
