import { describe, expect, it } from "vitest";
import { resolveEnv } from "./env";

describe("resolveEnv missing variables", () => {
  it("names only the variables that are actually missing", () => {
    expect(resolveEnv({ supabaseUrl: "https://x.supabase.co" }).missingSupabaseVars).toEqual([
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
    expect(resolveEnv({ supabaseAnonKey: "k" }).missingSupabaseVars).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
    ]);
    expect(resolveEnv({}).missingSupabaseVars).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
    const ok = resolveEnv({ supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "k" });
    expect(ok.missingSupabaseVars).toEqual([]);
    expect(ok.fallback).toBe(false);
  });
});
