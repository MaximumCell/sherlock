/**
 * Fixture-mode switches that let the demo show states a real deployment produces.
 *
 * Signed-out flow: open any page with `?signin=required` (remembered for the tab) or build with
 * NEXT_PUBLIC_FIXTURE_REQUIRE_SIGN_IN=1, and fixture searches need sign-in like the live site.
 * `?signin=off` switches it back. By default the demo needs no account.
 *
 * Refusals and queue states: search one of these fictional usernames in fixture mode.
 */
export const FIXTURE_TRIGGERS = {
  busy: "demo-busy",
  limit: "demo-limit",
  running: "demo-running",
  queued: "demo-queued",
} as const;

export const FIXTURE_SIGN_IN_KEY = "sherlock.fixture-sign-in";

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Pure: whether fixture searches need an account, from the URL query, the tab memory and the build flag. */
export function resolveFixtureSignIn(
  search: string,
  remembered: string | null,
  buildFlag: boolean,
): {
  required: boolean;
  remember: "required" | "off" | null;
} {
  const value = new URLSearchParams(search).get("signin");
  if (value === "required") return { required: true, remember: "required" };
  if (value === "off") return { required: false, remember: "off" };
  if (remembered === "required") return { required: true, remember: null };
  if (remembered === "off") return { required: false, remember: null };
  return { required: buildFlag, remember: null };
}

export function fixtureSignInRequired(buildFlag: boolean): boolean {
  if (typeof window === "undefined") return buildFlag;
  let storage: SessionStorageLike | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  let remembered: string | null = null;
  try {
    remembered = storage?.getItem(FIXTURE_SIGN_IN_KEY) ?? null;
  } catch {
    remembered = null;
  }
  const out = resolveFixtureSignIn(window.location.search, remembered, buildFlag);
  if (out.remember) {
    try {
      storage?.setItem(FIXTURE_SIGN_IN_KEY, out.remember);
    } catch {
      // not remembered: the query parameter still applies to this page
    }
  }
  return out.required;
}
