# Sherlock v2 contracts

The interfaces every part of the system builds against. Change these only together with every consumer.

## Layout and ownership

```
apps/web                     Next.js app (Vercel)
services/gateway/gateway     FastAPI: commands, auth, rate limits, agent, report
services/worker/worker       Queue worker, deployed once per queue (WORKER_QUEUE)
packages/core/sherlock_core  Shared: config, models, store, modules, correlation
supabase/migrations          Versioned SQL (0001_v2.sql is the v2 schema, 0002_admin.sql the operator panel, 0003_limits.sql search limits + fair claims, 0004_uploads.sql private photo uploads)
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

Object storage (uploaded photos, service key): `download_object(bucket, path, max_bytes=)` (LookupError when missing, ValueError when larger), `create_signed_url(bucket, path, expires_s)`, `delete_objects(bucket, paths)`. `MemoryStore` keeps bytes in `objects` (`put_object` for tests).

## Uploaded photos (`sherlock_core.uploads`)

- Bucket `media` is private (0004_uploads.sql: 8 MB, image/jpeg, image/png, image/webp, image/gif). Storage policies let a signed-in user insert, select and delete only under `uploads/<auth.uid()>/`.
- The browser uploads with the Supabase client to `uploads/<uid>/<random uuid>.<ext>` (never the original file name) and searches `{"type": "image", "value": "storage://media/uploads/<uid>/<uuid>.<ext>"}`.
- `normalize_target("image", ...)` accepts exactly that shape (anything else, traversal and other buckets included, is 400). The gateway accepts it only when `<uid>` is the caller's user id: otherwise 403 `This uploaded photo belongs to another account.` (outcome `forbidden`). http(s) URLs are unchanged.
- The path stays on the case (`identifiers`, job `target_value`, entities). The default case title is "Uploaded photo". `search_log.target_value` is `"uploaded photo"`, never the path; operator target counts and the shared-target flag leave it out.
- `image_meta` reads the object through the store (same 8 MB cap); with GPS it adds `extra.note = "This photo contains location data"` (coordinates stay rounded to 2 decimals; the web shows them only that coarse, on the "Where and when" map). `reverse_image_links` and `reverse_image` sign a one-hour URL; it only lives inside the links finding (`extra.note` says the links stop working after an hour, `expires_s: 3600`) and the SerpApi request, never in logs, job rows or error reasons.
- Deleting a case (`DELETE /cases/{id}` or `DELETE /admin/cases/{id}`) deletes its owner's uploaded objects first (`delete_case_uploads`); a storage failure is logged and the case is still deleted.
- Web: `DataSource.uploadPhoto(file, ext)` and `photoUrl(value)` (signed URL for the owner; fixtures use an object URL). A Storage permission error before 0004 has run reads "Photo upload is not set up on this server yet".

## Photo location check ("Where and when")

Could a photo have been taken where and when it is said to be? Places and conditions only: no face detection or recognition, nothing about who is in the picture, no street addresses.

Claim (`gateway.schemas.PhotoClaim`, normalised by `sherlock_core.geo.claims.normalize_claim`): `{place?: string <= 120, lat?: number, lon?: number, taken_at?: ISO 8601 date-time WITH offset}`. All optional; `lat`/`lon` together or not at all, rounded to 2 decimals (about 1 km) before storage; `taken_at` not before 1900 and not more than a day in the future; unknown fields are 422. It travels as job params `{"claim": {...}}` on image jobs.

Modules (queue `media`, input `image`, file `modules/geo_context.py`). Each reads the EXIF itself (same capped download / store read as `image_meta`), because the jobs of one search run at the same time and `image_meta`'s row may not exist yet. Location = camera GPS, else the claimed point, else the claimed place looked up once (Nominatim search, coarse fields only). Every facet always writes its row (`found`, `not_found` with `extra.note` + `reason`, or `error`), so a re-run replaces every row (same `finding_key`).

| module | requires_env | platform: what |
|---|---|---|
| `geo_context` | none | `geo-sun`: `moments[]` (`label` camera/claim, `lat`, `lon`, `local_time`, `utc_offset`, `utc_time`, `timezone`, `timezone_source` offline/weather/claim (zone order: offline lookup `geo.tz` with the optional `timezonefinder`, the Open-Meteo zone, the claim's own offset for the claim moment), or when none is known `timezone_approximate: true` with `solar_time` and NO `local_time`/`utc_offset` (an approximation is never called local time), `azimuth`, `elevation`, `shadow_azimuth`, `shadow_ratio`, `daylight` day/twilight/night, `compass`, `shadow_compass`), NOAA equations in `geo.solar` · `geo-weather`: `moments[]` (`summary` in words, `kind`, `temperature_c`, `cloud_cover`, `precipitation_mm`, ...) and `source` from Open-Meteo archive/forecast, else (quota, timeout, any failure) NASA POWER hourly point data (community RE, UTC; T2M, PRECTOTCORR, CLOUD_AMT, all-sky/clear-sky sunlight as a cloud proxy; it trails real time by days, so a recent date is `not_found` saying so); `extra.source` open-meteo / nasa-power; answers cached in-process per (lat, lon, day) for an hour · `geo-place`: `place {district, city, state, country, country_code}`, `label`, `lat`, `lon`, `source`, `timezone`, `claim_point`, `claim_place`, `claim_distance_km` (Nominatim reverse zoom 14, at most 1 request/s per worker, never road / house number / postcode) · `geo-street`: `links {openstreetmap, google_maps, google_street_view, mapillary}` · `geo-checks`: `checks[]`, `claim`, `basis {lat, lon, location_source, camera_gps, camera_time, camera_utc, claimed_time, timezone}`, `lens` (ready / pending / none) |
| `geo_webcams` | `WINDY_WEBCAMS_KEY` | `geo-webcams`: `webcams[] {id, title, url, thumbnail, distance_km}` within 15 km, active public webcams only (Windy Webcams API v3) |
| `geo_street_images` | `MAPILLARY_TOKEN` | `geo-street-images`: `images[] {id, url, thumbnail, captured_on, distance_km}`, `radius_m` (Mapillary Graph API: a box of about 300 m, widened once to about 1 km when empty, limit 10, 25 s timeout retried once; when Mapillary still fails the row is `not_found` with a note and `links` instead of an error; the token never appears in a row or an error) |

Checks (`geo.claims.assess_claim(exif, claim, sun, weather, lens_matches, *, place, camera_utc, claim_place_offset, timezone_name) -> list[Check]`, pure): `Check {key, verdict: consistent | inconsistent | cant_tell, title, reason, look_for}`. Keys: `camera_metadata` (no EXIF), `edited` (editing software), `location_distance` (camera GPS vs claim: within 3 km for a point or landmark, 25 km for a town; beyond 4x that inconsistent), `time_difference` (15 minutes consistent, up to 3 hours can't tell), `time_zone` (claimed offset vs local offset there), `sun_<label>`, `weather_<label>`, `temperature_<label>` (what to look for; always can't tell), `lens_place` (Google Lens titles mention the claimed place). Google Lens titles come from the case's `reverse_image` rows; `geo_context` waits up to 40 s while that job is running. There is no overall score, on purpose. Geo rows are never correlation evidence or accounts; the report lists the checks under "Where and when".

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
| `headline`, `employer`, `education` | professional headline / employer / school as published (person modules, `linkedin_search`) |
| `preview` | where the profile fields came from when not from the platform's API: `{source: "page-meta", fetched_at, title, site_name, url}` (public profile page meta, `modules/preview.py`, added by the worker after identity scans) or `{source: "search-snippet", provider, query, fetched_at, title}` (`linkedin_search`). Absent for API data |

The worker's preview step only fills `avatar_url`, `fullname`, `bio`, `location` and `links` when the module left them empty (links are merged), and always sets `preview` with them.

Legacy rows keep their old shapes (documented in `packages/core/sherlock_core/correlation/facts.py`, the only code allowed to know them). Breach rows: `platform = "breach"`, top-level meta `breach_name`, `breach_date`, `data_classes`; pass `discriminator=<breach name>` so each breach is its own row.

Rows with top-level meta `summary: true` are scan coverage summaries (checked / found / error counts); fan-out modules emit one instead of hundreds of `not_found` rows. They are never correlation input.

`not_found` rows are stored (they show coverage) but are never correlation input.

### Unknown results ("could not be checked")

Existence checks have three outcomes: `found`, `not_found` and `unknown`. An unknown result is a row with `status = "error"` and top-level meta `reason` in `login_wall | blocked | rate_limited | ambiguous | rule_disabled`, `unknown: true` and `detail` (the source's own words). No migration: the status CHECK is unchanged. `sherlock_core.walled.is_unknown(f)` (web: `isUnknownFinding`) is the one test; a plain error row (free-text `reason`, no `unknown`) is not unknown.

- Unknown rows are never correlation, scoring or account input (those use `found` only) and never "misses". `summarize` returns `unknown` (a subset of `error`) and `by_source[...].unknown`; coverage summary rows carry `unknown` next to `found` / `not_found`.
- Web: "What we found" lists them under "Couldn't check automatically" (one entry per platform, left out when any source found that platform; reason in plain words; "Open profile" to `extra_metadata.url`). The scan panel says "Found on N sites · M couldn't be checked" and the summary sentence adds "M sites couldn't be checked automatically."
- Who emits them: `user_scanner` (library Error / per-check timeout, username searches), `whatsmyname` (`login_wall` rows for walled platforms when no working check runs), and the worker's preview step (`ambiguous`, below).

**Walled platforms** (`sherlock_core.walled.WALLED`): platforms whose logged-out profile page is identical for an existing and a made-up account (Instagram, Facebook, Threads; verified 2026-11-22, method in the module docstring; LinkedIn, Snapchat and TikTok's oEmbed tell them apart and are not walled). WhatsMyName never judges them. The user-scanner checks cover them (and ~70 other platforms: `user_scanner.covered_platforms()`); WhatsMyName skips every platform `user_scanner.covers()` reports, so one platform never gets two verdicts. Without user-scanner, a username search emits one `login_wall` row per walled platform with the exact profile URL.

**user-scanner for usernames**: by default the focused set `user_scanner.FOCUSED` (~70 modules, `engine.check` per module, `CONCURRENCY` 12, `CHECK_TIMEOUT_S` 25; measured ~21 s from a home connection, `timeout_s` 420 leaves room for a 10x slower host). `USER_SCANNER_USERNAMES=1` switches to the full ~2,500-site sweep (no dedupe). Found rows are listed, not-found rows only counted, errors listed as unknown (username) or counted (email sweep). Summary meta: `checked, found, not_found, unknown, errors, mode`.

**Rule health** (`sherlock_core/data/rule_health.json`, written by `uv run python -m sherlock_core.data.rule_health`): `{meta: {checked_at, connection, counts, total, method}, sites: {<site name>: {status, checked_at, detail}}}`, status `ok | false_negative | false_positive | indistinguishable | error`, from each site's own `known` accounts and one made-up name with the module's own request and matching (`whatsmyname.check_site`). `whatsmyname` loads it once (`load_health`, tolerates a missing file: then every rule runs), runs a site when its entry is missing or `ok`, and skips the rest silently. WhatsMyName summary meta: `checked, found, not_found, inconclusive, errors, unknown, disabled` (rules skipped by health), `covered` (left to user-scanner / walled), `walled` (login_wall rows emitted). `whatsmyname.health_counts()` gives the per-class totals.

**Confirmation of sweep hits** (`modules/preview.py`): when the worker's preview step fetches the page of a `found` row from `whatsmyname` or `user_scanner` and the page is a login wall, a generic landing page or a redirect away from the profile (`AMBIGUOUS_REASONS`), the row is returned with `status = "error"`, `reason = "ambiguous"`, `was = "found"` (same `finding_key`, so it replaces the found row). No extra request; walled platforms are exempt.

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
from sherlock_core.correlation import correlate, group_accounts, summarize
accounts = group_accounts(findings, split_keys=None)      # one Account per account, not per row
corrs = correlate(case_id, findings, split_keys=None)     # list of rows for store.sync_correlations
stats = summarize(findings, split_keys=None)              # case summary (accounts, handle reuse...), not review items
```

