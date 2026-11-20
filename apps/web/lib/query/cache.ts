import type { QueryClient } from "@tanstack/react-query";
import type { DataMode } from "../env";
import type { ChangeEvent, ChangeType } from "../data/types";
import type { Case, Correlation, Entity, Finding, Job } from "../types";

export const keys = {
  session: (mode: DataMode) => [mode, "session"] as const,
  cases: (mode: DataMode) => [mode, "cases"] as const,
  case: (mode: DataMode, id: string) => [mode, "case", id] as const,
  findings: (mode: DataMode, id: string) => [mode, "case", id, "findings"] as const,
  correlations: (mode: DataMode, id: string) => [mode, "case", id, "correlations"] as const,
  jobs: (mode: DataMode, id: string) => [mode, "case", id, "jobs"] as const,
  entities: (mode: DataMode, id: string) => [mode, "case", id, "entities"] as const,
  report: (mode: DataMode, id: string) => [mode, "case", id, "report"] as const,
  exposure: (mode: DataMode, id: string) => [mode, "case", id, "exposure"] as const,
  candidates: (mode: DataMode, id: string) => [mode, "case", id, "candidates"] as const,
  audit: (mode: DataMode, caseId: string | null) => [mode, "audit", caseId ?? "all"] as const,
  modules: (mode: DataMode) => [mode, "modules"] as const,
  platforms: (mode: DataMode) => [mode, "platforms"] as const,
};

/** Apply one Realtime change to a cached list (upsert by id, newest first, or remove). */
export function applyChange<T extends { id: string }>(
  list: readonly T[] | undefined,
  type: ChangeType,
  id: string,
  row: T | null,
): T[] | undefined {
  if (!list) return undefined;
  if (type === "DELETE" || !row) return list.filter((item) => item.id !== id);
  const index = list.findIndex((item) => item.id === id);
  if (index === -1) return [row, ...list];
  const next = [...list];
  next[index] = row;
  return next;
}

/** Patch the query cache for a case from one Realtime event. */
export function applyChangeEvent(
  client: QueryClient,
  mode: DataMode,
  caseId: string,
  event: ChangeEvent,
): void {
  switch (event.table) {
    case "jobs":
      client.setQueryData<Job[]>(keys.jobs(mode, caseId), (old) =>
        applyChange(old, event.type, event.id, event.row),
      );
      break;
    case "raw_findings":
      client.setQueryData<Finding[]>(keys.findings(mode, caseId), (old) =>
        applyChange(old, event.type, event.id, event.row),
      );
      break;
    case "correlations":
      client.setQueryData<Correlation[]>(keys.correlations(mode, caseId), (old) =>
        applyChange(old, event.type, event.id, event.row),
      );
      break;
    case "entities":
      client.setQueryData<Entity[]>(keys.entities(mode, caseId), (old) =>
        applyChange(old, event.type, event.id, event.row),
      );
      break;
    case "cases":
      if (event.type === "DELETE") {
        client.setQueryData<Case | null>(keys.case(mode, caseId), null);
      } else if (event.row) {
        const row = event.row;
        client.setQueryData<Case | null>(keys.case(mode, caseId), (old) =>
          old ? { ...old, ...row } : row,
        );
      }
      break;
  }
}
