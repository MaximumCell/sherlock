"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
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
      className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/10 text-danger">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">This page ran into a problem</h1>
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
