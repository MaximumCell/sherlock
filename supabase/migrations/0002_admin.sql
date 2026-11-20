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