`extract_entities(findings)` returns pivot candidates (emails, handles, urls, domains) for `store.upsert_entities`, each with `source_finding_id` (the finding that showed it). Pass every row of the case: an identifier that any row was looked up by (a scanned target, whatever the row's status) is never returned. Seeds that were never scanned are not visible to it; `entities.is_seed` covers those.

### Accounts (`correlation.accounts`)

Several sources and lookups report the same account; the engine reasons over accounts, not rows. Found rows only; coverage summaries, non-evidence modules, breach, infostealer and crawler-event rows are never accounts.

- `account_key = "<canonical platform>:<normalised handle>"` ("Github", "github", "GitHub" are one platform). All found account rows with the same (platform, handle) are one account, whatever module reported them.
- A row looked up by another identifier whose own URL is a profile URL on the same platform joins that profile's account.
- A registration hit without a handle (e.g. "email E is registered on P") joins account (P, h) when a row of that account publishes E. Ambiguous (two accounts on P publish E) or no match: it stays its own item, keyed `"<platform>:<identifier_type>:<normalised identifier>"`.
- A scrape of an account's own profile URL belongs to that account.
- `Account`: `account_key, platform, label, handle, url, finding_ids, sources (modules), primary_finding_id, profile {fullname, bio, location, avatar_url, created_at: {value, finding_id}; emails, links: [{value, finding_id}]}, joined_by (plain-English reasons for non-trivial merges)`.
- `split_keys`: account keys the user split. Their findings come back one item each (`"<account_key>#<finding_id>"`).

Correlation row: `type` (rule name), `corr_key` (deterministic), `matched_value`, `entities_involved` (**finding ids**), `confidence` (0..1), `evidence` (list of human-readable strings or `{finding_id, platform, field, value, account_key}` dicts), `priority`.

- A reviewable correlation always links 2+ DIFFERENT accounts; `entities_involved` lists every finding of the linked accounts. A finding that only restates the email it was looked up by (a registration hit) is never link evidence; a profile found by that email (e.g. Gravatar) is.
- `same_account`: one row per account with 2+ findings. `matched_value = account_key`, `corr_key = sha256("same_account|" + account_key)`, `confidence = 1.0`, `priority = 0`, `entities_involved` = the account's findings, `evidence` = [summary, then `{finding_id, platform, field: "contributed", value, module, account_key}` per finding], and an initial `status: "approved"` (merged automatically). It is not a question for the reviewer. Rejecting it splits the account (`jobs.recorrelate` passes rejected `same_account` keys as `split_keys`); "reset" on it merges again (status back to `approved`). Either decision re-correlates the case.
- `shared_email_platform` is retired: that situation is a `same_account` merge.

Review state lives in `status` (`pending | approved | rejected`) and is owned by `store.sync_correlations` / `set_correlation_status`. The engine sets only the initial status of `same_account` rows; `sync_correlations` honours a supplied `status` only when it inserts a new key (and sets `reviewed_at` then), never on an existing row. Stale `same_account` rows that are still `approved` (automatic) are deleted like pending ones; rejected ones (splits) are kept.

## Jobs

One user action creates one **batch**: one job per applicable module, sharing `batch_id`.

```
queued -> running -> succeeded
                  -> queued (retry, attempts < max_attempts) -> ... -> failed
```

A worker must heartbeat at least every 30 s while a job runs. A job with no heartbeat for `JOB_STALE_SECONDS` is requeued by the next `claim_job` call.

Claiming (`store.claim_job(queue, worker, exclude_modules=())`, SQL `claim_job(p_queue, p_worker, p_stale_seconds, p_exclude_modules text[] default '{}')`): only queued jobs whose `run_after` has passed and whose module is not excluded; the oldest job of the case with the FEWEST running jobs in that queue first, then the oldest (round-robin between searches). Before 0003_limits.sql has run, `SupabaseStore` falls back to the 3-argument function and hands an excluded job straight back (fairness then needs the migration).

Modules with `heavy = True` (`whatsmyname`, `user_scanner`: hundreds of MB) never run two at a time in one worker.
Job `result`: `{"findings": <count>, "found": <count with status found>}`.

## Gateway HTTP API

All routes return JSON matching `sherlock_core.models`. Errors: `{"detail": "<message>"}`.
Auth: `Authorization: Bearer <Supabase access token>`; the gateway resolves it to `owner_id` and whether the session is anonymous. Every case route checks ownership (demo cases are read-only).

| Method and path | Body | Returns |
|---|---|---|
| `GET /health` | | `{ok, service}` |
| `GET /modules` | | `ModuleInfo[]` |
| `GET /platforms` | | `{key, label, domain, category, aliases[], hosts[]}[]` (public, `Cache-Control: public, max-age=86400`; see `sherlock_core.platforms`) |
| `POST /cases` | `{title?, tags?, identifiers: Identifier[], scan?: bool}` | `{case: Case, jobs: Job[]}` |
| `PATCH /cases/{id}` | `{title?, notes?, tags?, archived?}` | `Case` |
| `DELETE /cases/{id}` | | 204 |
| `POST /cases/{id}/scan` | `{type, value, modules?: string[]}` | `{batch_id, jobs: Job[]}` (202) |
| `GET /cases/{id}/candidates?name=` | | `{name, hints, candidates: Candidate[], unassigned_finding_ids}` (name search; see `sherlock_core.resolve`) |
| `POST /cases/{id}/candidates/{candidate_id}/confirm?name=` | | `{candidate, entities: Entity[]}`; adds pivot suggestions, starts no scan |
| `POST /cases/{id}/jobs/{job_id}/cancel` | | `Job` |
| `POST /cases/{id}/batches/{batch_id}/cancel` | | `{batch_id, cancelled, jobs: Job[]}`; stops one search (404 when the case has no such batch) |
| `GET /queue/status?case_id=` | | `{case_id, queued, running, waiting, ahead, jobs_ahead, estimated_wait_s}`: counts only, never other people's data. `ahead` = other unfinished searches in the same queue that started earlier; `waiting` = queued, nothing of its own running, and `ahead > 0`; `estimated_wait_s` is rough (null when not waiting). Readable for the case's owner (and demo cases) |
| `POST /cases/{id}/geo-check` | `{claim: PhotoClaim \| null, value?: image target of the case}` | `{batch_id, jobs}` (202): sets or clears the claim and re-runs the available geo modules only (see "Photo location check") |
| `POST /cases/{id}/wake` | | 202; re-pokes workers that have queued jobs for this case |
| `POST /cases/{id}/correlate` | | `{correlations: number}` |
| `GET /cases/{id}/exposure` | | `{score, band, factors[], computed_from, method}` (see `sherlock_core.scoring`) |
| `POST /cases/{id}/findings/{fid}/curate` | `{curated: bool}` | `Finding` |
| `POST /cases/{id}/correlations` | `{finding_ids: string[], note?}` | `Correlation` (manual link) |
| `POST /correlations/{id}/review` | `{decision: approve \| reject \| reset, note?}` | `Correlation` (for `same_account`: reject = split, reset = merge again, both re-correlate) |
| `GET /cases/{id}/report` | | `text/markdown` |
| `GET /cases/{id}/variations?type=&value=&count=` | | `{variations: string[]}` |
| `POST /cases/{id}/chat` | `{message}` | `{text, iterations, tool_calls_made}` |

Rules:
- `POST /cases` and `POST /cases/{id}/scan` accept optional `hints: {city?, employer?, school?, keywords?: string[]}` for `type = "name"` only.
- `POST /cases` and `POST /cases/{id}/scan` accept an optional `claim` (`PhotoClaim`) with an `image` target only (400 otherwise; 422 when invalid).
- `POST /cases/{id}/geo-check` is checked for blocked, paused, sign-in, the photo's owner and the backlog like a search, and logged in `search_log` (modules = the geo modules), but not counted against the search limits (the photo's own search may still be running): its own limits are `GEO_CHECKS_PER_CASE_PER_10M` (10, 429 `burst_limited`) and `GEO_CHECKS_PER_SESSION_PER_DAY` (40, 429 `rate_limited`). An unfinished earlier check of the same photo is cancelled. Audit action `photo_claim_set`.
- `type = "name"` requires a non-anonymous session (403 otherwise) and is limited by `NAME_SEARCHES_PER_USER_PER_DAY`.
- Search checks, in this order, on `POST /cases` (with `scan`) and `POST /cases/{id}/scan` (and the agent's scan tools); the first that fails answers:
  1. blocked session (403 `blocked`), 2. paused (503 `paused`),
  3. sign-in: with `REQUIRE_SIGN_IN` (default true) an anonymous session gets 401 `Sign in to run a search. It's free and takes a few seconds.` (`sign_in_required`),
  4. invalid input (400 `invalid`; anonymous name search 403 `forbidden` when sign-in is not required),
  5. one unfinished search per session (`ACTIVE_SEARCHES_PER_SESSION`, 1): 429 `active_search` with body `{detail, active_search: {case_id, batch_ids}}` (the web app offers "Open my running search" and "Stop it"),
  6. burst per session (`SEARCHES_PER_SESSION_PER_10M`, 3; key `burst:session:<user>:10m`): 429 `burst_limited`,
  7. per origin, by `ip_hash` so a new session does not reset it (`SEARCHES_PER_ORIGIN_PER_10M`, 5, key `origin:<ip_hash>:10m`: 429 `burst_limited`; `SEARCHES_PER_ORIGIN_PER_DAY`, 30, key `origin:<ip_hash>:day`: 429 `rate_limited`),
  8. daily: `NAME_SEARCHES_PER_USER_PER_DAY`, `SCANS_PER_SESSION_PER_DAY`, `SCANS_GLOBAL_PER_DAY` (429 `rate_limited`),
  9. backlog: a queue the search needs holds more than `QUEUE_BACKLOG_MAX` (80) queued jobs: 503 `busy` `Sherlock is busy right now. Try again in a few minutes.`
  Every timed refusal sends `Retry-After` (seconds: end of the fixed window, 180 for `busy`) and says the wait in words. Counters are only read until every check passed, then counted (`hit_rate_limit`), so a refused search costs nothing. A search request with several targets counts each. The operator (ADMIN_EMAILS principal) is exempt from 5, 6, 7 and the per-user daily limits, not from the global cap or the backlog guard.
- `POST /cases` and manual links return 201. A case owned by someone else is 403; a missing case is 404. Validation errors are 422 with a string `detail`.
- Reads (lists of cases, findings, correlations, jobs, entities, audit) are **not** on the gateway; the web app reads them from Supabase.
- A blocked session gets 403 `This session has been blocked from running searches.` and a paused app 503 `Searches are paused by the operator. Try again later.` on `POST /cases` (with `scan`) and `POST /cases/{id}/scan`, before anything is planned, counted or queued (blocked is checked first). Reads and other commands keep working. The web client shows a 503 that carries a JSON `detail` at once instead of retrying it as a cold start.
- Every search attempt (those two routes and the agent's scan tools) writes ONE `search_log` row per target with its outcome: `accepted`, `rate_limited` (429, daily limits), `burst_limited` (429, 10-minute limits), `active_search` (429), `busy` (503), `sign_in_required` (401), `blocked`, `paused`, `forbidden` (anonymous name search), `invalid` (400). The last four new outcomes need 0003_limits.sql; until it has run they are stored as `rate_limited` (`sign_in_required` as `forbidden`) with the specific `detail`. Ownership errors (403/404 on someone else's or a missing case) and body validation (422) are not search attempts. Logging never changes the answer: a failed log write is only reported in the server log.

## Operator panel

Who and what: the owner of a deployment sees what visitors search and where from, to spot misuse and stop it.

Tables (`0002_admin.sql`; RLS enabled with **no policies**, so only the service key can read or write them; never read them from the browser):

| Table | Columns |
|---|---|
| `visitor_sessions` | `user_id` (pk), `is_anonymous`, `email` (verified only), `first_seen`, `last_seen`, `ip_hash`, `country`, `user_agent` (300 chars), `search_count`, `refused_count` (kept by the `trg_search_log_counts` trigger), `blocked`, `blocked_at`, `blocked_reason` |
| `search_log` | `id` (identity), `created_at`, `user_id`, `case_id` (no FK: set to null by hand when the case is deleted), `target_type`, `target_value`, `modules[]`, `outcome`, `detail`, `ip_hash`, `country`, `is_anonymous` |
| `app_settings` | `key` (pk), `value` jsonb, `updated_at`, `updated_by`; key `scans_paused` |

Privacy rules (not negotiable):
- No raw IP address is ever stored, logged or returned. `ip_hash` = first 16 hex chars of HMAC-SHA256(`INTERNAL_SECRET`, client IP); the client IP is the first hop of `X-Forwarded-For`, else the socket peer. It only says that two sessions share an origin (and a client can forge `X-Forwarded-For`, so treat it as a hint).
- `country` only from the `CF-IPCountry` edge header (two letters, `XX` dropped). No geo-IP service is ever called with visitor IPs.
- The user agent is stored truncated; the panel shows it as "Browser on OS" (the raw string under Advanced).
- `search_log` rows are deleted after 90 days (`purge_old_search_log`, called by the gateway at most once a day). The responsible-use page and the first-search dialog say so.
- Lists in the panel show cases as metadata only (title, targets, counts). The full contents of a case (findings included) are shown only in the read-only case view below, one case at a time, and every opening is recorded on that case's own audit log, which its owner sees in the case history. Visitors are told this in the first-search acknowledgement, "How it works" and the responsible-use page.

Every authenticated gateway request touches the caller's `visitor_sessions` row (at most once a minute per session, in-process throttle). `Principal` carries `email` and `email_verified` from the verified Supabase user.

Admin API. Guard: a non-anonymous principal whose **verified** email is in `ADMIN_EMAILS` (comma-separated, case-insensitive; empty means nobody). Everyone else, with or without a token, gets `404 {"detail": "Not Found"}` for every method and path under `/admin` (no 401/403/405), and the routes are not in the OpenAPI schema. Lists take `limit` and `cursor` and return `{items, next_cursor}`. Every action writes `audit_log` (`case_id` null, `actor = "operator"`, `action = operator_*`, `detail.admin = <email>`).

| Method and path | Body | Returns |
|---|---|---|
| `GET /admin/me` | | `{is_admin: true, email}` |
| `GET /admin/overview?days=14` (1..90) | | totals (searches, accepted, refused, sessions, flagged_sessions, cases, active_jobs), `series` per UTC day by outcome, `by_type`, `top_targets` (searched 2+ times), `quota` (global used today vs limits), `scans_paused`, `retention_days` |
| `GET /admin/searches?outcome=&type=&q=&session=&since=` | | feed rows (newest first, keyset cursor = last id) with `session` (label data, `origin` = ip_hash, `origin_sessions`) |
| `GET /admin/sessions?flagged=&blocked=&q=` | | visitors with `flags` (offset cursor; `flagged=true` sorts most severe first) |
| `GET /admin/sessions/{user_id}` | | `{session, searches (newest 200), cases (metadata only)}` |
| `POST /admin/sessions/{user_id}/block` | `{reason}` | visitor |
| `POST /admin/sessions/{user_id}/unblock` | | visitor |
| `POST /admin/pause` | `{paused}` | `{scans_paused}` |
| `DELETE /admin/cases/{case_id}` | | 204 (demo cases: 400) |
| `GET /admin/cases/{case_id}?findings_limit=&findings_offset=` | | `{case, findings (page, limit 1..2000, default 1000), findings_total, findings_next_offset, correlations (same_account included), entities, jobs, audit}`. Read-only abuse review: there is no write route under it. The first page writes `audit_log` `{case_id, action: "admin_case_viewed", actor: "operator", detail: {admin: <email>}}` |

Misuse flags (`gateway.insights.session_flags`, pure; thresholds are named constants there; window: the last 7 days): many searches in a short burst, hit the burst limit, repeated rate limits, many distinct targets (harvesting rather than a self-check), repeated refused name searches, a target also searched from several sessions, several sessions sharing one `ip_hash`. Each is `{key, label, severity: high | medium | low}` with a plain-English label. Flags are hints for a person; nothing is blocked automatically.

Web: `/admin` (not in the public navigation; the account menu shows it when `GET /admin/me` succeeds, asked only for signed-in sessions). Fixture mode and `/demo/admin` run the same components on invented data (`apps/web/lib/admin/demo-source.ts`). `/admin/cases/[id]` (and `/demo/admin/cases/[id]`) is the read-only case view: the investigation page in read-only mode under the banner "Viewing as operator · read-only · this view is logged", on a data source that refuses every write (`apps/web/lib/data/read-only-source.ts`).

## Worker HTTP API

| Method and path | Purpose |
|---|---|
| `GET /health` | `{ok, queue, busy}` |
| `POST /wake` | Header `X-Sherlock-Signature: <hex hmac-sha256(INTERNAL_SECRET, body)>`, body `{"ts": <unix seconds>}` (reject if older than 5 min). Starts the drain loop if idle, returns 202 immediately. |

The drain loop is a small pool: up to `WORKER_CONCURRENCY` (3) jobs at once, at most one heavy module (claims pass the heavy module names as `exclude_modules` while one runs). It claims while slots are free, keeps lingering for retries in backoff, and stops when the queue is empty and nothing runs. Each job keeps its own heartbeat, cancellation and timeout; a crashing job never stops the pool; on shutdown every running job is handed back. Profile-preview and avatar downloads share one limiter per worker (`ENRICH_CONCURRENCY`, 4).

## Environment

See `packages/core/sherlock_core/config.py` (`ADMIN_EMAILS` turns on the operator panel; search limits, `REQUIRE_SIGN_IN`, `WORKER_CONCURRENCY`; `WINDY_WEBCAMS_KEY` and `MAPILLARY_TOKEN` for the optional photo-location modules, set on the gateway and the media worker; `GEO_CHECKS_PER_CASE_PER_10M`, `GEO_CHECKS_PER_SESSION_PER_DAY`). Web app: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_REQUIRE_SIGN_IN` (default true; only decides whether the app asks for sign-in before calling the gateway, which decides), `NEXT_PUBLIC_FIXTURE_REQUIRE_SIGN_IN` (fixture mode; also `?signin=required`).

## Boundaries (not negotiable)

Public data only. Breach data is exposure metadata only (name, date, data classes), never records. No phone-number or national-ID to identity lookup. No face recognition. No home addresses, no family or relatives mapping. The photo location check is about places and conditions: coordinates rounded to about 1 km, place names at district / city level, public operator-published webcams and public street-level imagery only.
