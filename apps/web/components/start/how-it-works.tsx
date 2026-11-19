import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

function SearchArt() {
  return (
    <svg viewBox="0 0 120 64" className="h-16 w-full" aria-hidden>
      <rect x="8" y="20" width="104" height="24" rx="12" className="fill-card stroke-border" strokeWidth="1.5" />
      <circle cx="24" cy="32" r="5" className="fill-none stroke-accent" strokeWidth="2" />
      <path d="M28 36 31 39" className="stroke-accent" strokeWidth="2" strokeLinecap="round" />
      <rect x="38" y="29" width="44" height="6" rx="3" className="fill-muted-foreground/30" />
      <rect x="88" y="25" width="18" height="14" rx="7" className="fill-accent" />
    </svg>
  );
}

function SourcesArt() {
  const cells = Array.from({ length: 12 }, (_, i) => i);
  return (
    <svg viewBox="0 0 120 64" className="h-16 w-full" aria-hidden>
      {cells.map((i) => {
        const x = 18 + (i % 6) * 15;
        const y = 16 + Math.floor(i / 6) * 18;
        const done = i % 5 !== 3;
        return (
          <g key={i}>
            <rect x={x} y={y} width="11" height="11" rx="3" className={done ? "fill-success/20 stroke-success/60" : "fill-muted stroke-border"} strokeWidth="1" />
            {done ? <path d={`M${x + 3} ${y + 5.5} l2 2 l3.5 -4`} className="fill-none stroke-success" strokeWidth="1.5" strokeLinecap="round" /> : null}
          </g>
        );
      })}
    </svg>
  );
}

function ConfirmArt() {
  return (
    <svg viewBox="0 0 120 64" className="h-16 w-full" aria-hidden>
      <rect x="10" y="16" width="38" height="32" rx="6" className="fill-card stroke-border" strokeWidth="1.5" />
      <rect x="72" y="16" width="38" height="32" rx="6" className="fill-card stroke-border" strokeWidth="1.5" />
      <circle cx="22" cy="28" r="5" className="fill-accent/30" />
      <circle cx="84" cy="28" r="5" className="fill-accent/30" />
      <rect x="17" y="37" width="24" height="4" rx="2" className="fill-muted-foreground/30" />
      <rect x="79" y="37" width="24" height="4" rx="2" className="fill-muted-foreground/30" />
      <path d="M48 32 H72" className="stroke-warning" strokeWidth="2" strokeDasharray="4 3" />
      <circle cx="60" cy="32" r="8" className="fill-success" />
      <path d="M56.5 32 l2.5 2.5 l4.5 -5" className="fill-none stroke-background" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const STEPS = [
  { art: SearchArt, title: "Search", body: "Type a username, email, website, IP, phone, wallet, image link or name." },
  { art: SourcesArt, title: "We check public sources", body: "Dozens of data sources run in parallel. Results stream in as each one finishes." },
  { art: ConfirmArt, title: "You confirm what is real", body: "We suggest links between results. Nothing counts until you say yes." },
];

/** First-visit explainer under the search box. */
export function HowItWorks({ onDismiss, headingLevel = "h2" }: { onDismiss?: () => void; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel;
  return (
    <section aria-labelledby="how-title" className="relative rounded-2xl border border-border bg-card p-5 shadow-soft sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Heading id="how-title" className="text-sm font-semibold">
          How it works
        </Heading>
        {onDismiss ? (
          <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label="Hide how it works">
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
      <ol className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {STEPS.map(({ art: Art, title, body }, i) => (
          <li key={title} className="space-y-2">
            <div className="rounded-xl bg-surface px-2 py-1">
              <Art />
            </div>
            <p className="flex items-center gap-2 font-medium">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/10 text-2xs font-semibold text-accent">
                {i + 1}
              </span>
              {title}
            </p>
            <p className="text-sm text-muted-foreground">{body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
