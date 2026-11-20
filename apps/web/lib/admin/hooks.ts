"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useData } from "@/components/providers/data-provider";
import { useSession } from "../query/hooks";
import type { SearchFilters, SessionFilters } from "./types";

export const FEED_REFRESH_MS = 10_000;

const adminKeys = {
  all: (mode: string) => ["admin", mode] as const,
  me: (mode: string, quiet: boolean) => ["admin", mode, "me", quiet] as const,
  overview: (mode: string, days: number) => ["admin", mode, "overview", days] as const,
  searches: (mode: string, f: SearchFilters) => ["admin", mode, "searches", f] as const,
  sessions: (mode: string, f: SessionFilters) => ["admin", mode, "sessions", f] as const,
  session: (mode: string, id: string) => ["admin", mode, "session", id] as const,
};

/**
 * Whether this session is an operator. Only asked for signed-in sessions (an anonymous one
 * never is), so ordinary visitors never wake the gateway for it. `quiet` skips cold-start retries.
 */
export function useAdminMe({ quiet = false }: { quiet?: boolean } = {}) {
  const { ds, mode } = useData();
  const session = useSession();
  const signedIn = Boolean(session.data && !session.data.anonymous);
  const enabled = ds.admin.demo || signedIn;
  const query = useQuery({
    queryKey: adminKeys.me(mode, quiet),
    queryFn: () => ds.admin.me({ quiet }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return {
    ...query,
    sessionLoading: session.isPending,
    signedIn: signedIn || ds.admin.demo,
    enabled,
  };
}

export function useAdminOverview(days: number) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: adminKeys.overview(mode, days),
    queryFn: () => ds.admin.overview(days),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useSearchFeed(filters: SearchFilters, live: boolean) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: adminKeys.searches(mode, filters),
    queryFn: () => ds.admin.searches(filters),
    refetchInterval: live ? FEED_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
}

export function useVisitors(filters: SessionFilters) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: adminKeys.sessions(mode, filters),
    queryFn: () => ds.admin.sessions(filters),
    placeholderData: keepPreviousData,
  });
}

export function useVisitor(userId: string | null) {
  const { ds, mode } = useData();
  return useQuery({
    queryKey: adminKeys.session(mode, userId ?? ""),
    queryFn: () => ds.admin.session(userId ?? ""),
    enabled: Boolean(userId),
  });
}

/** Every operator action refreshes everything the panel shows. */
function useAdminMutation<A, R>(fn: (args: A) => Promise<R>) {
  const { mode } = useData();
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: adminKeys.all(mode) }),
  });
}

export function useBlockVisitor() {
  const { ds } = useData();
  return useAdminMutation(({ userId, reason }: { userId: string; reason: string }) =>
    ds.admin.block(userId, reason),
  );
}

export function useUnblockVisitor() {
  const { ds } = useData();
  return useAdminMutation((userId: string) => ds.admin.unblock(userId));
}

export function useSetPaused() {
  const { ds } = useData();
  return useAdminMutation((paused: boolean) => ds.admin.setPaused(paused));
}

export function useOperatorDeleteCase() {
  const { ds } = useData();
  return useAdminMutation((caseId: string) => ds.admin.deleteCase(caseId));
}
