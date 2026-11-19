interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines: string[];
  accent?: boolean;
}

const BOXES: Record<string, Box> = {
  web: { x: 20, y: 30, w: 190, h: 86, title: "Web app", lines: ["Next.js on Vercel", "client-rendered views"], accent: true },
  supabase: { x: 355, y: 30, w: 190, h: 86, title: "Supabase", lines: ["Postgres + RLS", "Auth · Realtime"] },
  sources: { x: 690, y: 30, w: 190, h: 86, title: "Public sources", lines: ["module plugins fetch", "public data only"] },
  gateway: { x: 20, y: 234, w: 190, h: 86, title: "Gateway", lines: ["FastAPI: commands,", "auth, rate limits, report"] },
  jobs: { x: 355, y: 234, w: 190, h: 86, title: "jobs table", lines: ["durable Postgres queue", "claim · heartbeat · retry"] },
  workers: { x: 690, y: 234, w: 190, h: 86, title: "Workers", lines: ["one per queue:", "identity · infra · media"] },
};

function Node({ box }: { box: Box }) {
  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={8}
        className={box.accent ? "fill-accent/10 stroke-accent" : "fill-card stroke-border"}
        strokeWidth={1.5}
      />
      <text x={box.x + 14} y={box.y + 26} className="fill-foreground text-[14px] font-semibold">
        {box.title}
      </text>
      {box.lines.map((line, i) => (
        <text key={line} x={box.x + 14} y={box.y + 47 + i * 17} className="fill-muted-foreground text-[11.5px]">
          {line}
        </text>
      ))}
    </g>
  );
}

function Arrow({
  d,
  label,
  lx,
  ly,
  anchor = "middle",
  dashed = false,
}: {
  d: string;
  label: string;
  lx: number;
  ly: number;
  anchor?: "start" | "middle" | "end";
  dashed?: boolean;
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        className="stroke-muted-foreground"
        strokeWidth={1.5}
        strokeDasharray={dashed ? "4 4" : undefined}
        markerEnd={dashed ? undefined : "url(#arrow)"}
      />
      <text x={lx} y={ly} textAnchor={anchor} className="fill-foreground font-mono text-[10.5px]">
        {label}
      </text>
    </g>
  );
}

/** Service diagram: how a scan flows through the system. Inline SVG, themed with tokens. */
export function ArchitectureDiagram() {
  return (
    <figure className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface p-3">
        <svg
          viewBox="0 0 900 380"
          role="img"
          aria-labelledby="arch-title arch-desc"
          className="h-auto w-full min-w-[680px] font-sans"
        >
          <title id="arch-title">Sherlock service architecture</title>
          <desc id="arch-desc">
            The web app reads from Supabase and sends commands to the gateway. The gateway inserts
            jobs into a Postgres queue and wakes the workers. Workers run module plugins against
            public sources and write findings back to Supabase, which streams them to the browser.
          </desc>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10z" className="fill-muted-foreground" />
            </marker>
          </defs>
          <Arrow d="M351 73 H216" label="1 · reads + Realtime" lx={283} ly={63} />
          <Arrow d="M115 120 V228" label="2 · commands + Bearer token" lx={127} ly={178} anchor="start" />
          <Arrow d="M214 277 H349" label="3 · insert jobs" lx={282} ly={267} />
          <Arrow d="M115 324 C 200 372, 690 372, 785 326" label="3b · POST /wake (signed)" lx={450} ly={352} />
          <Arrow d="M686 277 H551" label="4 · claim job" lx={618} ly={267} />
          <Arrow d="M785 230 V122" label="5 · fetch" lx={797} ly={178} anchor="start" />
          <Arrow d="M700 230 L 551 108" label="6 · upsert findings" lx={634} ly={156} anchor="start" />
          <Arrow d="M450 230 V120" label="same database" lx={438} ly={178} anchor="end" dashed />
          {Object.values(BOXES).map((box) => (
            <Node key={box.title} box={box} />
          ))}
        </svg>
      </div>
      <figcaption className="text-xs text-muted-foreground">
        Reads never touch the gateway, so a sleeping scan service cannot block or break a page.
      </figcaption>
    </figure>
  );
}
