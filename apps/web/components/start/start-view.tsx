"use client";

import { ArrowUpRight, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TargetIcon } from "@/components/common/bits";
import { SmartSearch } from "@/components/search/smart-search";
import { useStartSearch } from "@/components/search/use-start-search";
import { INTRO_KEY, useFlag } from "@/lib/preferences";
import { useCaseListRealtime, useCaseSummaries } from "@/lib/query/hooks";
import type { TargetType } from "@/lib/types";
import { HowItWorks } from "./how-it-works";
import { NetworkCanvas } from "./network-canvas";
import { RecentInvestigations } from "./recent-investigations";
import { SourceStrip } from "./source-strip";

/** Fictional examples only: reserved domains, RFC 5737 addresses, invented people. */
const EXAMPLES: { type: TargetType; label: string; value: string }[] = [
  { type: "username", label: "Username", value: "ada-fixture" },
  { type: "email", label: "Email", value: "ada@example.com" },
  { type: "domain", label: "Website", value: "ada-fixture.example" },
  { type: "ip", label: "IP", value: "192.0.2.44" },
  { type: "image", label: "Image", value: "https://ada-fixture.example/me.jpg" },
  { type: "phone", label: "Phone", value: "+44 20 7946 0000" },
  { type: "wallet", label: "Wallet", value: "0x52908400098527886E0F7030069857D2E4169EE7" },
  { type: "name", label: "Name", value: "Marlow Quince" },
];
const TYPED = [
  "ada-fixture",
  "ada@example.com",
  "192.0.2.44",
  "Marlow Quince",
  "ada-fixture.example",
];

/** Where the network converges on launch: roughly the search box, as a share of the hero. */
const SEARCH_FOCUS = { x: 0.3, y: 0.58 };

function DemoCard() {
  return (
    <Link
      href="/demo"
      className="group flex items-center gap-4 rounded-xl border border-border bg-popover p-4 transition-[border-color,transform] duration-2 ease-out hover:-translate-y-0.5 hover:border-input"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-accent/40 text-accent">
        <PlayCircle className="h-5 w-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Watch a live demo</span>
        <span className="block text-sm text-muted-foreground">
          A fictional investigation, scanned and explained step by step.
        </span>
      </span>
      <ArrowUpRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-2 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

export function StartView() {
  const cases = useCaseSummaries();
  useCaseListRealtime();
  const start = useStartSearch(undefined, 520);
  const [value, setValue] = useState("");
  const [boxKey, setBoxKey] = useState(0);
  const [introDismissed, setIntroDismissed] = useFlag(INTRO_KEY, true);
  const firstVisit = !introDismissed;

  return (
    <div className="space-y-16 pb-8">
      <section aria-labelledby="hero-title" className="relative -mt-8">
        {/* full-bleed network behind the search; the shell clips horizontal overflow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
        >
          <NetworkCanvas converge={start.pending} focus={SEARCH_FOCUS} />
          <div className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/50 to-transparent" />
        </div>

        <div className="relative grid grid-cols-1 gap-12 pb-10 pt-12 sm:pt-20 lg:grid-cols-12 lg:pt-24">
          <div className="space-y-8 lg:col-span-7">
            <div className="space-y-5">
              <p className="eyebrow">Open-source investigation · public data only</p>
              <h1
                id="hero-title"
                className="font-display text-5xl leading-[0.98] tracking-tight sm:text-6xl lg:text-[5.25rem]"
              >
                What do you want to <em className="text-accent">look into</em>?
              </h1>
              <p className="max-w-xl text-lg text-muted-foreground">
                Search what is public about a username, email, website, IP, phone, wallet, image or
                name, or upload a photo. You decide what is real.
              </p>
            </div>
            <SmartSearch
              key={boxKey}
              value={value}
              onValueChange={setValue}
              autoFocus
              examples={TYPED}
              pending={start.pending}
              allowPhoto
              onSubmit={start.submit}
            />
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
                <p className="mr-2 text-sm text-muted-foreground">Try a fictional example:</p>
                <ul className="flex flex-wrap gap-1" aria-label="Examples">
                  {EXAMPLES.map((ex) => (
                    <li key={ex.type}>
                      <button
                        type="button"
                        onClick={() => {
                          setValue(ex.value);
                          setBoxKey((k) => k + 1);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground transition-colors duration-1 hover:bg-muted hover:text-foreground"
                        aria-label={`Use the example ${ex.label.toLowerCase()} ${ex.value}`}
                      >
                        <TargetIcon type={ex.type} className="h-3.5 w-3.5" />
                        {ex.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <SourceStrip />
            </div>
          </div>

          <aside
            className="space-y-6 self-end lg:col-span-4 lg:col-start-9"
            aria-label="Getting started"
          >
            <DemoCard />
            {firstVisit ? (
              <div className="rounded-xl border border-border bg-popover p-5">
                <HowItWorks variant="trail" onDismiss={() => setIntroDismissed(true)} />
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      <RecentInvestigations
        summaries={cases.data}
        pending={cases.isPending}
        error={cases.isError ? cases.error : null}
        onRetry={() => void cases.refetch()}
      />
    </div>
  );
}
