-- Sherlock v2 schema upgrade.
-- Safe to run on a database created from supabase/schema_v1.sql, and safe to re-run.
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- What it does
--   * cases        : title, notes, tags, owner, demo flag
--   * raw_findings : stable finding_key (fixes breach rows collapsing), real `curated` column
--   * correlations : deterministic corr_key + review status, so rescans keep human decisions
--   * jobs         : durable Postgres job queue (replaces the in-memory dict)
--   * entities     : graph nodes / pivot candidates
--   * rate_limits  : fixed-window counters
--   * RLS          : every visitor only reads their own cases (plus demo cases)
--   * Realtime     : live updates for jobs, findings, correlations


-- ---------------------------------------------------------------- cases
alter table cases add column if not exists title       text;
alter table cases add column if not exists notes       text not null default '';
alter table cases add column if not exists tags        text[] not null default '{}';
alter table cases add column if not exists owner_id    uuid;
alter table cases add column if not exists is_demo     boolean not null default false;
alter table cases add column if not exists updated_at  timestamptz not null default now();
alter table cases add column if not exists archived_at timestamptz;
create index if not exists idx_cases_owner on cases (owner_id, created_at desc);

-- ---------------------------------------------------------------- raw_findings
alter table raw_findings add column if not exists finding_key text;
alter table raw_findings add column if not exists module      text;
alter table raw_findings add column if not exists job_id      uuid;
alter table raw_findings add column if not exists curated     boolean not null default false;

update raw_findings
   -- must equal sherlock_core.models.finding_key() so a rescan updates these rows
   set finding_key = encode(sha256(convert_to(
         source_tool || '|' || platform || '|' || lower(btrim(identifier_value)) || '|' ||
         coalesce(extra_metadata ->> 'breach_name', extra_metadata ->> 'date_compromised', ''),
       'UTF8')), 'hex')
 where finding_key is null;
update raw_findings
   set curated = true
 where curated = false and (extra_metadata ->> 'curated') = 'true';
update raw_findings set module = source_tool where module is null;

alter table raw_findings alter column finding_key set not null;

do $$
declare c record;
begin
  -- drop the v1 unique constraint (auto-generated name), whatever it was called
  for c in
    select conname from pg_constraint
     where conrelid = 'raw_findings'::regclass and contype = 'u'
       and conname <> 'raw_findings_case_key_uniq'
  loop
    execute format('alter table raw_findings drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'raw_findings_case_key_uniq') then
    alter table raw_findings add constraint raw_findings_case_key_uniq unique (case_id, finding_key);
  end if;
end $$;
create index if not exists idx_findings_case_status on raw_findings (case_id, status);

-- ---------------------------------------------------------------- correlations
alter table correlations add column if not exists corr_key      text;
alter table correlations add column if not exists matched_value text;
alter table correlations add column if not exists status        text;
alter table correlations add column if not exists reviewed_at   timestamptz;
alter table correlations add column if not exists updated_at    timestamptz not null default now();

do $$
begin
  -- v1 had a plain boolean `reviewed`; v2 derives it from status
  if exists (
    select 1 from information_schema.columns
     where table_name = 'correlations' and column_name = 'reviewed' and is_generated = 'NEVER'
  ) then
    update correlations set status = case when reviewed then 'approved' else 'pending' end where status is null;
    alter table correlations drop column reviewed;
  end if;
end $$;

update correlations set status = 'pending' where status is null;
update correlations set corr_key = 'legacy:' || id::text where corr_key is null;
alter table correlations alter column status set default 'pending';
alter table correlations alter column status set not null;
alter table correlations alter column corr_key set not null;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'correlations' and column_name = 'reviewed') then
    alter table correlations add column reviewed boolean generated always as (status = 'approved') stored;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'correlations_status_check') then
    alter table correlations add constraint correlations_status_check
      check (status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'correlations_case_key_uniq') then
    alter table correlations add constraint correlations_case_key_uniq unique (case_id, corr_key);
  end if;
end $$;
create index if not exists idx_corr_case_status on correlations (case_id, status);

