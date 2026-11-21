import { describe, expect, it, vi } from "vitest";
import { upgradeOrSignIn } from "./auth-upgrade";

const ok = () => Promise.resolve({ error: null });
const bad = (message: string) => () => Promise.resolve({ error: { message } });

describe("upgradeOrSignIn", () => {
  it("upgrades an anonymous session in place so its cases stay", async () => {
    const signIn = vi.fn(ok);
    expect(await upgradeOrSignIn(true, ok, signIn, "x")).toBe("upgraded");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("falls back to a plain sign-in when the upgrade fails", async () => {
    const signIn = vi.fn(ok);
    expect(await upgradeOrSignIn(true, bad("identity already linked"), signIn, "x")).toBe(
      "signed_in",
    );
    expect(signIn).toHaveBeenCalledOnce();
  });

  it("signs in directly when the session is not anonymous", async () => {
    const upgrade = vi.fn(ok);
    expect(await upgradeOrSignIn(false, upgrade, ok, "x")).toBe("signed_in");
    expect(upgrade).not.toHaveBeenCalled();
  });

  it("reports a failed fallback", async () => {
    await expect(
      upgradeOrSignIn(true, bad("no"), bad("rate limited"), "Could not send the sign-in link"),
    ).rejects.toThrow("Could not send the sign-in link: rate limited");
  });
});
