# Sherlock v2 contracts

The interfaces every part of the system builds against. Change these only together with every consumer.

## Layout and ownership

```
apps/web                     Next.js app (Vercel)
services/gateway/gateway     FastAPI: commands, auth, rate limits, agent, report
services/worker/worker       Queue worker, deployed once per queue (WORKER_QUEUE)
packages/core/sherlock_core  Shared: config, models, store, modules, correlation
supabase/migrations          Versioned SQL (0001_v2.sql is the v2 schema)
```

Python packages: `sherlock_core`, `gateway`, `worker` (uv workspace, Python 3.11).
Run tests with `uv run pytest`. Tests are offline: use `MemoryStore` and `respx`, never a real database or network.

## Data flow

1. Browser signs in to Supabase (anonymous session by default) and reads `cases`, `raw_findings`, `correlations`, `jobs`, `entities` **directly from Supabase** under row-level security, with Realtime subscriptions.
2. Browser sends **commands** to the gateway with `Authorization: Bearer <supabase access token>`.
3. Gateway validates, rate-limits, inserts `jobs` rows, then pokes the worker for each affected queue (`POST {WORKER_URL_<QUEUE>}/wake`).
4. Worker claims jobs (`store.claim_job`), runs the module, upserts findings, then runs correlation for the case and syncs it.
5. Browser sees new rows through Realtime.

## Storage: `sherlock_core.store`

`get_store()` returns the process-wide `Store`. `SupabaseStore` for real use, `MemoryStore` for tests (`set_store(MemoryStore())`). The method docstrings on `Store` are the contract. Do not call Supabase from anywhere else in Python.

## Finding row (`sherlock_core.models.make_finding`)

```
case_id, identifier_type, identifier_value, source_tool, module, platform,
status (found | not_found | error), finding_key, collected_at,
extra_metadata = { "url": <profile or source url>, "extra": { ...source fields }, ...top-level meta }
```

Conventions inside `extra_metadata.extra` (use these names when the source has the data):

| key | meaning |
|---|---|
| `fullname` | display name |
| `bio` | free-text bio / about |
| `location` | location string as published |
| `email`, `emails` | one email, or comma-separated list |
| `links` | comma-separated URLs the profile links to |
| `avatar_url` | profile image URL |
| `avatar_phash` | 64-bit perceptual hash, hex (media modules) |
| `created_at` | account creation time, ISO 8601 |
| `followers`, `following` | integers |

Legacy rows keep their old shapes (documented in `packages/core/sherlock_core/correlation/facts.py`, the only code allowed to know them). Breach rows: `platform = "breach"`, top-level meta `breach_name`, `breach_date`, `data_classes`; pass `discriminator=<breach name>` so each breach is its own row.

Rows with top-level meta `summary: true` are scan coverage summaries (checked / found / error counts); fan-out modules emit one instead of hundreds of `not_found` rows. They are never correlation input.

`not_found` rows are stored (they show coverage) but are never correlation input.

## Module (`sherlock_core.modules`)

```python
@register
class CrtSh(Module):
    name = "crtsh"; title = "Certificate transparency"; description = "..."
    inputs = ("domain",); queue = "infra"; requires_env = ()
    async def run(self, target: Target, ctx: ModuleContext) -> list[dict]:
        r = await ctx.http.get(...)
        return [ctx.finding(self, target, platform="crt.sh", url=..., extra={...}, discriminator=...)]
```

- Only use `ctx.http` for network access. Respect `ctx.max_concurrency` for fan-out.
- Call `await ctx.progress(pct, note)` for anything longer than a few seconds.
- Return `[]` when there is nothing; raise only when the whole module failed.
- Queues: `identity` (username, email, phone, name), `infra` (domain, ip, wallet), `media` (image).

## Correlation (`sherlock_core.correlation`)

```python
from sherlock_core.correlation import correlate, summarize
corrs = correlate(case_id, findings)      # list of rows for store.sync_correlations
stats = summarize(findings)               # case summary (handle reuse counts etc.), not review items
```

`extract_entities(findings)` returns pivot candidates (emails, handles, urls, domains) for `store.upsert_entities`.

