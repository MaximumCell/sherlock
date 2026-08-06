# OSINT Investigation Agent — Project Plan

## 0. Purpose & Scope (read this first, agent)

This project builds an AI agent that helps a user investigate a target (username, email,
domain, or self-check) by orchestrating existing open-source OSINT tools, correlating
findings, and writing a narrative report — **not** by scraping or querying leaked/breach
databases that expose private government or telecom records (e.g. CNIC lookups, phone
number → address/identity resolution). Any tool or data source added to this project must
meet this bar:

- ✅ Public social/professional profile data (usernames, bios, public posts)
- ✅ Breach/leak **exposure confirmation** (e.g. "this email appeared in Breach X") without
  reconstructing full personal records
- ✅ Public government/registry data (company registries, court records, open data portals)
- ✅ Data the target published about themselves
- ❌ Any source that resolves a phone number or CNIC to a full identity/address
- ❌ Any source built from unauthorized/leaked personal government or telecom databases
- ❌ Any correlation output presented as certain fact rather than confidence-scored

If a future tool or data source is ambiguous against this list, flag it for human review
before wiring it in — don't silently include it.

---

## 1. Architecture Overview

Three layers, kept strictly separate so the LLM never invents facts:

```
┌─────────────────────────────────────────────────────┐
│  1. COLLECTORS (deterministic, no AI)                │
│     - user-scanner (username/email sweep + Hudson    │
│       Rock breach exposure)                          │
│     - HaveIBeenPwned API (breach exposure)            │
│     - SpiderFoot (domain/IP/DNS recon + its own       │
│       correlation rule engine)                        │
│     - osint-mcp-server (Shodan/VirusTotal/WHOIS/etc,  │
│       optional, add later if needed)                  │
└─────────────────────────────────────────────────────┘
                     ↓ raw JSON per tool
┌─────────────────────────────────────────────────────┐
│  2. NORMALIZATION + CORRELATION (deterministic code)  │
│     - Flatten all tool outputs into one common schema │
│     - Apply simple matching rules (shared username    │
│       reuse, same email across platforms, same bio    │
│       text, platform overlap counts)                  │
│     - Every correlation gets a confidence score + the  │
│       evidence that produced it                        │
│     - Every finding gets a priority = confidence ×    │
│       platform reach (triage order)                   │
└─────────────────────────────────────────────────────┘
                     ↓ structured case file (JSON)
┌─────────────────────────────────────────────────────┐
│  3. AGENT LAYER (LLM — Gemma 4B via google-genai)    │
│     - Reads the structured case file only              │
│     - Decides which collector to run next (tool use)   │
│     - Narrates findings, explains confidence, writes    │
│       the final report                                 │
│     - NEVER invents a connection not already in the     │
│       correlation output                                │
└─────────────────────────────────────────────────────┘
```

**Golden rule:** the agent narrates and orchestrates. It does not correlate on its own
judgment from raw text dumps — correlation is code's job.

Serving layer: a **FastAPI backend** exposes the pipeline (cases, run, findings,
correlations, review, report, audit) to a **Next.js frontend**. Single-user, no auth;
CORS allows localhost only.

```
Next.js frontend (frontend/)
   │  fetch (no auth, CORS localhost)
   ▼
FastAPI backend (api/)  →  core/ pipeline  →  Supabase
```

---

## 2. Tech Stack (all free / open-source)

