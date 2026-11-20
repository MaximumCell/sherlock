import Link from "next/link";
import { Button } from "@/components/ui/button";

/** Two nodes whose link breaks off: the map's own vocabulary for "nothing here". */
export function BrokenLink({ tone = "muted" }: { tone?: "muted" | "danger" }) {
  const stroke = tone === "danger" ? "stroke-danger" : "stroke-muted-foreground";
  return (
    <svg viewBox="0 0 160 48" className="h-12 w-40" aria-hidden>
      <circle cx="16" cy="24" r="7" className={`fill-background ${stroke}`} strokeWidth="1.5" />
      <path d="M23 24 H66" className={stroke} strokeWidth="1.5" />
      <path d="M94 24 H137" className={stroke} strokeWidth="1.5" strokeDasharray="3 4" />
      <path d="M70 18 76 30 M84 18 90 30" className={stroke} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="144" cy="24" r="7" className={`fill-none ${stroke}`} strokeWidth="1.5" strokeDasharray="2 3" />
    </svg>
  );
}

/** The body of the 404 page, also shown where a page must look like it does not exist. */
export function NotFoundView() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-6 py-20 text-center">
      <BrokenLink />
      <div className="space-y-2">
        <p className="eyebrow">Error 404</p>
        <h1 className="font-display text-5xl tracking-tight">No trace of that page</h1>
        <p className="text-muted-foreground">
          The link may be old, or the page may have moved. Start a new search or open the demo.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/">Back to the start</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/demo">Open the demo</Link>
        </Button>
      </div>
    </div>
  );
}
