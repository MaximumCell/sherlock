import { Check, Compass, PlayCircle, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ArchitectureDiagram } from "@/components/about/architecture-diagram";
import { TOUR_HREF } from "@/components/tour/tour-steps";
import { HowItWorks } from "@/components/start/how-it-works";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "How it works",
  description: "What Sherlock does, what it refuses to do, and how it is built.",
};

const DOES = [
  "Checks where a username, email, website, IP, image, phone number or wallet shows up in public sources.",
  "Reports breach exposure as metadata only: the breach name, its date and the kinds of data exposed.",
  "Shows each account found with its profile picture, name and public details, when the site shows them to anyone. Some sites hide profiles from visitors who are not signed in; those accounts are listed as existing, without details.",
  "Finds LinkedIn profiles through public search results only, because LinkedIn does not allow direct lookups. Those details can be out of date.",
  "Suggests links between results, each with a plain reason, a confidence level and the evidence behind it.",
  "Keeps a person in charge: a link only counts once you say yes.",
  "Records every search, decision and report in an activity log that cannot be edited.",
];

const DOES_NOT = [
  "No phone-number or national-ID to identity lookup.",
  "No face recognition. Matching profile pictures uses a fingerprint of the image file: a match means the same image, never the same face.",
  "No copies of profile pictures: they are shown straight from the site that hosts them, and never downloaded, proxied or stored.",
  "No home addresses, and no mapping of family members or relatives.",
  "No leaked records: passwords, messages and documents from breaches are never fetched or stored.",
  "No access to private accounts, no login attempts, no scraping behind a sign-in.",
];

const STEPS: [title: string, body: string][] = [
  [
    "Reading",
    "Your browser signs in to Supabase (anonymously by default) and reads investigations, results, links and scan progress directly, protected by row-level security. Changes arrive live.",
  ],
  [
    "Asking",
    "Starting a search or answering a link question is a request to the gateway, a small FastAPI service. It checks who you are, applies rate limits and queues the work.",
  ],
  [
    "Queueing",
    "Work waits in a Postgres table. Workers pick jobs up one at a time, report progress while they run, and retry when something goes wrong.",
  ],
  [
    "Data sources",
    "Each data source is a small plugin that says what it can search. A worker runs it, stores the results, then looks for links again.",
  ],
  [
    "Your decisions stick",
    "Every link has a stable key, so searching again never loses a yes or no you already gave.",
  ],
];

function Rule({ ok, children }: { ok: boolean; children: string }) {
  const Icon = ok ? Check : X;
  return (
    <li className="flex items-start gap-3 text-base">
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
    <div className="mx-auto max-w-4xl space-y-16 pb-8">
      <header className="space-y-5 pt-4 sm:pt-10">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">How Sherlock works</h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Sherlock searches public sources for a username, email, website or other identifier,
          suggests which results belong together, and lets you decide what is real. It is built for
          checking your own exposure and for investigations you are authorised to run.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href={TOUR_HREF}>
              <Compass aria-hidden />
              Take the tour
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/demo">
              <PlayCircle aria-hidden />
              Open the demo
            </Link>
          </Button>
        </div>
      </header>

      <HowItWorks headingLevel="h2" />

      <section
        id="responsible-use"
        aria-labelledby="responsible-use-title"
        className="scroll-mt-20 space-y-5"
      >
        <div className="space-y-2">
          <h2 id="responsible-use-title" className="text-2xl font-semibold tracking-tight">
            Responsible use
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground">
            Before the first search you confirm that the target is your own data or that you are
            authorised to investigate it. Searches are rate-limited, and name search needs a
            signed-in account. These limits are part of the product, not settings.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
            <h3 className="text-lg font-semibold">What it does</h3>
            <ul className="space-y-3">
              {DOES.map((text) => (
                <Rule key={text} ok>
                  {text}
                </Rule>
              ))}
            </ul>
          </div>
          <div className="space-y-4 rounded-2xl border border-border bg-card p-6 shadow-soft">
            <h3 className="text-lg font-semibold">What it does not do</h3>
            <ul className="space-y-3">
              {DOES_NOT.map((text) => (
                <Rule key={text} ok={false}>
                  {text}
                </Rule>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section
        id="architecture"
        aria-labelledby="architecture-title"
        className="scroll-mt-20 space-y-5"
      >
        <div className="space-y-2">
          <h2 id="architecture-title" className="text-2xl font-semibold tracking-tight">
            Under the hood
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground">
            For the technically curious: how a search travels from your browser to the data sources
            and back.
          </p>
        </div>
        <ArchitectureDiagram />
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {STEPS.map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
              <p className="flex items-center gap-2 font-semibold">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs text-accent">
                  {i + 1}
                </span>
                {title}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
        <p className="text-base text-muted-foreground">
          See every{" "}
          <Link href="/modules" className="text-accent underline underline-offset-4">
            data source
          </Link>
          , or open the{" "}
          <Link href="/demo" className="text-accent underline underline-offset-4">
            demo investigation
          </Link>{" "}
          to explore a complete fictional case.
        </p>
      </section>
    </div>
  );
}
