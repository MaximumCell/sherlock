"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useData } from "@/components/providers/data-provider";
import { FIXTURE_MODULES } from "../data/fixtures/catalogue";
import type { Job, ModuleInfo } from "../types";
import { applyChangeEvent, keys } from "./cache";

export function useSession() {
  const { ds, mode } = useData();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: keys.session(mode),
    queryFn: () => ds.getSession(),
    staleTime: Infinity,
    retry: 2,
  });
  useEffect(
    () => ds.onSessionChange((session) => client.setQueryData(keys.session(mode), session)),
    [ds, mode, client],
  );
  return query;
}

export function useCaseSummaries() {
  const { ds, mode } = useData();
  return useQuery({ queryKey: keys.cases(mode), queryFn: () => ds.listCaseSummaries() });
}

export function useCase(id: string) {
  const { ds, mode } = useData();
  return useQuery({ queryKey: keys.case(mode, id), queryFn: () => ds.getCase(id) });
}

export function useFindings(id: string) {
  const { ds, mode } = useData();
  return useQuery({ queryKey: keys.findings(mode, id), queryFn: () => ds.listFindings(id) });
}

export function useCorrelations(id: string) {
  const { ds, mode } = useData();
  return useQuery({ queryKey: keys.correlations(mode, id), queryFn: () => ds.listCorrelations(id) });
}

export function useJobs(id: string) {
  const { ds, mode } = useData();
  return useQuery({ queryKey: keys.jobs(mode, id), queryFn: () => ds.listJobs(id) });
}

export function useEntities(id: string) {
  const { ds, mode } = useData();
  return useQuery({ queryKey: keys.entities(mode, id), queryFn: () => ds.listEntities(id) });
}

export function useAudit(caseId: string | null) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: keys.audit(mode, caseId),
    queryFn: () => ds.listAudit(caseId ?? undefined),
  });
}

export function useReport(id: string, enabled: boolean) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: keys.report(mode, id),
    queryFn: () => ds.getReport(id),
    enabled,
    staleTime: 0,
    retry: false,
  });
}

/** Exposure score from the gateway. Retries live in the gateway client (cold start). */
export function useExposure(id: string) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: keys.exposure(mode, id),
    queryFn: () => ds.getExposure(id),
    retry: false,
    staleTime: 30_000,
  });
}

/** Name-search candidates; `data === null` means the gateway does not offer them yet. */
export function useCandidates(id: string, enabled = true) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: keys.candidates(mode, id),
    queryFn: () => ds.listCandidates(id),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export interface ModuleCatalogue {
  modules: ModuleInfo[];
  /** True when the gateway could not be reached and the bundled catalogue is shown. */
  bundled: boolean;
}

export function useModules() {
  const { ds, mode } = useData();
  return useQuery<ModuleCatalogue>({
    queryKey: keys.modules(mode),
    queryFn: async () => {
      try {
        return { modules: await ds.listModules(), bundled: ds.mode === "fixtures" };
      } catch {
        return { modules: FIXTURE_MODULES, bundled: true };
      }
    },
    staleTime: 5 * 60_000,
  });
}

/** Subscribe to Realtime for one case and patch the query cache as rows change. */
export function useCaseRealtime(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  useEffect(
    () =>
      ds.subscribeCase(caseId, (event) => {
        applyChangeEvent(client, mode, caseId, event);
        if (event.table !== "raw_findings" && event.table !== "entities") {
          void client.invalidateQueries({ queryKey: keys.cases(mode), refetchType: "none" });
        }
        if (event.table === "jobs" && event.row?.status === "succeeded") {
          // correlation runs after a module finishes; make sure nothing was missed
          void client.invalidateQueries({ queryKey: keys.correlations(mode, caseId) });
          void client.invalidateQueries({ queryKey: keys.entities(mode, caseId) });
          void client.invalidateQueries({ queryKey: keys.candidates(mode, caseId) });
        }
        if (
          (event.table === "jobs" && event.row?.status === "succeeded") ||
          (event.table === "correlations" && event.type === "UPDATE")
        ) {
          // the score only counts found rows and approved links; refresh lazily
          void client.invalidateQueries({ queryKey: keys.exposure(mode, caseId) });
        }
      }),
    [ds, mode, caseId, client],
  );
}

/** Keep the cases list fresh from Realtime (debounced refetch). */
export function useCaseListRealtime() {
  const { ds, mode } = useData();
  const client = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = ds.subscribeCaseList(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void client.invalidateQueries({ queryKey: keys.cases(mode) });
      }, 800);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [ds, mode, client]);
}

export const STUCK_AFTER_MS = 10_000;
export const WAKE_EVERY_MS = 20_000;

export function hasStuckJobs(jobs: readonly Job[], now: number): boolean {
  return jobs.some((j) => j.status === "queued" && now - Date.parse(j.created_at) > STUCK_AFTER_MS);
}

/**
 * While a case has jobs stuck in `queued` for more than 10 s, poke the gateway
 * (`POST /cases/{id}/wake`) at most every 20 s so a sleeping worker gets woken.
 */
export function useWakeStuckJobs(caseId: string, jobs: readonly Job[] | undefined) {
  const { ds } = useData();
  const lastWake = useRef(0);
  const jobsRef = useRef(jobs);
  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);
  const anyQueued = jobs?.some((j) => j.status === "queued") ?? false;

  useEffect(() => {
    if (!anyQueued) return;
    const check = () => {
      const now = Date.now();
      if (!hasStuckJobs(jobsRef.current ?? [], now)) return;
      if (now - lastWake.current < WAKE_EVERY_MS) return;
      lastWake.current = now;
      ds.wake(caseId).catch(() => {
        // best effort: the next check retries
      });
    };
    check();
    const timer = setInterval(check, 5000);
    return () => clearInterval(timer);
  }, [anyQueued, caseId, ds]);
}
