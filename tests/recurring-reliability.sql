\set ON_ERROR_STOP on
insert into auth.users values ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
select * from public.open_ledger();
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
select * from public.open_ledger();
reset role;
-- The first ledger is malformed; it must not prevent the other from processing.
update public.ledgers set data = jsonb_set(data,'{rules}', '[{"id":"bad","active":true,"next":"bad-date"}]')
where owner_id='10000000-0000-0000-0000-000000000001';
update public.ledgers set data = jsonb_set(data,'{rules}', jsonb_build_array(jsonb_build_object(
  'id','valid','type','expense','amount',100,'category','Ăn uống','note','test','wallet','cash',
  'next', (((now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 hours')::date)::text, 'active',true)))
where owner_id='10000000-0000-0000-0000-000000000002';
do $$ declare n int; begin
 n := public.run_recurring_ledgers();
 if n <> 1 then raise exception 'valid owner did not process'; end if;
 if not exists(select 1 from public.recurring_job_errors where owner_id='10000000-0000-0000-0000-000000000001' and resolved_at is null) then raise exception 'missing failure marker'; end if;
 if (select schedule from cron.jobs where jobname='nha-minh-recurring') <> '*/15 * * * *' then raise exception 'wrong retry schedule'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
do $$ begin
 if (select count(*) from public.recurring_status()) <> 1 then raise exception 'owner cannot see failure'; end if;
 begin perform * from public.recurring_job_errors; raise exception 'direct read allowed';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',false);
do $$ begin if (select count(*) from public.recurring_status()) <> 0 then raise exception 'other owner can see failure'; end if; end $$;
reset role;
update public.ledgers set data=jsonb_set(data,'{rules}', '[]') where owner_id='10000000-0000-0000-0000-000000000001';
do $$ begin
 perform public.run_recurring_ledgers();
 if exists(select 1 from public.recurring_job_errors where resolved_at is null) then raise exception 'error was not resolved'; end if;
 if (select jsonb_array_length(data->'entries') from public.ledgers where owner_id='10000000-0000-0000-0000-000000000002') <> 1 then raise exception 'duplicate occurrence'; end if;
end $$;
-- A ledger just under the 2 MB cap cannot fit the next generated entry.
insert into auth.users values ('10000000-0000-0000-0000-000000000003');
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
select * from public.open_ledger();
reset role;
update public.ledgers set data = jsonb_set(data,'{rules}',jsonb_build_array(jsonb_build_object(
  'id','full','type','expense','amount',100,'category','Ăn uống','note','test','wallet','cash',
  'next',(((now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 hours')::date)::text,'active',true)))
where owner_id='10000000-0000-0000-0000-000000000003';
update public.ledgers set data = data || jsonb_build_object('padding',repeat('x', 1999950 - octet_length(data::text) - 15))
where owner_id='10000000-0000-0000-0000-000000000003';
do $$ begin
 perform public.run_recurring_ledgers();
 if not exists(select 1 from public.recurring_job_errors where owner_id='10000000-0000-0000-0000-000000000003' and error_code='23514' and resolved_at is null) then raise exception 'full ledger failure not detected'; end if;
end $$;
update public.ledgers set data = data - 'padding' where owner_id='10000000-0000-0000-0000-000000000003';
do $$ begin
 perform public.run_recurring_ledgers();
 perform public.run_recurring_ledgers();
 if (select jsonb_array_length(data->'entries') from public.ledgers where owner_id='10000000-0000-0000-0000-000000000003') <> 1 then raise exception 'retry should create exactly one entry'; end if;
 if exists(select 1 from public.recurring_job_errors where owner_id='10000000-0000-0000-0000-000000000003' and resolved_at is null) then raise exception 'full ledger failure not resolved'; end if;
end $$;
select 'recurring reliability tests passed' as result;