Correlation row: `type` (rule name), `corr_key` (deterministic), `matched_value`, `entities_involved` (**finding ids**), `confidence` (0..1), `evidence` (list of human-readable strings or `{finding_id, platform, field, value}` dicts), `priority`.
Review state lives in `status` (`pending | approved | rejected`) and is owned by `store.sync_correlations` / `set_correlation_status`. The engine never sets it.

## Jobs

One user action creates one **batch**: one job per applicable module, sharing `batch_id`.

```
queued -> running -> succeeded
                  -> queued (retry, attempts < max_attempts) -> ... -> failed
```

A worker must heartbeat at least every 30 s while a job runs. A job with no heartbeat for `JOB_STALE_SECONDS` is requeued by the next `claim_job` call.
Job `result`: `{"findings": <count>, "found": <count with status found>}`.

## Gateway HTTP API

All routes return JSON matching `sherlock_core.models`. Errors: `{"detail": "<message>"}`.
Auth: `Authorization: Bearer <Supabase access token>`; the gateway resolves it to `owner_id` and whether the session is anonymous. Every case route checks ownership (demo cases are read-only).

| Method and path | Body | Returns |
|---|---|---|
| `GET /health` | | `{ok, service}` |
| `GET /modules` | | `ModuleInfo[]` |
| `POST /cases` | `{title?, tags?, identifiers: Identifier[], scan?: bool}` | `{case: Case, jobs: Job[]}` |
| `PATCH /cases/{id}` | `{title?, notes?, tags?, archived?}` | `Case` |
| `DELETE /cases/{id}` | | 204 |
| `POST /cases/{id}/scan` | `{type, value, modules?: string[]}` | `{batch_id, jobs: Job[]}` (202) |
| `POST /cases/{id}/jobs/{job_id}/cancel` | | `Job` |
| `POST /cases/{id}/wake` | | 202; re-pokes workers that have queued jobs for this case |
| `POST /cases/{id}/correlate` | | `{correlations: number}` |
| `GET /cases/{id}/exposure` | | `{score, band, factors[], computed_from, method}` (see `sherlock_core.scoring`) |
| `POST /cases/{id}/findings/{fid}/curate` | `{curated: bool}` | `Finding` |
| `POST /cases/{id}/correlations` | `{finding_ids: string[], note?}` | `Correlation` (manual link) |
| `POST /correlations/{id}/review` | `{decision: approve \| reject \| reset, note?}` | `Correlation` |
| `GET /cases/{id}/report` | | `text/markdown` |
| `GET /cases/{id}/variations?type=&value=&count=` | | `{variations: string[]}` |
| `POST /cases/{id}/chat` | `{message}` | `{text, iterations, tool_calls_made}` |

Rules:
- `type = "name"` requires a non-anonymous session (403 otherwise) and is limited by `NAME_SEARCHES_PER_USER_PER_DAY`.
- Scans are limited by `SCANS_PER_SESSION_PER_DAY` and `SCANS_GLOBAL_PER_DAY` (429 with a clear message).
- `POST /cases` and manual links return 201. A case owned by someone else is 403; a missing case is 404. Validation errors are 422 with a string `detail`.
- Reads (lists of cases, findings, correlations, jobs, entities, audit) are **not** on the gateway; the web app reads them from Supabase.

## Worker HTTP API

| Method and path | Purpose |
|---|---|
| `GET /health` | `{ok, queue, busy}` |
| `POST /wake` | Header `X-Sherlock-Signature: <hex hmac-sha256(INTERNAL_SECRET, body)>`, body `{"ts": <unix seconds>}` (reject if older than 5 min). Starts the drain loop if idle, returns 202 immediately. |

The drain loop claims jobs until the queue is empty, one at a time (0.1 CPU), then stops.

## Environment

See `packages/core/sherlock_core/config.py`. Web app: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`.

## Boundaries (not negotiable)

Public data only. Breach data is exposure metadata only (name, date, data classes), never records. No phone-number or national-ID to identity lookup. No face recognition. No home addresses, no family or relatives mapping.
