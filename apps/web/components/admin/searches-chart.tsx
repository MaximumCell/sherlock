"use client";

import { BarChart3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "@/components/common/states";
import {
  OUTCOME_FILLS,
  OUTCOME_LABELS,
  barDescription,
  chartModel,
  dayLabel,
} from "@/lib/admin/logic";
import { SEARCH_OUTCOMES, type DayPoint } from "@/lib/admin/types";
import { cn } from "@/lib/utils";

const H = 170;
const LEFT = 28;
const BOTTOM = 22;
const TOP = 10; // room for the top tick label

/** The element's width in CSS pixels, so the SVG is drawn 1:1 and its text stays readable. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Searches per day, stacked by outcome. Inline SVG with a text alternative per bar. */
export function SearchesChart({ series }: { series: DayPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  return (
    <div ref={ref} className="min-w-0">
      <Chart series={series} W={width} />
    </div>
  );
}

function Chart({ series, W }: { series: DayPoint[]; W: number }) {
  const model = chartModel(series, H);
  if (model.total === 0) {
    return (
      <EmptyState icon={BarChart3} title="No searches in this period">
        Searches will show up here as visitors use the app.
      </EmptyState>
    );
  }
  const slot = (W - LEFT) / Math.max(1, model.bars.length);
  const barW = Math.max(4, Math.min(28, slot * 0.6));
  const present = SEARCH_OUTCOMES.filter((o) => series.some((p) => p[o] > 0));
  const labelEvery = Math.ceil(model.bars.length / Math.max(3, Math.floor(W / 70)));

  return (
    <figure className="space-y-3">
      <svg
        viewBox={`0 ${-TOP} ${W} ${H + BOTTOM + TOP}`}
        width={W}
        height={H + BOTTOM + TOP}
        className="block max-w-full"
        role="img"
        aria-labelledby="searches-chart-title"
      >
        <title id="searches-chart-title">
          Searches per day, stacked by outcome. {model.total} in total.
        </title>
        {model.ticks.map((t) => {
          const y = H - (t / model.max) * H;
          return (
            <g key={t}>
              <line x1={LEFT} x2={W} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
              <text
                x={LEFT - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {t}
              </text>
            </g>
          );
        })}
        {model.bars.map((bar, i) => {
          const x = LEFT + i * slot + (slot - barW) / 2;
          return (
            <g key={bar.day}>
              <title>{barDescription(bar)}</title>
              {bar.segments.map((s) => (
                <rect
                  key={s.outcome}
                  x={x}
                  y={s.y}
                  width={barW}
                  height={Math.max(0, s.height)}
                  rx={2}
                  className={cn(
                    OUTCOME_FILLS[s.outcome],
                    "origin-bottom [transform-box:fill-box] motion-safe:animate-[grow-y_500ms_var(--ease-out)_both]",
                  )}
                  style={{ animationDelay: `${i * 18}ms` }}
                />
              ))}
              {i % labelEvery === 0 || i === model.bars.length - 1 ? (
                <text
                  x={x + barW / 2}
                  y={H + 15}
                  textAnchor="middle"
                  className="fill-muted-foreground text-[10px]"
                >
                  {dayLabel(bar.day, true)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption>
        <ul
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
          aria-label="Legend"
        >
          {present.map((o) => (
            <li key={o} className="flex items-center gap-1.5">
              <svg width="10" height="10" aria-hidden>
                <rect width="10" height="10" rx="2" className={cn(OUTCOME_FILLS[o])} />
              </svg>
              {OUTCOME_LABELS[o]}
            </li>
          ))}
        </ul>
        <div className="sr-only">
          <table>
            <caption>Searches per day</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Searches</th>
              </tr>
            </thead>
            <tbody>
              {model.bars.map((bar) => (
                <tr key={bar.day}>
                  <td>{dayLabel(bar.day)}</td>
                  <td>{barDescription(bar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figcaption>
    </figure>
  );
}
