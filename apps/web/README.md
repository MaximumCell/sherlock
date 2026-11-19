# Sherlock web

The Next.js app for Sherlock v2. Pages are client-rendered data views behind a thin server shell:
reads come straight from Supabase under row-level security (with Realtime), commands go to the
gateway. No page ever waits on the gateway during render, so a sleeping scan service cannot break it.

## Environment

Copy `.env.example` to `.env.local`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (reads, auth, Realtime) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_API_URL` | Gateway base URL for commands (default `http://localhost:8000`) |
| `NEXT_PUBLIC_FIXTURES` | `1` serves everything from the bundled fictional demo case |

If the Supabase variables are missing the app shows a banner and falls back to fixture data.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` | ESLint (flat config, Next + TypeScript rules) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest + Testing Library |
| `npm run format` | Prettier |

## Fixture mode

```bash
NEXT_PUBLIC_FIXTURES=1 npm run dev
```

Every screen then works with no backend. The data layer has one interface, `DataSource`
(`lib/data/types.ts`), with two implementations: `lib/data/supabase.ts` (Supabase + gateway) and
`lib/data/fixtures/` (in memory). The fixture source accepts every command, simulates job progress
with timers and emits the same change events as Supabase Realtime, so the UI code path is identical.
The `/demo` route always uses it, whatever the environment.

All fixture data is fictional: the handle `ada-fixture`, reserved `.example` domains, RFC 5737
addresses.

## Layout

```
app/                  routes (thin server shells) + error / not-found / loading
components/ui         shadcn/Radix primitives
components/shell      app shell, command palette, account menu, banners
components/cases      cases list and the New investigation dialog
components/workspace  case workspace: overview, findings, graph, timeline, review, report, jobs
lib/types.ts          mirrors packages/core/sherlock_core/models.py
lib/data              DataSource interface, Supabase and fixture implementations, gateway client
lib/query             TanStack Query hooks, mutations and Realtime cache patching
lib/graph             graph model + deterministic radial layout
```
