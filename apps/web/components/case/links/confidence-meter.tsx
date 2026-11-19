import { InfoHint } from "@/components/common/info-hint";
import { confidenceBand } from "@/lib/rules";
import { cn } from "@/lib/utils";

const BAND = {
  high: { label: "Very likely", bar: "bg-success", text: "text-success" },
  medium: { label: "Possible", bar: "bg-warning", text: "text-warning" },
  low: { label: "Weak", bar: "bg-muted-foreground/60", text: "text-muted-foreground" },
} as const;

export function ConfidenceHint() {
  return (
    <InfoHint label="What does confidence mean?" title="Confidence">
      <p>
        How strongly the rule behind this link points to one owner. Matching profile pictures or
        emails score high; a shared city on its own scores low.
      </p>
      <p>It is a hint, not proof. The link only counts once you say yes.</p>
    </InfoHint>
  );
}

/** Confidence as a meter with a plain word, not just a percentage. */
export function ConfidenceMeter({
  confidence,
  className,
}: {
  confidence: number;
  className?: string;
}) {
  const pct = Math.round(confidence * 100);
  const band = BAND[confidenceBand(confidence)];
  return (
    <div className={cn("w-full space-y-1.5 sm:w-48", className)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-0.5 text-muted-foreground">
          How sure we are
          <ConfidenceHint />
        </span>
        <span className={cn("font-medium tabular-nums", band.text)}>{pct}%</span>
      </div>
      <div
        role="meter"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%, ${band.label.toLowerCase()}`}
        className="h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full", band.bar)}
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>
      <p className={cn("text-xs", band.text)}>{band.label}</p>
    </div>
  );
}
