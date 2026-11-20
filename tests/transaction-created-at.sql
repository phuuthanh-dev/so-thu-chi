\set ON_ERROR_STOP on
-- Synthetic accounts only. Existing transactions have no invented timestamps.
insert into auth.users(id,phone) values
('00000000-0000-0000-0000-000000000021','+84000000021'),
('00000000-0000-0000-0000-000000000022','+84000000022'),
('00000000-0000-0000-0000-000000000023','+84000000023');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',false);
select public.open_ledger();
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',false);
select public.open_ledger();
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000023',false);
select public.open_ledger();
reset role;
update public.ledgers set data=jsonb_set(data,'{entries}',
 '[{"id":"legacy","wallet":"cash","type":"expense","category":"Ăn uống","amount":10,"date":"2026-01-01","note":"old"}]')
where owner_id='00000000-0000-0000-0000-000000000021';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',false);
do $$ declare v text; doc jsonb; result jsonb; stamp text; begin
  select version,data into v,doc from public.personal_combined_open();
  doc:=jsonb_set(doc,'{entries}',doc->'entries'||jsonb_build_array(jsonb_build_object('id','new-personal','wallet','cash','type','expense','category','Ăn uống','amount',20,'date','2026-01-01','note','new','createdAt','1900-01-01T00:00:00.000Z')));
  select data into result from public.personal_combined_save(v,doc);
  select value->>'createdAt' into stamp from jsonb_array_elements(result->'entries') where value->>'id'='new-personal';
  if stamp is null or stamp='1900-01-01T00:00:00.000Z' or stamp !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$' then raise exception 'new personal stamp not server assigned: %',stamp; end if;
  if exists(select 1 from jsonb_array_elements(result->'entries') where value->>'id'='legacy' and value ? 'createdAt') then raise exception 'legacy time fabricated'; end if;
  if exists(select 1 from public.personal_combined_save(v,doc)) then raise exception 'stale personal write accepted'; end if;
  perform set_config('test.personal_stamp',stamp,false);
end $$;
do $$ declare v text; doc jsonb; result jsonb; begin
  select version,data into v,doc from public.personal_combined_open();
  doc:=jsonb_set(doc,'{entries}',(select jsonb_agg(case when value->>'id'='new-personal' then jsonb_set(value-'createdAt','{amount}','25') when value->>'id'='legacy' then value||'{"createdAt":"1900-01-01T00:00:00.000Z"}'::jsonb else value end order by ord) from jsonb_array_elements(doc->'entries') with ordinality e(value,ord)));
  select data into result from public.personal_combined_save(v,doc);
  if not exists(select 1 from jsonb_array_elements(result->'entries') where value->>'id'='new-personal' and value->>'createdAt'=current_setting('test.personal_stamp') and value->>'amount'='25') then raise exception 'edit lost original time'; end if;
  if exists(select 1 from jsonb_array_elements(result->'entries') where value->>'id'='legacy' and value ? 'createdAt') then raise exception 'legacy timestamp was forged'; end if;
end $$;
select public.family_create('Thử nghiệm') as family_id \gset
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',false);
select public.family_request_join(:'token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',false);
select public.family_respond_member('00000000-0000-0000-0000-000000000022',true);
select public.family_transfer_wallets((select version from public.open_ledger()),(select version from public.family_open_ledger()),'[{"walletId":"cash","ownerId":"00000000-0000-0000-0000-000000000021","visibility":"shared"}]');
do $$ declare doc jsonb; begin
  select data into doc from public.family_open_ledger();
  if not exists(select 1 from jsonb_array_elements(doc->'entries') where value->>'id'='new-personal' and value->>'createdAt'=current_setting('test.personal_stamp')) then raise exception 'transfer changed timestamp'; end if;
  if exists(select 1 from jsonb_array_elements(doc->'entries') where value->>'id'='legacy' and value ? 'createdAt') then raise exception 'transfer fabricated legacy timestamp'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',false);
do $$ declare v bigint; doc jsonb; result jsonb; wallet_id text; stamp text; begin
  select version,data into v,doc from public.family_open_ledger();
  select value->>'id' into wallet_id from jsonb_array_elements(doc->'wallets') limit 1;
  doc:=jsonb_set(doc,'{entries}',doc->'entries'||jsonb_build_array(jsonb_build_object('id','new-family','wallet',wallet_id,'type','expense','category','Ăn uống','amount',33,'date','2026-01-01','note','family','createdAt','1900-01-01T00:00:00.000Z')));
  select data into result from public.family_save_ledger(v,doc);
  select value->>'createdAt' into stamp from jsonb_array_elements(result->'entries') where value->>'id'='new-family';
  if stamp is null or stamp='1900-01-01T00:00:00.000Z' then raise exception 'family time not server assigned'; end if;
  perform set_config('test.family_stamp',stamp,false);
  if exists(select 1 from public.family_save_ledger(v,doc)) then raise exception 'stale family write accepted'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',false);
