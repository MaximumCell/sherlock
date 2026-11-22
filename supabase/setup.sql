-- Sherlock: complete database setup for a NEW Supabase project.
-- Paste this whole file into the Supabase SQL editor and press Run. Safe to run again.
-- Generated from supabase/migrations/0000_v1_baseline.sql + 0001_v2.sql + 0002_admin.sql + 0003_limits.sql + 0004_uploads.sql; edit those, not this file.

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

-- Sherlock operator panel: visitor sessions, search log, app settings.
-- Safe to run on a database that already has 0001_v2.sql, and safe to re-run.
-- Run once in the Supabase SQL editor (or `supabase db push`).
--
-- What it does
--   * visitor_sessions : one row per Supabase session (anonymous or signed in) that used the gateway
--   * search_log       : one row per search attempt and target, including refusals
--   * app_settings     : operator switches (`scans_paused`)
--   * RLS              : enabled with NO policies, so only the service key (gateway) can read or
--                        write these tables. Browsers can never see them.
--
-- Privacy: no raw IP address is ever stored. `ip_hash` is the first 16 hex characters of
-- HMAC-SHA256(INTERNAL_SECRET, client IP), computed by the gateway. `country` only comes from
-- a trusted edge header (CF-IPCountry); no geo-IP lookup is made. Search rows are kept 90 days
-- (`purge_old_search_log`, called by the gateway at most once a day).


-- ---------------------------------------------------------------- visitor_sessions
create table if not exists visitor_sessions (
  user_id        uuid primary key,             -- auth.users id (anonymous sessions included)
  is_anonymous   boolean not null default true,
  email          text,                         -- verified email of a signed-in account, else null
  first_seen     timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  ip_hash        text,                         -- HMAC of the client IP, never the IP itself
  country        text,                         -- ISO 3166 alpha-2 from the edge, if known
  user_agent     text,                         -- truncated to 300 characters by the gateway
  search_count   int  not null default 0,      -- accepted searches (kept by trg_search_log_counts)
  refused_count  int  not null default 0,      -- refused searches (any outcome but 'accepted')
  blocked        boolean not null default false,
  blocked_at     timestamptz,
  blocked_reason text
);
create index if not exists idx_visitor_sessions_last_seen on visitor_sessions (last_seen desc);
create index if not exists idx_visitor_sessions_ip_hash on visitor_sessions (ip_hash);

-- ---------------------------------------------------------------- search_log
-- case_id deliberately has NO foreign key: the log must survive case deletion. The gateway
-- sets it to null by hand when a case is deleted.
create table if not exists search_log (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  user_id      uuid not null,
  case_id      uuid,
  target_type  text not null,
  target_value text not null,
  modules      text[],
  outcome      text not null,
  detail       text,
  ip_hash      text,
  country      text,
  is_anonymous boolean not null default true
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'search_log_outcome_check') then
    alter table search_log add constraint search_log_outcome_check
      check (outcome in ('accepted', 'rate_limited', 'blocked', 'paused', 'forbidden', 'invalid'));
  end if;
end $$;

create index if not exists idx_search_log_created on search_log (created_at desc);
create index if not exists idx_search_log_user on search_log (user_id);
create index if not exists idx_search_log_target on search_log (target_value);
create index if not exists idx_search_log_case on search_log (case_id);

-- Keep the per-session counters in step with the log, whoever writes it.
create or replace function bump_visitor_counts() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update visitor_sessions
     set search_count  = search_count  + case when new.outcome = 'accepted' then 1 else 0 end,
         refused_count = refused_count + case when new.outcome = 'accepted' then 0 else 1 end
   where user_id = new.user_id;
  return new;
end $$;

drop trigger if exists trg_search_log_counts on search_log;
create trigger trg_search_log_counts after insert on search_log
  for each row execute function bump_visitor_counts();

