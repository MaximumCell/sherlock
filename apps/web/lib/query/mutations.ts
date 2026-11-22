"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useData } from "@/components/providers/data-provider";
import { GatewayError, describeError } from "../data/gateway";
import { applyReview } from "../review";
import { requestActiveSearchDialog } from "../active-search-prompt";
import { SIGN_IN_REASON, classifyRefusal } from "../search-refusal";
import { requestSignIn } from "../sign-in-prompt";
import type {
  Candidate,
  Case,
  Correlation,
  CreateCaseBody,
  Entity,
  Finding,
  GeoCheckBody,
  Job,
  ReviewDecision,
  ScanBody,
  UpdateCaseBody,
} from "../types";
import { applyChange, keys } from "./cache";

/**
 * Every command failure surfaces somewhere; nothing fails silently. Search refusals get their
 * own treatment: sign-in opens the sign-in dialog, an unfinished search opens the dialog that
 * offers to open or stop it, limits and "busy" say how long to wait.
 */
function reportError(title: string, err: unknown) {
  const refusal = classifyRefusal(err);
  if (refusal?.kind === "sign_in") {
    requestSignIn(SIGN_IN_REASON);
    return;
  }
  if (refusal?.kind === "active_search" && refusal.activeSearch) {
    requestActiveSearchDialog(refusal.activeSearch);
    return;
  }
  if (refusal && refusal.kind !== "forbidden") {
    toast.error(refusal.title, { description: refusal.description, duration: 10000 });
    return;
  }
  const signIn =
    err instanceof GatewayError && err.status === 403 && /sign|anonymous|account/i.test(err.detail);
  toast.error(title, {
    description: signIn ? `${describeError(err)} Sign in to continue.` : describeError(err),
    action: signIn ? { label: "Sign in", onClick: () => requestSignIn() } : undefined,
  });
  if (signIn) requestSignIn(describeError(err));
}

export function useCreateCase() {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCaseBody) => ds.createCase(body),
    onSuccess: ({ case: created, jobs }) => {
      client.setQueryData(keys.case(mode, created.id), created);
      client.setQueryData(keys.jobs(mode, created.id), jobs);
      void client.invalidateQueries({ queryKey: keys.cases(mode) });
    },
    onError: (err) => reportError("Could not create the investigation", err),
  });
}

/**
 * Create a case and start its scan. With `modules` (a subset of data sources) the case is
 * created without a scan and one scan limited to those sources is queued right after.
 */
export function useStartInvestigation() {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, modules }: { body: CreateCaseBody; modules?: string[] }) => {
      if (!modules) return ds.createCase({ ...body, scan: true });
      const created = await ds.createCase({ ...body, scan: false });
      const first = body.identifiers[0];
      if (!first) return created;
      const { jobs } = await ds.scan(created.case.id, {
        type: first.type,
        value: first.value,
        modules,
        ...(body.hints ? { hints: body.hints } : {}),
      });
      return { case: created.case, jobs };
    },
    onSuccess: ({ case: created, jobs }) => {
      client.setQueryData(keys.case(mode, created.id), created);
      client.setQueryData(keys.jobs(mode, created.id), jobs);
      void client.invalidateQueries({ queryKey: keys.cases(mode) });
    },
    onError: (err) => reportError("Could not start the search", err),
  });
}

export function useUpdateCase(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateCaseBody) => ds.updateCase(caseId, body),
    onSuccess: (updated) => {
      client.setQueryData<Case | null>(keys.case(mode, caseId), updated);
      void client.invalidateQueries({ queryKey: keys.cases(mode) });
    },
    onError: (err) => reportError("Could not save the case", err),
  });
}

export function useDeleteCase() {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => ds.deleteCase(caseId),
    onSuccess: (_void, caseId) => {
      client.removeQueries({ queryKey: keys.case(mode, caseId) });
      void client.invalidateQueries({ queryKey: keys.cases(mode) });
    },
    onError: (err) => reportError("Could not delete the case", err),
  });
}

export function useScan(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ScanBody) => ds.scan(caseId, body),
    onSuccess: ({ jobs }, body) => {
      client.setQueryData<Job[]>(keys.jobs(mode, caseId), (old) =>
        jobs.reduce<Job[] | undefined>(
          (list, job) => applyChange(list, "INSERT", job.id, job),
          old,
        ),
      );
      void client.invalidateQueries({ queryKey: keys.cases(mode) });
      toast.success(`Searching ${body.value}`, {
        description: `Checking ${jobs.length} data source${jobs.length === 1 ? "" : "s"}. Follow along in Scan progress.`,
      });
    },
    onError: (err) => reportError("Could not start the search", err),
  });
}

