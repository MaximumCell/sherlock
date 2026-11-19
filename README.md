# Sherlock

**An OSINT investigation platform that keeps the facts in code and a human in the loop.** Give it a username, email, domain, IP, image, phone number, wallet address or a person's name. Deterministic collectors gather public data, a rule engine links it with confidence scores and evidence, and a person approves or rejects every link before it counts.

It runs entirely on free tiers: four sleeping services on Render, Supabase Postgres and Vercel.

![Case overview with exposure score](apps/web/docs/screenshots/overview.png)

| Entity graph | Review queue | Name search |
|---|---|---|
| ![Graph](apps/web/docs/screenshots/graph.png) | ![Review](apps/web/docs/screenshots/review.png) | ![People](apps/web/docs/screenshots/people.png) |

The screenshots show the bundled demo case. Every person, handle and address in it is fictional.

## Responsible use

Sherlock is for **self-exposure checks, security research and authorised investigations**.

- Public data only. Breach results are exposure metadata (breach name, date, data categories), never records or passwords.
- Searching a person by name requires a signed-in account, and every search is written to the audit log.
- It does not look up who owns a phone number or national ID, does not do face recognition, and does not collect home addresses or family relationships. People-search and data-broker sites are excluded from results.
- Correlations are confidence scores with evidence, never statements of fact, and nothing is treated as confirmed until a person approves it.

## Architecture

```mermaid
flowchart LR
    B[Browser] -->|reads + live updates, row-level security| S[(Supabase Postgres)]
    B -->|commands, Bearer token| G[Gateway<br/>FastAPI]
    G -->|insert jobs| S
    G -. signed wake call .-> W1[Worker: identity]
    G -. signed wake call .-> W2[Worker: infra]
    G -. signed wake call .-> W3[Worker: media]
    W1 & W2 & W3 -->|claim job, write findings,<br/>re-run correlation| S
    W1 & W2 & W3 --> P[Public sources]
```

| Part | Where | Role |
|---|---|---|
| `apps/web` | Vercel | Next.js 16 app. Reads straight from Supabase, so pages load even while the backend sleeps. |
| `services/gateway` | Render (free) | Validates commands, checks ownership, rate-limits, enqueues jobs, wakes workers. |
| `services/worker` | Render (free) x 3 | One codebase deployed once per queue: `identity`, `infra`, `media`. |
| `packages/core` | shared library | Models, storage layer, module registry, correlation engine, scoring, name resolution. |
| `supabase/migrations` | Supabase | Schema, job-queue function, row-level security. |

### Designed around the free tier

Render's free plan gives one shared pool of 750 instance-hours a month, 512 MB and 0.1 CPU per service, a 15-minute idle sleep, and no background workers. The design follows from that:

- **Jobs live in Postgres, not in memory.** Workers claim them with `FOR UPDATE SKIP LOCKED`, heartbeat while running, and retry up to three times. A job whose worker went to sleep or crashed is requeued by the next claim.
- **Services sleep and are woken on demand.** After enqueueing, the gateway sends an HMAC-signed `POST /wake` to the worker for that queue. There are no keep-alive pings: four services kept awake would use the month's hours in about eight days.
- **Reads never touch Render.** The browser reads from Supabase under row-level security and gets new findings through Realtime, so a cold backend delays a scan by about a minute but never blocks a page.
- **Every visitor is isolated without signing up.** An anonymous Supabase session scopes cases to that visitor. Scans are limited per session and globally per day.

## How an investigation works

1. **Create a case** with one or more targets.
2. **Modules run as jobs**, one per data source, so one failing source never loses the rest.
3. **Findings are stored** under a stable key, so rescans update rows instead of duplicating them.
4. **The correlation engine** turns findings into typed facts and links them: shared email, shared link, cross-platform handle reference, matching bio, matching display name, breach overlap, matching profile picture (perceptual hash).
5. **You review** each link. Decisions survive rescans, and a rejected link is not proposed again.
6. **Pivot suggestions** offer newly discovered emails and handles as the next scan. Nothing runs without you starting it.
7. **Exposure score** (0 to 100) and the Markdown report are built from reviewed data, with a remediation step for each factor.

