const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CELL = 12;
const GAP = 2;
const LEFT = 30;
const TOP = 14;

/** 7 x 24 heatmap as inline SVG. Sequential single-hue scale; values also exposed as titles. */
export function ActivityHeatmap({ matrix }: { matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  const width = LEFT + 24 * (CELL + GAP);
  const height = TOP + 7 * (CELL + GAP);
  const peak = matrix
    .flatMap((row, day) => row.map((value, hour) => ({ value, day, hour })))
    .sort((a, b) => b.value - a.value)[0];

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Activity heatmap: ${total} events${peak ? `, busiest on ${DAYS[peak.day]} around ${peak.hour}:00 UTC` : ""}`}
        className="w-full max-w-md"
      >
        {[0, 6, 12, 18].map((hour) => (
          <text
            key={hour}
            x={LEFT + hour * (CELL + GAP)}
            y={9}
            className="fill-muted-foreground font-mono text-[8px]"
          >
            {String(hour).padStart(2, "0")}
          </text>
        ))}
        {matrix.map((row, day) => (
          <g key={day}>
            <text
              x={0}
              y={TOP + day * (CELL + GAP) + 9}
              className="fill-muted-foreground font-mono text-[8px]"
            >
              {DAYS[day]}
            </text>
            {row.map((value, hour) => (
              <rect
                key={hour}
                x={LEFT + hour * (CELL + GAP)}
                y={TOP + day * (CELL + GAP)}
                width={CELL}
                height={CELL}
                rx={2}
                className={value === 0 ? "fill-muted" : "fill-accent"}
                fillOpacity={value === 0 ? 1 : 0.25 + 0.75 * (value / max)}
              >
                <title>{`${DAYS[day]} ${String(hour).padStart(2, "0")}:00 UTC: ${value}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="text-xs text-muted-foreground">
        {total} public events. Darker cells mean more activity
        {peak
          ? `; peak on ${DAYS[peak.day]} around ${String(peak.hour).padStart(2, "0")}:00 UTC.`
          : "."}
      </figcaption>
    </figure>
  );
}

function Strip({ values, labels, label }: { values: number[]; labels: string[]; label: string }) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div className="space-y-1">
      <div
        role="img"
        aria-label={`${label}: busiest at ${labels[peak] ?? "?"}`}
        className="flex h-14 items-end gap-[2px]"
      >
        {values.map((v, i) => (
          <div
            key={i}
            title={`${labels[i]}: ${v}`}
            className={v === 0 ? "flex-1 rounded-sm bg-muted" : "flex-1 rounded-sm bg-accent"}
            style={{
              height: `${Math.max(6, (v / max) * 100)}%`,
              opacity: v === 0 ? 1 : 0.35 + 0.65 * (v / max),
            }}
          />
        ))}
      </div>
      <div className="flex justify-between font-mono text-[10px] text-muted-foreground" aria-hidden>
        {labels.length === 24
          ? ["00", "06", "12", "18", "23"].map((h) => <span key={h}>{h}</span>)
          : labels.map((d) => <span key={d}>{d}</span>)}
      </div>
    </div>
  );
}

/** Hour-of-day and weekday histograms, for sources that do not give a full 7 x 24 matrix. */
export function ActivityStrips({
  hours,
  weekdays,
}: {
  hours: number[] | null;
  weekdays: number[] | null;
}) {
  return (
    <div className="grid max-w-md grid-cols-1 gap-4 sm:grid-cols-[3fr_1fr]">
      {hours ? (
        <Strip
          values={hours}
          labels={hours.map((_, h) => `${String(h).padStart(2, "0")}:00 UTC`)}
          label="Activity by hour"
        />
      ) : null}
      {weekdays ? (
        <Strip
          values={weekdays}
          labels={DAYS.map((d) => d.slice(0, 1) + d.slice(1, 2))}
          label="Activity by weekday"
        />
      ) : null}
    </div>
  );
}