-- ---------------------------------------------------------------- jobs
create table if not exists jobs (
  id            uuid primary key default gen_random_uuid(),
  case_id       uuid not null references cases(id) on delete cascade,
  batch_id      uuid,                         -- one user action = one batch of jobs
  queue         text not null,                -- identity | infra | media
  module        text not null,                -- registry name, or 'correlate'
  target_type   text not null,                -- username | email | domain | ip | image | phone | wallet | name
  target_value  text not null,
  params        jsonb not null default '{}'::jsonb,
  status        text not null default 'queued'
                check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress      int  not null default 0 check (progress between 0 and 100),
  progress_note text,
  attempts      int  not null default 0,
  max_attempts  int  not null default 3,
  locked_by     text,
  heartbeat_at  timestamptz,
  run_after     timestamptz not null default now(),
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index if not exists idx_jobs_claim on jobs (queue, status, run_after, created_at);
create index if not exists idx_jobs_case on jobs (case_id, created_at desc);

-- Claim the oldest runnable job for a queue. Also recovers jobs whose worker
-- died (no heartbeat for p_stale_seconds): requeue, or fail after max_attempts.
create or replace function claim_job(p_queue text, p_worker text, p_stale_seconds int default 120)
returns setof jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  update jobs
     set status      = case when attempts >= max_attempts then 'failed' else 'queued' end,
         error       = case when attempts >= max_attempts then 'worker lost: no heartbeat' else error end,
         finished_at = case when attempts >= max_attempts then now() else null end,
         locked_by   = null
   where queue = p_queue
     and status = 'running'
     and heartbeat_at < now() - make_interval(secs => p_stale_seconds);

  return query
  update jobs j
     set status       = 'running',
         locked_by    = p_worker,
         attempts     = j.attempts + 1,
         started_at   = coalesce(j.started_at, now()),
         heartbeat_at = now(),
         error        = null
   where j.id = (
           select q.id from jobs q
            where q.queue = p_queue and q.status = 'queued' and q.run_after <= now()
            order by q.created_at
            for update skip locked
            limit 1)
  returning j.*;
end $$;

-- ---------------------------------------------------------------- entities
create table if not exists entities (
  id                uuid primary key default gen_random_uuid(),
  case_id           uuid not null references cases(id) on delete cascade,
  kind              text not null,   -- username | email | domain | ip | url | image | phone | wallet | name
  value             text not null,   -- normalised
  platform          text,            -- for handles: canonical platform name
  source_finding_id uuid references raw_findings(id) on delete set null,
  is_seed           boolean not null default false,  -- entered by the investigator
  scanned           boolean not null default false,
  first_seen        timestamptz not null default now(),
  unique (case_id, kind, value)
);
create index if not exists idx_entities_case on entities (case_id);

-- ---------------------------------------------------------------- rate limits
create table if not exists rate_limits (
  key          text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key, window_start)
);

-- Returns true when the caller is still inside the limit (and counts the hit).
create or replace function hit_rate_limit(p_key text, p_window_seconds int, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into rate_limits (key, window_start, count) values (p_key, w, 1)
  on conflict (key, window_start) do update set count = rate_limits.count + 1
  returning count into c;
  delete from rate_limits where window_start < now() - interval '2 days';
  return c <= p_limit;
end $$;

revoke all on function claim_job(text, text, int) from public, anon, authenticated;
revoke all on function hit_rate_limit(text, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------- updated_at
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_cases_touch on cases;
create trigger trg_cases_touch before update on cases
  for each row execute function touch_updated_at();
drop trigger if exists trg_corr_touch on correlations;
create trigger trg_corr_touch before update on correlations
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- row level security
-- All writes go through the gateway/workers with the service key (bypasses RLS).
-- Browsers hold an anonymous or signed-in Supabase session and may only READ
-- their own cases and anything marked as a demo.
alter table cases        enable row level security;
alter table raw_findings enable row level security;
alter table correlations enable row level security;
alter table jobs         enable row level security;
alter table entities     enable row level security;
alter table audit_log    enable row level security;
alter table rate_limits  enable row level security;

create or replace function can_read_case(p_case uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cases c
                  where c.id = p_case and (c.is_demo or c.owner_id = auth.uid()));
$$;

drop policy if exists cases_read on cases;
create policy cases_read on cases for select to anon, authenticated
  using (is_demo or owner_id = auth.uid());

drop policy if exists findings_read on raw_findings;
create policy findings_read on raw_findings for select to anon, authenticated
  using (can_read_case(case_id));

drop policy if exists corr_read on correlations;
create policy corr_read on correlations for select to anon, authenticated
  using (can_read_case(case_id));

drop policy if exists jobs_read on jobs;
create policy jobs_read on jobs for select to anon, authenticated
  using (can_read_case(case_id));

drop policy if exists entities_read on entities;
create policy entities_read on entities for select to anon, authenticated
  using (can_read_case(case_id));

drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select to anon, authenticated
  using (case_id is not null and can_read_case(case_id));

-- ---------------------------------------------------------------- realtime
do $$
declare t text;
begin
  foreach t in array array['cases', 'raw_findings', 'correlations', 'jobs', 'entities'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
             when undefined_object then null;  -- publication missing (plain Postgres)
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------- storage (avatars / uploaded images)
do $$
begin
  insert into storage.buckets (id, name, public) values ('media', 'media', true)
  on conflict (id) do nothing;
exception when undefined_table or invalid_schema_name then null;  -- plain Postgres
end $$;

-- ---------------------------------------------------------------- backend role
-- The gateway and workers use the service key; make sure it can call the queue functions.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_job(text, text, int) to service_role;
    grant execute on function hit_rate_limit(text, int, int) to service_role;
  end if;
end $$;
