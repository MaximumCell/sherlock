import { env, type DataMode } from "../env";
import { createFixtureDataSource } from "./fixtures";
import { createSupabaseDataSource } from "./supabase";
import type { DataSource } from "./types";

const instances = new Map<DataMode, DataSource>();

/** One data source per mode for the lifetime of the page. */
export function getDataSource(mode: DataMode): DataSource {
  let source = instances.get(mode);
  if (!source) {
    source = mode === "supabase" ? createSupabaseDataSource(env) : createFixtureDataSource();
    instances.set(mode, source);
  }
  return source;
}

/** `/demo` always runs on fixtures; everything else follows the environment. */
export function modeForPath(pathname: string | null): DataMode {
  if (pathname === "/demo" || pathname?.startsWith("/demo/")) return "fixtures";
  return env.mode;
}

export type { DataSource } from "./types";
