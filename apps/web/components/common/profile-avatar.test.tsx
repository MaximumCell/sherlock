import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlatformIcon } from "./platform-icon";
import { ProfileAvatar, avatarState } from "./profile-avatar";

describe("avatar fallback", () => {
  it("decides whether to try the picture", () => {
    expect(avatarState(null, null)).toEqual({ url: null, showImage: false });
    expect(avatarState("javascript:alert(1)", null).showImage).toBe(false);
    expect(avatarState("https://img.example/a.png", null).showImage).toBe(true);
    expect(avatarState("https://img.example/a.png", "https://img.example/a.png").showImage).toBe(false);
    expect(avatarState("data:image/svg+xml,%3Csvg%3E", null).showImage).toBe(true);
  });

  it("loads without a referrer, lazily, and falls back to initials when it fails", () => {
    render(<ProfileAvatar src="https://img.example/a.png" name="Ada Fixture" platform="GitHub" />);
    const img = screen.getByAltText("Profile picture of Ada Fixture");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
    fireEvent.error(img);
    expect(screen.queryByAltText("Profile picture of Ada Fixture")).toBeNull();
    expect(screen.getByRole("img", { name: "Ada Fixture" }).textContent).toContain("AF");
  });

  it("shows initials when there is no picture", () => {
    render(<ProfileAvatar src={null} name="Marlow Quince" />);
    expect(screen.getByRole("img", { name: "Marlow Quince" }).textContent).toBe("MQ");
  });
});

describe("PlatformIcon", () => {
  it("renders a labelled monogram tile for a platform without a glyph", () => {
    render(<PlatformIcon platform="Personal site" labelled />);
    const tile = screen.getByRole("img", { name: "Personal site" });
    expect(tile.textContent).toBe("PS");
  });
});