do $$ declare v text; doc jsonb; result jsonb; begin
  select version,data into v,doc from public.personal_combined_open();
  if not exists(select 1 from jsonb_array_elements(doc->'entries') where value->>'id'='new-family' and value->>'createdAt'=current_setting('test.family_stamp')) then raise exception 'family timestamp not visible in personal'; end if;
  doc:=jsonb_set(doc,'{entries}',(select jsonb_agg(case when value->>'id'='new-family' then jsonb_set(value-'createdAt','{amount}','44') else value end order by ord) from jsonb_array_elements(doc->'entries') with ordinality e(value,ord)));
  select data into result from public.personal_combined_save(v,doc);
  if not exists(select 1 from jsonb_array_elements(result->'entries') where value->>'id'='new-family' and value->>'createdAt'=current_setting('test.family_stamp') and value->>'amount'='44') then raise exception 'personal edit changed family time'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000022',false);
do $$ declare v bigint; doc jsonb; result jsonb; begin
  select version,data into v,doc from public.family_open_ledger();
  if not exists(select 1 from jsonb_array_elements(doc->'entries') where value->>'id'='new-family' and value->>'createdAt'=current_setting('test.family_stamp') and value->>'amount'='44') then raise exception 'personal to family sync lost timestamp'; end if;
  doc:=jsonb_set(doc,'{entries}',(select jsonb_agg(case when value->>'id'='new-family' then jsonb_set(value-'createdAt','{amount}','55') else value end order by ord) from jsonb_array_elements(doc->'entries') with ordinality e(value,ord)));
  select data into result from public.family_save_ledger(v,doc);
  if not exists(select 1 from jsonb_array_elements(result->'entries') where value->>'id'='new-family' and value->>'createdAt'=current_setting('test.family_stamp') and value->>'amount'='55') then raise exception 'family edit changed timestamp'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000021',false);
do $$ declare doc jsonb; begin
  select data into doc from public.personal_combined_open();
  if not exists(select 1 from jsonb_array_elements(doc->'entries') where value->>'id'='new-family' and value->>'createdAt'=current_setting('test.family_stamp') and value->>'amount'='55') then raise exception 'family to personal sync lost timestamp'; end if;
end $$;
-- Moving an existing entry to another permitted family wallet preserves its stamp.
do $$ declare v bigint; doc jsonb; result jsonb; target text:='11111111-aaaa-4aaa-8aaa-111111111111'; begin
  select version,data into v,doc from public.family_open_ledger();
  doc:=jsonb_set(doc,'{wallets}',doc->'wallets'||jsonb_build_array(jsonb_build_object('id',target,'ownerId','00000000-0000-0000-0000-000000000021','visibility','shared','name','Ví thứ hai','balance',0)));
  select version,data into v,doc from public.family_save_ledger(v,doc);
  doc:=jsonb_set(doc,'{entries}',(select jsonb_agg(case when value->>'id'='new-family' then jsonb_set(value,'{wallet}',to_jsonb(target)) else value end order by ord) from jsonb_array_elements(doc->'entries') with ordinality e(value,ord)));
  select data into result from public.family_save_ledger(v,doc);
  if not exists(select 1 from jsonb_array_elements(result->'entries') where value->>'id'='new-family' and value->>'wallet'=target and value->>'createdAt'=current_setting('test.family_stamp')) then raise exception 'moving wallet changed creation time'; end if;
end $$;
-- A recurring occurrence in each storage space receives a real creation time.
do $$ declare v bigint; doc jsonb; wallet_id text; due text; begin
  select version,data into v,doc from public.family_open_ledger();
  select value->>'id' into wallet_id from jsonb_array_elements(doc->'wallets') limit 1;
  due:=(((now() at time zone 'Asia/Ho_Chi_Minh')-interval '7 hours')::date)::text;
  doc:=jsonb_set(doc,'{rules}',doc->'rules'||jsonb_build_array(jsonb_build_object('id','timestamp-family-rule','wallet',wallet_id,'type','expense','category','Ăn uống','amount',2,'note','recurring','next',due,'active',true)));
  perform public.family_save_ledger(v,doc);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000023',false);
do $$ declare v bigint; doc jsonb; due text; begin
  select version,data into v,doc from public.open_ledger();
  due:=(((now() at time zone 'Asia/Ho_Chi_Minh')-interval '7 hours')::date)::text;
  doc:=jsonb_set(doc,'{rules}',jsonb_build_array(jsonb_build_object('id','timestamp-personal-rule','wallet','cash','type','expense','category','Ăn uống','amount',2,'note','recurring','next',due,'active',true)));
  perform public.save_ledger(v,doc);
end $$;
reset role;
do $$ begin
  perform public.run_recurring_ledgers(); perform public.family_run_recurring();
  perform public.run_recurring_ledgers(); perform public.family_run_recurring();
  if (select count(*) from public.ledgers l cross join lateral jsonb_array_elements(l.data->'entries') e where l.owner_id='00000000-0000-0000-0000-000000000023' and e->>'origin' like 'timestamp-personal-rule:%' and e ? 'createdAt')<>1 then raise exception 'personal recurrence timestamp or idempotency failed'; end if;
  if (select count(*) from family_private.wallets w cross join lateral jsonb_array_elements(w.entries) e where e->>'origin' like 'timestamp-family-rule:%' and e ? 'createdAt')<>1 then raise exception 'family recurrence timestamp or idempotency failed'; end if;
  if has_function_privilege('anon','public.save_ledger(bigint,jsonb)','execute') or has_function_privilege('authenticated','public.family_run_recurring()','execute') or has_function_privilege('authenticated','family_private.stamp_personal_entries(jsonb,jsonb)','execute') then raise exception 'permissions changed'; end if;
end $$;
