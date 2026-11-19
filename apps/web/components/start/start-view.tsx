"use client";

import { PlayCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { TargetIcon } from "@/components/common/bits";
import { SmartSearch } from "@/components/search/smart-search";
import { useStartSearch } from "@/components/search/use-start-search";
import { INTRO_KEY, useFlag } from "@/lib/preferences";
import { useCaseListRealtime, useCaseSummaries } from "@/lib/query/hooks";
import type { TargetType } from "@/lib/types";
import { HowItWorks } from "./how-it-works";
import { RecentInvestigations } from "./recent-investigations";

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

export function StartView() {
  const cases = useCaseSummaries();
  useCaseListRealtime();
  const start = useStartSearch();
  const [value, setValue] = useState("");
  const [boxKey, setBoxKey] = useState(0);
  const [introDismissed, setIntroDismissed] = useFlag(INTRO_KEY, true);
  const firstVisit = !introDismissed;

  return (
    <div className="space-y-14 pb-8">
      <section className="mx-auto max-w-2xl space-y-6 pt-6 text-center sm:pt-14">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">What do you want to look into?</h1>
          <p className="mx-auto max-w-lg text-base text-muted-foreground sm:text-lg">
            Search what is public about a username, email, website, IP, phone, wallet, image or
            name. You decide what is real.
          </p>
        </div>
        <SmartSearch
          key={boxKey}
          value={value}
          onValueChange={setValue}
          autoFocus
          pending={start.pending}
          onSubmit={start.submit}
        />
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Try an example. All of them are fictional.</p>
          <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <li key={ex.type}>
                <button
                  type="button"
                  onClick={() => {
                    setValue(ex.value);
                    setBoxKey((k) => k + 1);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground transition-colors hover:border-input hover:text-foreground"
                  aria-label={`Use the example ${ex.label.toLowerCase()} ${ex.value}`}
                >
                  <TargetIcon type={ex.type} className="h-3.5 w-3.5" />
                  {ex.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {firstVisit ? (
        <div className="mx-auto max-w-4xl space-y-3">
          <HowItWorks onDismiss={() => setIntroDismissed(true)} />
          <p className="text-center text-sm text-muted-foreground">
            Want to see a finished investigation first?{" "}
            <Link href="/demo" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              <PlayCircle className="h-4 w-4" aria-hidden />
              Try the demo
            </Link>
          </p>
        </div>
      ) : null}

      <RecentInvestigations
        summaries={cases.data}
        pending={cases.isPending}
        error={cases.isError ? cases.error : null}
        onRetry={() => void cases.refetch()}
      />
    </div>
  );
}
