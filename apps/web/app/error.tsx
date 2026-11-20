"use client";

import Link from "next/link";
import { BrokenLink } from "@/components/common/not-found-view";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="mx-auto flex max-w-lg flex-col items-center gap-6 py-20 text-center"
    >
      <BrokenLink tone="danger" />
      <div className="space-y-2">
        <h1 className="font-display text-4xl tracking-tight">This page ran into a problem</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong while showing it. Your data is safe and nothing was changed. Try
          again, or go back to the start.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">ref {error.digest}</p>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Back to the start</Link>
        </Button>
      </div>
    </div>
  );
}