/** Set or clear a photo's claim and re-run only the location check ("Where and when"). */
export function useGeoCheck(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: GeoCheckBody) => ds.geoCheck(caseId, body),
    onSuccess: ({ jobs }, body) => {
      client.setQueryData<Job[]>(keys.jobs(mode, caseId), (old) =>
        jobs.reduce<Job[] | undefined>(
          (list, job) => applyChange(list, "INSERT", job.id, job),
          old,
        ),
      );
      toast.success(body.claim ? "Checking the claim" : "Claim cleared", {
        description: "The location checks run again; results update here in a few seconds.",
      });
    },
    onError: (err) => reportError("Could not check the claim", err),
  });
}

export function useCancelJob(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (jobId: string) => ds.cancelJob(caseId, jobId),
    onSuccess: (job) => {
      client.setQueryData<Job[]>(keys.jobs(mode, caseId), (old) =>
        applyChange(old, "UPDATE", job.id, job),
      );
    },
    onError: (err) => reportError("Could not stop that source", err),
  });
}

/** Stop whole searches (every batch given), e.g. "Stop it" on the previous-search dialog. */
export function useCancelSearch() {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ caseId, batchIds }: { caseId: string; batchIds: string[] }) => {
      const results = await Promise.all(batchIds.map((b) => ds.cancelBatch(caseId, b)));
      return { caseId, jobs: results.flatMap((r) => r.jobs) };
    },
    onSuccess: ({ caseId, jobs }) => {
      client.setQueryData<Job[]>(keys.jobs(mode, caseId), (old) =>
        jobs.reduce<Job[] | undefined>((list, job) => applyChange(list, "UPDATE", job.id, job), old),
      );
      void client.invalidateQueries({ queryKey: keys.cases(mode) });
    },
    onError: (err) => reportError("Could not stop the search", err),
  });
}

export function useCurate(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  const key = keys.findings(mode, caseId);
  return useMutation({
    mutationFn: (v: { findingId: string; curated: boolean }) =>
      ds.curateFinding(caseId, v.findingId, v.curated),
    onMutate: async (v) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Finding[]>(key);
      client.setQueryData<Finding[]>(key, (old) =>
        old?.map((f) => (f.id === v.findingId ? { ...f, curated: v.curated } : f)),
      );
      return { previous };
    },
    onError: (err, _v, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      reportError("Could not update your pins", err);
    },
  });
}

export interface ReviewVariables {
  id: string;
  decision: ReviewDecision;
  note?: string;
}

/** Optimistic review: the queue updates instantly and rolls back if the gateway rejects it. */
export function useReview(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  const key = keys.correlations(mode, caseId);
  return useMutation({
    mutationFn: (v: ReviewVariables) => ds.reviewCorrelation(v.id, v.decision, v.note),
    onMutate: async (v) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<Correlation[]>(key);
      client.setQueryData<Correlation[]>(key, (old) => (old ? applyReview(old, v) : old));
      return { previous };
    },
    onSuccess: (saved) => {
      client.setQueryData<Correlation[]>(key, (old) => applyChange(old, "UPDATE", saved.id, saved));
      void client.invalidateQueries({ queryKey: keys.cases(mode), refetchType: "none" });
      void client.invalidateQueries({ queryKey: keys.exposure(mode, caseId) });
    },
    onError: (err, _v, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      reportError("Your decision was not saved", err);
    },
  });
}

/** "This is the person": records the choice; the returned entities become pivot suggestions. */
export function useConfirmCandidate(caseId: string) {
  const { ds, mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (candidateId: string) => ds.confirmCandidate(caseId, candidateId),
    onSuccess: (added, candidateId) => {
      client.setQueryData<Candidate[] | null>(keys.candidates(mode, caseId), (old) =>
        old?.map((c) => ({ ...c, confirmed: c.candidate_id === candidateId })),
      );
      client.setQueryData<Entity[]>(keys.entities(mode, caseId), (old) =>
        added.reduce<Entity[] | undefined>((list, e) => applyChange(list, "INSERT", e.id, e), old),
      );
      void client.invalidateQueries({ queryKey: keys.entities(mode, caseId) });
      toast.success("Person confirmed", {
        description: added.length
          ? `${added.length} new suggested search${added.length === 1 ? "" : "es"} in Next steps. Nothing was searched yet.`
          : "No new searches to suggest.",
      });
    },
    onError: (err) => reportError("Could not confirm this person", err),
  });
}
