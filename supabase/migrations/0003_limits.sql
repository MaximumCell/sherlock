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