| Piece | Choice | Why |
|---|---|---|
| Language | Python 3.11+ | All chosen tools are Python-native |
| Collector: username/email | [`user-scanner`](https://github.com/kaifcodec/user-scanner) | Library mode (`engine.check()`), 285+ platforms, built-in Hudson Rock breach check |
| Collector: breach exposure | HaveIBeenPwned API | Free web UI; ~$3.50/mo for API key if programmatic access needed |
| Collector: domain/IP/DNS | [SpiderFoot](https://github.com/smicallef/spiderfoot) | 200+ modules, its own YAML correlation rule engine, SQLite backend |
| Collector: infra (optional, later) | [osint-mcp-server](https://github.com/badchars/osint-mcp-server) | MCP-native, 37 tools across Shodan/VirusTotal/Censys/WHOIS |
| Case storage | **Supabase** (hosted Postgres) | Free tier (500MB DB, 5GB bandwidth/mo), survives redeploys unlike SQLite, JSONB columns map cleanly to `extra_metadata`/`evidence`, built-in auth/RLS if you add multi-user later. Note: free projects pause after ~1 week idle, first request after a pause is slow. Data encrypted at rest by host. |
| Correlation graph | Plain Python dict/JSON for v1 → NetworkX if needed → Neo4j only if you outgrow both | Avoid Neo4j until you actually hit a query NetworkX can't express |
| Agent orchestration | Simple custom loop (tool-call → execute → feed result back) | Your tool list is custom; a framework (LangChain etc.) adds abstraction you don't need yet |
| LLM | **Gemma 4B via `google-genai`** | Default model `MODEL_NAME` env (default `gemma-3-4b-it`). ⚠️ Gemma 4B is an open-weight model, not served by the Gemini API — it runs via Ollama or a hosted Gemma endpoint, and 4B models are weak at multi-tool function calling. `agent/llm.py` is the single file to swap if tool-calling quality blocks Phase 5. No local/Ollama abstraction is built in advance — swap = rewrite one file. |
| API layer | FastAPI | Python-native, auto OpenAPI docs, trivial static/CORS setup |
| Frontend | Next.js (App Router) | User chose it; route handlers only (no server actions) for v1 |
| Report output | Markdown → optionally PDF/docx export | Markdown is fastest to generate and diff during development; rendered in the frontend |

---

## 3. Data Schema

All collector output gets normalized into this common shape before anything else touches it:

```json
{
  "case_id": "string",
  "identifier_type": "username | email | domain",
  "identifier_value": "string",
  "source_tool": "user-scanner | hibp | spiderfoot | ...",
  "platform": "string",
  "status": "found | not_found | error",
  "extra_metadata": { "...": "tool-specific fields" },
  "collected_at": "ISO 8601 timestamp"
}
```

Correlation output (produced by code, read by the agent) looks like:

```json
{
  "case_id": "string",
  "correlation_id": "string",
  "type": "username_reuse | shared_bio_text | shared_email_platform | breach_overlap",
  "entities_involved": ["platform:identifier", "platform:identifier"],
  "confidence": 0.0,
  "evidence": ["human-readable reason 1", "reason 2"],
  "priority": 0.0,
  "reviewed": false
}
```

`priority = confidence × platform_reach` — computed in `correlate.py`, used to order the
review queue and the final report (highest first). `reviewed` starts `false` — the
human-in-the-loop review step (Phase 4) flips it to `true` before the agent is allowed to
cite it as an accepted finding in a final report.

---

## 4. Secrets & Configuration

- `core/config.py` loads all config from environment variables via `dotenv`.
- `.env` (gitignored) holds: `MODEL_NAME`, `GOOGLE_API_KEY` (Gemma endpoint), `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, `HIBP_API_KEY`, `SPIDERFOOT_URL`.
- `.env.example` is committed with placeholders.
- Never commit `.env` or any real key. Supabase service key is server-side only — the
  frontend never receives it.

---

## 5. Database Schema (DDL)

Four tables, defined in `core/schema.sql`, applied once via the Supabase SQL editor.

```sql
create table cases (
  id            uuid primary key default gen_random_uuid(),
  identifiers   jsonb not null,           -- [{type, value}]
  created_at    timestamptz not null default now(),
  status        text not null default 'new'   -- new | running | done | error
);

create table raw_findings (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases(id) on delete cascade,
  identifier_type  text not null,
  identifier_value text not null,
  source_tool      text not null,
  platform         text not null,
  status           text not null,           -- found | not_found | error
  extra_metadata   jsonb not null default '{}'::jsonb,
  collected_at     timestamptz not null default now(),
  unique (case_id, source_tool, platform, identifier_value)
);
-- idempotency: re-runs use ON CONFLICT upsert, never duplicate rows
create index idx_findings_identifier on raw_findings (identifier_value);
create index idx_findings_meta on raw_findings using gin (extra_metadata);

create table correlations (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references cases(id) on delete cascade,
  type             text not null,
  entities_involved jsonb not null,
  confidence       float not null,
  evidence         jsonb not null,
  priority         float not null default 0,
  reviewed         boolean not null default false,
  review_note      text,
  created_at       timestamptz not null default now()
);
create index idx_corr_case on correlations (case_id, reviewed);

create table audit_log (
  id          bigint generated always as identity primary key,
  case_id     uuid references cases(id) on delete set null,
  action      text not null,      -- collector_run | correlation | agent_call | report
  actor       text not null,      -- tool name or "agent"
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index idx_audit_case on audit_log (case_id);
```

`core/db.py` wraps Supabase (`supabase-py`) with insert/query/upsert helpers; the rest of
the codebase talks to this wrapper only, so a DB swap is one file.

**Data-at-rest policy**
- Store breach **exposure metadata only** (breach name, date, data categories) — never full
  raw breach contents (passwords, etc.).
- `export_case(case_id)` and `delete_case(case_id)` (right-to-be-forgotten) are API
  endpoints. 90-day default retention for completed cases.

---

## 6. Build Phases

### Phase 1 — Collectors working standalone (no agent yet)
- [ ] Set up Python venv, pin deps in `requirements.txt` + `requirements.lock`
- [ ] Write a thin wrapper script that calls `user-scanner`'s library mode for a
      username and an email, dumps normalized JSON to disk
- [ ] Get an HIBP API key and write a small wrapper function for breach lookups
- [ ] Install SpiderFoot locally (`apt install spiderfoot` on Kali/Ubuntu, or Docker),
      confirm you can run a scan against a domain via its API/CLI and get JSON out
- [ ] **Milestone:** you can run 3 independent scripts against a test identifier and get
      3 clean JSON files, no AI involved yet

### Phase 2 — Normalization + case storage
- [ ] Write a normalizer function per collector that maps its raw output into the
      common schema from Section 3
- [ ] Apply `core/schema.sql` in the Supabase SQL editor
- [ ] Write `core/db.py` wrapper around Supabase (insert/query/upsert)
- [ ] Write `create_case(identifiers)` that stores the case and its seed identifiers
- [ ] **Milestone:** running all 3 collectors against one case populates `raw_findings`
      (no duplicates on re-run) — check via the Supabase table editor

### Phase 3 — Correlation engine (deterministic, no AI)
- [ ] Implement rule: same username string appears across N+ platforms → correlation
      with confidence scaled by N
- [ ] Implement rule: same bio/profile text (exact or high fuzzy-match similarity)
      across two accounts → correlation
- [ ] Implement rule: email and username both resolve on the same platform → correlation
- [ ] Implement rule: breach overlap — same identifier appears in the same breach via
      two different collectors → correlation
- [ ] Compute `priority = confidence × platform_reach`; every rule writes to
      `correlations` with `reviewed = false`
- [ ] **Milestone:** running collectors + correlation on a test case produces a
      correlations table with sensible confidence/priority scores you can eyeball and agree with

### Phase 4 — API + review queue (human-in-the-loop, in the browser)
- [ ] Stand up FastAPI app (`api/main.py`) with CORS for localhost
- [ ] Endpoints: `POST /cases`, `GET /cases`, `GET /cases/{id}`,
      `POST /cases/{id}/run`, `GET /cases/{id}/findings`,
      `GET /cases/{id}/correlations`, `POST /correlations/{id}/review`,
      `POST /cases/{id}/report`, `GET /cases/{id}/report`,
      `DELETE /cases/{id}`, `GET /audit`
- [ ] Frontend case-list + case-detail pages wired to the API
- [ ] Review screen lists unreviewed correlations (highest priority first);
      approve/reject each one. Approved → `reviewed = true`; rejected → deleted or flagged
- [ ] **Milestone:** you can walk through a case's correlations in the browser and
      approve/reject them before any AI touches the data

### Phase 5 — Agent layer
- [ ] Define agent tools as Python functions the LLM can call: `run_username_scan`,
      `run_email_scan`, `run_domain_scan`, `get_case_findings`, `get_reviewed_correlations`
- [ ] `agent/llm.py`: Gemma 4B via `google-genai`, `MODEL_NAME` the only knob. Verify
      tool-calling quality early — if 4B function-calling is unreliable, swap this one file
- [ ] Write the system prompt for the agent (see Section 7 below) — keep it strict about
      only narrating reviewed correlations, never inventing new ones
- [ ] Build the orchestration loop: user message → agent picks tool(s) → execute →
      feed results back → agent responds or calls another tool. Wire to
      `POST /cases/{id}/run` (synchronous for v1; background task with status poll if scans are slow)
- [ ] **Milestone:** you can chat with the agent, ask it to investigate an identifier, and
      it correctly calls collectors, then narrates only from reviewed data

### Phase 6 — Report generation
- [ ] Agent generates a final Markdown report: identifiers investigated, findings by
      platform, approved correlations with evidence and confidence, recommended next
      steps — ordered by `priority`
- [ ] Report rendered in the frontend via `GET /cases/{id}/report`
- [ ] Add export to PDF/docx if you want a polished deliverable
- [ ] **Milestone:** end-to-end run — case creation → collection → correlation → human
      review → agent report — works in the browser for a real test identifier (use your
      own accounts for testing, not someone else's)

### Phase 7 (optional, later) — Scale up only if you need it
- [ ] Swap simple table-query correlation for NetworkX if query complexity grows
- [ ] Swap NetworkX for Neo4j only if you hit queries it can't express well
- [ ] Add osint-mcp-server for infra-heavy cases (IP/domain-focused investigations)
- [ ] Add Supabase Auth + RLS if multi-user becomes a real requirement

---

## 7. Agent System Prompt (starting point — refine as you go)

```
You are an OSINT investigation assistant. You help users investigate public digital
footprints for security research, personal exposure checks, and authorized
investigations only.

Rules you must follow:
1. You may only call the tools provided to you (run_username_scan, run_email_scan,
   run_domain_scan, get_case_findings, get_reviewed_correlations).
2. You may only present correlations that appear in get_reviewed_correlations output
   (reviewed = true). Never state a connection between two accounts/identities unless
   it appears there with its evidence and confidence score.
3. Always state confidence levels honestly — do not round "possible" up to "confirmed."
4. Do not attempt to resolve phone numbers or national ID numbers to personal identity
   or address information under any circumstance, even if a tool result contains such
   data — flag it and stop instead of using it.
5. When writing reports, cite which tool/source produced each finding.
6. If asked to investigate a target with no clear self-check or authorized-research
   framing, ask the user to confirm the legitimate purpose before proceeding.
```

---

## 8. Reliability & Guardrails

**Rate limiting / anti-ban (per collector)**
- `user-scanner`: ~10 requests/min across platforms + jitter; per-platform retry caps
- HIBP: respect `Retry-After`; use batch API where available
- SpiderFoot: `SF_SCAN_TIMEOUT` + throttle between scans
- All limits live in `core/config.py`; backoff is exponential with a max cap

**Error handling**
- Every collector wrapper returns `status: "found" | "not_found" | "error"` — one failing
  tool never aborts the whole run
- 2 retries with backoff, then the error is logged to `audit_log` and the finding row
  gets `status: "error"`

**Audit trail**
- Every collector run, correlation, agent tool-call, and report generation writes to
  `audit_log` (action, actor, detail). Provenance is the product for an investigation tool.

---

## 9. Suggested Repo Structure

```
osint-agent/
├── plan.md                      (this file)
├── requirements.txt + .lock
├── .env.example                 (gitignored: .env)
├── core/
│   ├── config.py                (env loading, rate limits)
│   ├── schema.sql               (Section 5 DDL)
│   ├── db.py                    (Supabase wrapper + upserts)
│   ├── normalize.py             (per-collector → common schema)
│   ├── correlate.py             (deterministic rules + priority)
│   └── collectors/
│       ├── user_scanner_wrapper.py
│       ├── hibp_wrapper.py
│       └── spiderfoot_wrapper.py
├── agent/
│   ├── tools.py                 (tool functions exposed to the LLM)
│   ├── llm.py                   (Gemma 4B via google-genai — swap point)
│   ├── system_prompt.md
│   └── orchestrator.py          (the agent loop)
├── api/
│   ├── main.py                  (FastAPI app + CORS localhost)
│   ├── schemas.py               (Pydantic models)
│   └── routers/                 (cases, findings, correlations, reports, audit)
├── frontend/                    (Next.js App Router, route handlers only)
│   ├── app/
│   │   ├── page.tsx             (case list / create)
│   │   ├── case/[id]/page.tsx   (detail: findings, platform cards)
│   │   ├── review/[id]/page.tsx (approve/reject queue)
│   │   ├── report/[id]/page.tsx (report view)
│   │   └── audit/page.tsx
│   └── lib/api.ts               (typed fetch client → FastAPI)
├── cli.py                       (thin headless runner: run/resume/report/export/delete)
├── reports/
│   └── report_generator.py
└── tests/
    ├── fixtures/*.json          (recorded real tool outputs, offline-runnable)
    ├── test_correlate.py        (correlation rules against known-good fixtures)
    └── test_collectors.py       (wrapper tests with mocked HTTP)
```

---
