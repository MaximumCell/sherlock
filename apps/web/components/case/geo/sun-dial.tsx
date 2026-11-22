import { dialPoint, shadowSegment, sunSentence, type SunMoment } from "@/lib/geo";

const SIZE = 240;
const C = SIZE / 2;
const R = 92; // horizon ring
const SHADOW_UNIT = 22; // pixels per object height
const SHADOW_MAX = R - 6;

const TONE: Record<SunMoment["label"], { stroke: string; fill: string; name: string }> = {
  camera: { stroke: "hsl(var(--accent))", fill: "hsl(var(--accent))", name: "Camera time" },
  claim: { stroke: "hsl(var(--warning))", fill: "hsl(var(--warning))", name: "Claimed time" },
};

/**
 * Where the sun stood, seen from above: north up, the rim is the horizon and the centre straight
 * overhead. The thick line from the centre is the shadow of an upright pole (direction and
 * relative length); a short pole casts a long shadow when the sun is low.
 */
export function SunDial({ moments }: { moments: SunMoment[] }) {
  const description = moments.map(sunSentence).join(" ");
  return (
    <figure className="space-y-3">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Sun dial. ${description}`}
        className="mx-auto block h-auto w-full max-w-[16rem]"
      >
        <circle cx={C} cy={C} r={R} fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
        {[30, 60].map((e) => (
          <circle
            key={e}
            cx={C}
            cy={C}
            r={R * (1 - e / 90)}
            fill="none"
            stroke="hsl(var(--border))"
            strokeDasharray="2 3"
          />
        ))}
        <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="hsl(var(--border))" />
        <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="hsl(var(--border))" />
        {(
          [
            ["N", C, C - R - 10],
            ["E", C + R + 10, C],
            ["S", C, C + R + 12],
            ["W", C - R - 10, C],
          ] as const
        ).map(([t, x, y]) => (
          <text
            key={t}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {t}
          </text>
        ))}
        <text
          x={C + 3}
          y={C - R * (2 / 3) - 3}
          className="fill-muted-foreground font-mono text-[8px]"
        >
          30°
        </text>
        <text x={C + 3} y={C - R / 3 - 3} className="fill-muted-foreground font-mono text-[8px]">
          60°
        </text>
        {moments.map((m) => {
          const tone = TONE[m.label];
          const sun = dialPoint(m.azimuth, m.elevation, R, C, C);
          const shadow = shadowSegment(m, SHADOW_UNIT, SHADOW_MAX, C, C);
          const up = m.elevation > 0;
          return (
            <g key={m.label} data-testid={`sun-${m.label}`}>
              <line
                x1={C}
                y1={C}
                x2={sun.x}
                y2={sun.y}
                stroke={tone.stroke}
                strokeDasharray="3 3"
                strokeOpacity={0.7}
              />
              {shadow ? (
                <line
                  x1={C}
                  y1={C}
                  x2={shadow.x}
                  y2={shadow.y}
                  stroke="hsl(var(--foreground))"
                  strokeOpacity={0.75}
                  strokeWidth={5}
                  strokeLinecap="round"
                  data-testid={`shadow-${m.label}`}
                />
              ) : null}
              <circle
                cx={sun.x}
                cy={sun.y}
                r={up ? 9 : 7}
                fill={up ? tone.fill : "hsl(var(--background))"}
                stroke={tone.stroke}
                strokeWidth={2}
              />
            </g>
          );
        })}
        <circle cx={C} cy={C} r={3.5} fill="hsl(var(--foreground))" />
      </svg>
      <figcaption className="space-y-1.5 text-sm">
        {moments.map((m) => (
          <p key={m.label} className="flex gap-2">
            <span
              aria-hidden
              className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: TONE[m.label].fill }}
            />
            <span>
              <span className="font-medium">{TONE[m.label].name}.</span>{" "}
              <span className="text-muted-foreground">{sunSentence(m)}</span>
              {m.approximate ? (
                <span className="text-muted-foreground"> The time zone is approximate.</span>
              ) : null}
            </span>
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          Seen from above, north up. The rim is the horizon, the centre straight overhead; the dark
          bar is the shadow of an upright pole.
        </p>
      </figcaption>
    </figure>
  );
}
