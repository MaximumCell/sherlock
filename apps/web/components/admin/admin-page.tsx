"use client";

import { LockKeyhole } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { ErrorState } from "@/components/common/states";
import { NotFoundView } from "@/components/common/not-found-view";
import { SignInDialog } from "@/components/shell/sign-in-dialog";
import { Button } from "@/components/ui/button";
import { useAdminMe } from "@/lib/admin/hooks";
import { AdminCaseView } from "./admin-case-view";
import { AdminPanel } from "./admin-panel";
import { AdminSkeleton } from "./admin-skeleton";

/** Anonymous visitors: a calm way in for the operator, and nothing else. */
function SignInGate() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent">
        <LockKeyhole className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Sign in as the operator</h1>
        <p className="text-sm text-muted-foreground">
          This page is for the person who runs this Sherlock instance. Sign in with the operator
          account to continue.
        </p>
      </div>
      <Button onClick={() => setOpen(true)}>Sign in</Button>
      <SignInDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

/**
 * `/admin` and `/demo/admin` (with `caseId`: the read-only case view under the same gate). Anonymous: sign-in gate. Signed in but not an operator: the
 * ordinary not-found page (the panel does not admit it exists). Operator: the panel.
 */
const noop = () => () => {};

export function AdminPage({ caseId }: { caseId?: string } = {}) {
  const me = useAdminMe();
  // The session can settle before this page hydrates; render the server's skeleton first either way.
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  if (!hydrated || me.sessionLoading || (me.enabled && me.isPending)) return <AdminSkeleton />;
  if (!me.signedIn) return <SignInGate />;
  if (me.isError) {
    return (
      <ErrorState
        title="Could not open the operator panel"
        error={me.error}
        onRetry={() => void me.refetch()}
      />
    );
  }
  if (!me.data) return <NotFoundView />;
  return caseId ? <AdminCaseView caseId={caseId} /> : <AdminPanel email={me.data.email} />;
}
