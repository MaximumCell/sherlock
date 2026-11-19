/** Public runtime configuration. NEXT_PUBLIC_* values are inlined at build time. */

export type DataMode = "supabase" | "fixtures";

export interface AppEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  apiUrl: string;
  fixturesRequested: boolean;
  supabaseConfigured: boolean;
  isDevelopment: boolean;
  /** Which data layer the app (outside /demo) runs on. */
  mode: DataMode;
  /** True when we fell back to fixtures because configuration is missing. */
  fallback: boolean;
  /** The Supabase variables that are empty or invalid, by name. */
  missingSupabaseVars: string[];
}

export interface RawEnv {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiUrl?: string;
  fixtures?: string;
  nodeEnv?: string;
}

export function resolveEnv(raw: RawEnv): AppEnv {
  const supabaseUrl = (raw.supabaseUrl ?? "").trim();
  const supabaseAnonKey = (raw.supabaseAnonKey ?? "").trim();
  const fixturesRequested = raw.fixtures === "1" || raw.fixtures === "true";
  const urlOk = /^https?:\/\//.test(supabaseUrl);
  const keyOk = supabaseAnonKey.length > 0;
  const supabaseConfigured = urlOk && keyOk;
  const missingSupabaseVars = [
    ...(urlOk ? [] : ["NEXT_PUBLIC_SUPABASE_URL"]),
    ...(keyOk ? [] : ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]),
  ];
  const mode: DataMode = fixturesRequested || !supabaseConfigured ? "fixtures" : "supabase";
  return {
    supabaseUrl,
    supabaseAnonKey,
    apiUrl: (raw.apiUrl ?? "http://localhost:8000").trim().replace(/\/+$/, ""),
    fixturesRequested,
    supabaseConfigured,
    isDevelopment: raw.nodeEnv === "development",
    mode,
    fallback: !fixturesRequested && !supabaseConfigured,
    missingSupabaseVars,
  };
}

export const env: AppEnv = resolveEnv({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  fixtures: process.env.NEXT_PUBLIC_FIXTURES,
  nodeEnv: process.env.NODE_ENV,
});