-- Retention: delete search rows older than p_days. Returns how many were removed.
create or replace function purge_old_search_log(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  delete from search_log where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- app_settings
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into app_settings (key, value, updated_by) values ('scans_paused', 'false'::jsonb, 'setup')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- row level security
-- Enabled with no policies: anon and authenticated roles read and write nothing.
alter table visitor_sessions enable row level security;
alter table search_log       enable row level security;
alter table app_settings     enable row level security;

drop policy if exists visitor_sessions_read on visitor_sessions;
drop policy if exists search_log_read on search_log;
drop policy if exists app_settings_read on app_settings;

revoke all on table visitor_sessions from anon, authenticated;
revoke all on table search_log from anon, authenticated;
revoke all on table app_settings from anon, authenticated;
revoke all on function purge_old_search_log(int) from public, anon, authenticated;
revoke all on function bump_visitor_counts() from public, anon, authenticated;

-- ---------------------------------------------------------------- backend role
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table visitor_sessions, search_log, app_settings to service_role;
    grant usage, select on all sequences in schema public to service_role;
    grant execute on function purge_old_search_log(int) to service_role;
  end if;
end $$;

-- Sherlock search limits and parallel workers.
-- Safe to run on a database that already has 0001_v2.sql and 0002_admin.sql, and safe to re-run.
-- Run once in the Supabase SQL editor (or `supabase db push`) BEFORE deploying the code that uses it.
-- (The code tolerates this migration not having run yet: it falls back to the old claim_job and
-- logs the new refusal outcomes under 'rate_limited' until it has.)
--
-- What it does
--   * search_log : more refusal outcomes ('burst_limited', 'active_search', 'busy', 'sign_in_required')
--   * claim_job  : new optional parameter p_exclude_modules (modules this claim must skip, so a worker
--                  runs at most one memory-heavy module at a time), and fair ordering: the oldest job of
--                  the case with the FEWEST running jobs in the queue is claimed first (round-robin
--                  between searches, so one search's jobs cannot monopolise a worker)


-- ---------------------------------------------------------------- search_log outcomes
alter table search_log drop constraint if exists search_log_outcome_check;
alter table search_log add constraint search_log_outcome_check
  check (outcome in ('accepted', 'rate_limited', 'blocked', 'paused', 'forbidden', 'invalid',
                     'burst_limited', 'active_search', 'busy', 'sign_in_required'));

-- ---------------------------------------------------------------- claim_job
-- The 3-argument version must go: PostgREST cannot choose between two overloads that both
-- accept (p_queue, p_worker, p_stale_seconds). Old callers keep working against the new one
-- because p_exclude_modules has a default.
drop function if exists claim_job(text, text, int);

create or replace function claim_job(p_queue text, p_worker text, p_stale_seconds int default 120,
                                     p_exclude_modules text[] default '{}')
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
           with busy as (
             select r.case_id, count(*) as n
               from jobs r
              where r.queue = p_queue and r.status = 'running'
              group by r.case_id)
           select q.id
             from jobs q
             left join busy b on b.case_id = q.case_id
            where q.queue = p_queue and q.status = 'queued' and q.run_after <= now()
              and not (q.module = any(coalesce(p_exclude_modules, '{}'::text[])))
            order by coalesce(b.n, 0), q.created_at
            for update of q skip locked
            limit 1)
  returning j.*;
end $$;

revoke all on function claim_job(text, text, int, text[]) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function claim_job(text, text, int, text[]) to service_role;
  end if;
end $$;

-- Sherlock photo uploads for image searches: a private `media` bucket with per-user folders.
-- Safe to run on a database that already has 0001_v2.sql .. 0003_limits.sql, and safe to re-run.
-- Run once in the Supabase SQL editor (or `supabase db push`) BEFORE photo uploads can work.
-- (The code tolerates this migration not having run yet: the web app says "Photo upload is not
-- set up on this server yet" when Storage refuses the upload, and image search by URL keeps working.)
--
-- What it does
--   * bucket `media` : private (no public URLs), 8 MB per file, JPEG / PNG / WebP / GIF only
--   * policies on storage.objects for bucket `media`: a signed-in user may upload, read and delete
--     objects ONLY under `uploads/<their auth uid>/`. No update (uploads are never overwritten).
--     The gateway and workers use the service key, which bypasses these policies, to read a photo
--     for a search, sign a short-lived URL for search engines and delete it with its case.
--   * does nothing on plain Postgres (no `storage` schema).


-- ---------------------------------------------------------------- bucket and policies
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;  -- plain Postgres: no Supabase Storage
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('media', 'media', false, 8000000, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
  on conflict (id) do update
    set public = false,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists "media uploads: insert own" on storage.objects';
  execute 'drop policy if exists "media uploads: select own" on storage.objects';
  execute 'drop policy if exists "media uploads: delete own" on storage.objects';

  execute $p$
    create policy "media uploads: insert own" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'uploads'
        and (storage.foldername(name))[2] = (select auth.uid())::text
        and array_length(storage.foldername(name), 1) = 2
      )
  $p$;

  execute $p$
    create policy "media uploads: select own" on storage.objects
      for select to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'uploads'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
  $p$;

  execute $p$
    create policy "media uploads: delete own" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'media'
        and (storage.foldername(name))[1] = 'uploads'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
  $p$;
end $$;
