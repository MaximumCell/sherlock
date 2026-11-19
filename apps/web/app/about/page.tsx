import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArchitectureDiagram } from "@/components/about/architecture-diagram";
import { PageHeader } from "@/components/common/states";

export const metadata: Metadata = {
  title: "About",
  description: "What Sherlock does, what it refuses to do, and how it is built.",
};

const DOES = [
  "Checks where a username, email, domain, IP, image, phone number or wallet shows up in public sources.",
  "Reports breach exposure as metadata: breach name, date and the classes of data exposed.",
  "Suggests links between findings with a named rule, a confidence score and the evidence behind it.",
  "Keeps a person in the loop: a link only counts once you approve it.",
  "Logs every scan, review and report in an append-only audit trail.",
];

const DOES_NOT = [
  "No phone-number or national-ID to identity lookup.",
  "No face recognition. Avatar matching is a perceptual hash of the image file.",
  "No home addresses, and no mapping of family members or relatives.",
  "No leaked records: passwords, messages and documents from breaches are never fetched or stored.",
  "No access to private accounts, no login attempts, no scraping behind authentication.",
];

const STEPS = [
  ["Reads", "The browser signs in to Supabase (anonymously by default) and reads cases, findings, correlations and jobs directly, protected by row-level security. Realtime pushes every change."],
  ["Commands", "Starting a scan or reviewing a link is a command to the FastAPI gateway, authenticated with the Supabase access token. The gateway validates, rate-limits and writes jobs."],
  ["Queue", "Jobs live in a Postgres table. Workers claim them with SKIP LOCKED, heartbeat while they run, and are retried or failed when a worker disappears."],
  ["Modules", "Each data source is a small plugin that declares its inputs and queue. Workers run the module, upsert findings under a stable key, then re-run correlation."],
  ["Review", "Correlations carry a deterministic key, so a rescan never loses a human decision."],
];

function Rule({ ok, children }: { ok: boolean; children: string }) {
  const Icon = ok ? Check : X;
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? "bg-success/15 text-success" : "bg-danger/15 text-danger"}`}
      >
        <Icon className="h-3 w-3" aria-hidden />
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <PageHeader
        title="About Sherlock"
        description="An OSINT workspace for public data. Built for checking your own exposure and for investigations you are authorised to run."
      />

      <section id="responsible-use" aria-labelledby="responsible-use-title" className="scroll-mt-20 space-y-4">
        <h2 id="responsible-use-title" className="text-xl font-semibold">
          Responsible use
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Before the first scan you confirm that the target is your own data or that you are
          authorised to investigate it. Scans are rate-limited per session and globally, and name
          search requires a signed-in account. These limits are part of the product, not settings.
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h3 className="font-semibold">What it does</h3>
            <ul className="space-y-2.5">
              {DOES.map((text) => (
                <Rule key={text} ok>
                  {text}
                </Rule>
              ))}
            </ul>
          </div>
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <h3 className="font-semibold">What it does not do</h3>
            <ul className="space-y-2.5">
              {DOES_NOT.map((text) => (
                <Rule key={text} ok={false}>
                  {text}
                </Rule>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="architecture" aria-labelledby="architecture-title" className="scroll-mt-20 space-y-4">
        <h2 id="architecture-title" className="text-xl font-semibold">
          Architecture
        </h2>
        <ArchitectureDiagram />
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-lg border border-border bg-card p-4">
              <p className="flex items-center gap-2 font-semibold">
                <span className="font-mono text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
                {title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
        <p className="text-sm text-muted-foreground">
          See the{" "}
          <Link href="/modules" className="text-accent underline underline-offset-4">
            module catalogue
          </Link>{" "}
          for every data source, or open the{" "}
          <Link href="/demo" className="text-accent underline underline-offset-4">
            live demo
          </Link>{" "}
          to explore a complete fictional case.
        </p>
      </section>
    </div>
  );
}