**Name search** adds one step: results from several sources are clustered into distinct people, each with a score and the reasons behind it, and you pick the right person before anything else happens.

## Data sources

38 modules, each a small class registered in a plugin registry (`packages/core/sherlock_core/modules`).

| Target | Sources |
|---|---|
| Username | WhatsMyName dataset (690 sites, own async engine), user-scanner sweep, GitHub, profile data from Bluesky, Mastodon, GitLab, Keybase, Hacker News, DEV, Docker Hub, npm, Codeberg, Lichess, Chess.com, Codeforces, Hugging Face, public activity-time fingerprint |
| Email | Gravatar, GitHub commits, breach exposure (XposedOrNot, LeakCheck), infostealer exposure (Hudson Rock), account sweep |
| Domain / IP | Certificate transparency (crt.sh), RDAP, DNS records with SPF and DMARC checks, Shodan InternetDB, Wayback Machine, RIPEstat |
| Image | Metadata and perceptual hash, Google Lens via SerpApi (needs `SERPAPI_KEY`), ready-made search links |
| Phone | Region, carrier and line type only |
| Wallet | Bitcoin and EVM balance and transaction summary |
| Name | OpenAlex, ORCID, Wikidata, GitHub user search, web search, UK Companies House (needs `COMPANIES_HOUSE_API_KEY`) |

Modules that need a missing key report themselves unavailable and are skipped. `GET /modules` and the Modules page list the live catalogue.

## Run it locally

Requirements: [uv](https://docs.astral.sh/uv/), Node 22, Docker (optional), a Supabase project.

```bash
# 1. Database: run supabase/setup.sql in the Supabase SQL editor (existing v1 database: run only supabase/migrations/0001_v2.sql),
#    then enable Anonymous sign-ins under Authentication.

# 2. Backend
cp .env.example .env            # fill in SUPABASE_URL, SUPABASE_SERVICE_KEY, INTERNAL_SECRET
docker compose up --build       # gateway on :8000, workers on :8101-8103

# 3. Web app
cd apps/web
cp .env.example .env.local      # Supabase URL, anon key, NEXT_PUBLIC_API_URL=http://localhost:8000
npm install && npm run dev
```

To look at the app with no backend at all:

```bash
cd apps/web && NEXT_PUBLIC_FIXTURES=1 npm run dev
```

## Tests

```bash
uv sync && uv run pytest         # 383 backend tests, all offline (in-memory store, recorded responses)
uv run ruff check .
cd apps/web && npm run lint && npm run typecheck && npm test
```

CI runs all of this on every pull request.

## Deploy

- **Supabase:** run the migration, enable Anonymous sign-ins (and Email or GitHub sign-in for name search).
- **Render:** New, then Blueprint, and select this repo. [`render.yaml`](render.yaml) creates the gateway and three workers with a shared generated secret. Enter the Supabase URL and service key when asked.
- **Vercel:** root directory `apps/web`, with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_API_URL`.
- **GitHub secrets** `SUPABASE_URL` and `SUPABASE_ANON_KEY` let the twice-weekly keepalive workflow stop the free Supabase project from pausing.

## Known limits

- The first scan after an idle period waits about a minute for Render to wake the services.
- Free sources rate-limit and occasionally block datacentre IPs; a blocked source shows as an error finding and the rest of the scan continues.
- Existence checks say an account exists, not who owns it. Links come from profile data, so sparse profiles produce few correlations.
- Keyless web search for name lookups is best-effort. A SerpApi key (250 free searches a month) makes it reliable.

## Project layout

```
apps/web                 Next.js app
services/gateway         API gateway
services/worker          Queue worker
packages/core            Shared library and its tests
supabase/migrations      Database schema
docs/CONTRACTS.md        Interfaces between the parts
```

## Author

**Rao Ali Hassan** · [LinkedIn](https://www.linkedin.com/in/ali-hassan-36a43b318/) · [GitHub](https://github.com/MaximumCell)
