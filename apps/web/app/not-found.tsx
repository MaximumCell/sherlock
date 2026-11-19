import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <SearchX className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-mono text-xs text-muted-foreground">404</p>
        <h1 className="text-xl font-semibold">No trace of that page</h1>
        <p className="text-sm text-muted-foreground">
          The link may be old, or the page may have moved into the case workspace.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/">Back to cases</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/demo">Open the demo</Link>
        </Button>
      </div>
    </div>
  );
}
