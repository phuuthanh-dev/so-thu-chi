-- Backward-compatible: retains all existing ledgers and recurring rules.
-- A per-owner error marker makes partial scheduler failures visible without
-- aborting successful work for other owners.
create table if not exists public.recurring_job_errors (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  error_code text not null,
  failed_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.recurring_job_errors enable row level security;
revoke all on public.recurring_job_errors from public, anon, authenticated;

create or replace function public.recurring_status()
returns table(failed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return query select e.failed_at from public.recurring_job_errors e
    where e.owner_id = owner and e.resolved_at is null;
end $$;
revoke all on function public.recurring_status() from public, anon;
grant execute on function public.recurring_status() to authenticated;

create or replace function public.run_recurring_ledgers() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ledger record; r jsonb; new_rules jsonb; doc jsonb; due date; target date;
  month_start date; month_end date; anchor_day int; origin text; processed int := 0; ledger_processed int;
  -- Daily retries begin at 07:00 Vietnam time, consistent with the old schedule.
  today date := ((now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 hours')::date;
  iterations int;
begin
  for ledger in select * from public.ledgers order by owner_id for update skip locked loop
    begin
      ledger_processed := 0;
      doc := ledger.data; new_rules := '[]'::jsonb;
      for r in select value from jsonb_array_elements(doc->'rules') loop
        if coalesce((r->>'active')::boolean, false) then
          due := (r->>'next')::date;
          anchor_day := least(31, greatest(1, coalesce((r->>'anchorDay')::int, extract(day from due)::int)));
          iterations := 0;
          while due <= today and iterations < 120 loop
            origin := (r->>'id') || ':' || due::text;
            if not exists (select 1 from jsonb_array_elements(doc->'entries') e where e->>'origin' = origin) then
              doc := jsonb_set(doc, '{entries}', (doc->'entries') || jsonb_build_array(jsonb_build_object(
                'id', gen_random_uuid()::text, 'type', r->>'type', 'amount', r->'amount',
                'date', due::text, 'category', r->>'category', 'note', r->>'note',
                'wallet', r->>'wallet', 'origin', origin)));
              ledger_processed := ledger_processed + 1;
            end if;
            month_start := (date_trunc('month', due)::date + interval '1 month')::date;
            month_end := (month_start + interval '1 month - 1 day')::date;
            target := month_start + (least(anchor_day, extract(day from month_end)::int) - 1);
            due := target; iterations := iterations + 1;
          end loop;
          r := jsonb_set(jsonb_set(r, '{next}', to_jsonb(due::text)), '{anchorDay}', to_jsonb(anchor_day), true);
        end if;
        new_rules := new_rules || jsonb_build_array(r);
      end loop;
      doc := jsonb_set(doc, '{rules}', new_rules);
      if doc is distinct from ledger.data then
        update public.ledgers set data = doc, version = ledgers.version + 1, updated_at = now() where owner_id = ledger.owner_id;
      end if;
      update public.recurring_job_errors set resolved_at = now()
        where owner_id = ledger.owner_id and resolved_at is null;
      processed := processed + ledger_processed;
    exception when others then
      insert into public.recurring_job_errors(owner_id, error_code, failed_at, resolved_at)
        values (ledger.owner_id, sqlstate, now(), null)
        on conflict (owner_id) do update set error_code = excluded.error_code,
          failed_at = excluded.failed_at, resolved_at = null;
      raise warning 'Recurring processing failed for one ledger: %', sqlstate;
    end;
  end loop;
  return processed;
end $$;
revoke all on function public.run_recurring_ledgers() from public, anon, authenticated;

-- PostgreSQL's pg_cron upserts a named job. Verify the existing job before
-- applying this migration; run every 15 minutes to retry busy ledgers.
select cron.schedule('nha-minh-recurring', '*/15 * * * *', 'select public.run_recurring_ledgers();');
