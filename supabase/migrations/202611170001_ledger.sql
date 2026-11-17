-- Run in the SQL editor of a NEW Supabase project. Never put a service-role key in the browser.
create table public.ledgers (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 0,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  check (octet_length(data::text) <= 2000000),
  check (jsonb_typeof(data) = 'object')
);
alter table public.ledgers enable row level security;
revoke all on public.ledgers from anon, authenticated;

-- All reads/writes run through narrowly scoped functions; caller identity comes
-- from the verified Supabase access token, never a phone number supplied by UI.
create function public.open_ledger() returns table(version bigint, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  insert into public.ledgers(owner_id, data) values (owner,
    '{"entries":[],"wallets":[{"id":"cash","name":"Tiền mặt","balance":0}],"budgets":{},"rules":[],"categories":{"expense":["Ăn uống","Mua sắm","Đi lại","Nhà cửa","Sức khỏe","Giải trí","Khác"],"income":["Lương","Thu nhập khác","Khác"]}}'::jsonb)
  on conflict (owner_id) do nothing;
  return query select l.version, l.data from public.ledgers l where l.owner_id = owner;
end $$;
revoke all on function public.open_ledger() from public, anon;
grant execute on function public.open_ledger() to authenticated;

create function public.save_ledger(expected_version bigint, new_data jsonb)
returns table(version bigint, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare owner uuid := auth.uid();
begin
  if owner is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(new_data) <> 'object'
     or jsonb_typeof(new_data->'entries') is distinct from 'array'
     or jsonb_typeof(new_data->'wallets') is distinct from 'array'
     or jsonb_typeof(new_data->'rules') is distinct from 'array'
     or jsonb_typeof(new_data->'categories') is distinct from 'object'
     or jsonb_typeof(new_data->'budgets') is distinct from 'object'
     or octet_length(new_data::text) > 2000000 then
    raise exception 'Invalid ledger' using errcode = '22023';
  end if;
  return query update public.ledgers l set data = new_data, version = l.version + 1, updated_at = now()
    where l.owner_id = owner and l.version = expected_version returning l.version, l.data;
end $$;
revoke all on function public.save_ledger(bigint,jsonb) from public, anon;
grant execute on function public.save_ledger(bigint,jsonb) to authenticated;

-- The job processes each ledger under a row lock. An occurrence's unique
-- origin plus advancing next within the same transaction makes retries safe.
create function public.run_recurring_ledgers() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ledger record; r jsonb; new_rules jsonb; doc jsonb; due date; target date;
  month_start date; month_end date; anchor_day int; origin text; processed int := 0; ledger_processed int;
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
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
    processed := processed + ledger_processed;
    exception when others then
      raise warning 'Recurring processing failed for one ledger: %', sqlstate;
    end;
  end loop;
  return processed;
end $$;
revoke all on function public.run_recurring_ledgers() from public, anon, authenticated;
