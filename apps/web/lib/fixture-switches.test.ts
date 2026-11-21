import { describe, expect, it } from "vitest";
import { resolveFixtureSignIn } from "./fixture-switches";

describe("resolveFixtureSignIn", () => {
  it("is off by default so the demo needs no account", () => {
    expect(resolveFixtureSignIn("", null, false)).toEqual({ required: false, remember: null });
  });
  it("turns on and off from the query and remembers it for the tab", () => {
    expect(resolveFixtureSignIn("?signin=required", null, false)).toEqual({
      required: true,
      remember: "required",
    });
    expect(resolveFixtureSignIn("", "required", false).required).toBe(true);
    expect(resolveFixtureSignIn("?signin=off", "required", true)).toEqual({
      required: false,
      remember: "off",
    });
  });
  it("follows the build flag when nothing else says", () => {
    expect(resolveFixtureSignIn("", null, true).required).toBe(true);
  });
});
