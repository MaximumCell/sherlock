-- Apply once via Supabase SQL editor (plan Section 5)
create table if not exists cases (
  id            uuid primary key default gen_random_uuid(),
  identifiers   jsonb not null,           -- [{type, value}]
  created_at    timestamptz not null default now(),
  status        text not null default 'new'   -- new | running | done | error
);

create table if not exists raw_findings (
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
create index if not exists idx_findings_identifier on raw_findings (identifier_value);
create index if not exists idx_findings_meta on raw_findings using gin (extra_metadata);

create table if not exists correlations (
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
create index if not exists idx_corr_case on correlations (case_id, reviewed);

create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  case_id     uuid references cases(id) on delete set null,
  action      text not null,      -- collector_run | correlation | agent_call | report
  actor       text not null,      -- tool name or "agent"
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_case on audit_log (case_id);
