\set ON_ERROR_STOP on
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select * from public.open_ledger();
do $$ declare d jsonb; n int; begin
  select data into d from public.open_ledger();
  select count(*) into n from public.save_ledger(0, jsonb_set(d,'{budgets}', '{"2026-11":100}'::jsonb));
  if n <> 1 then raise exception 'initial write failed'; end if;
  select count(*) into n from public.save_ledger(0, d);
  if n <> 0 then raise exception 'stale write was not rejected'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare d jsonb; begin
  select data into d from public.open_ledger();
  if d->'budgets' <> '{}'::jsonb then raise exception 'cross-user data leak'; end if;
  begin perform * from public.ledgers; raise exception 'direct read was allowed';
  exception when insufficient_privilege then null; end;
  begin perform public.run_recurring_ledgers(); raise exception 'cron allowed to user';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.ledgers set data = jsonb_set(data,'{rules}',jsonb_build_array(jsonb_build_object(
  'id','rule1','type','expense','amount',100,'category','Ăn uống','note','test',
  'wallet','cash','next',((now() at time zone 'Asia/Ho_Chi_Minh')::date)::text,
  'anchorDay',extract(day from (now() at time zone 'Asia/Ho_Chi_Minh')::date)::int,'active',true)))
where owner_id='00000000-0000-0000-0000-000000000001';
do $$ declare n int; begin
  n := public.run_recurring_ledgers(); if n <> 1 then raise exception 'expected one occurrence, got %',n; end if;
  n := public.run_recurring_ledgers(); if n <> 0 then raise exception 'duplicate occurrence'; end if;
  if (select jsonb_array_length(data->'entries') from public.ledgers where owner_id='00000000-0000-0000-0000-000000000001') <> 1 then raise exception 'wrong occurrence count'; end if;
end $$;
-- A broken ledger must not prevent processing another owner. Test the 31st
-- through a leap-year February and ensure the schedule returns to March 31.
update public.ledgers set data = jsonb_set(data,'{rules}',jsonb_build_array(jsonb_build_object(
  'id','bad','active',true,'next','not-a-date')))
where owner_id='00000000-0000-0000-0000-000000000002';
update public.ledgers set data = jsonb_set(data,'{rules}',jsonb_build_array(jsonb_build_object(
  'id','month-end','type','expense','amount',100,'category','Ăn uống','note','month end',
  'wallet','cash','next','2024-02-29','anchorDay',31,'active',true)))
where owner_id='00000000-0000-0000-0000-000000000001';
do $$ declare n int; begin
  n := public.run_recurring_ledgers();
  if n < 2 then raise exception 'backfill did not run'; end if;
  if not exists(select 1 from public.ledgers l, jsonb_array_elements(l.data->'entries') e
    where l.owner_id='00000000-0000-0000-0000-000000000001' and e->>'origin'='month-end:2024-03-31')
    then raise exception 'month-end anchor drifted'; end if;
end $$;
select 'ledger tests passed' as result;
