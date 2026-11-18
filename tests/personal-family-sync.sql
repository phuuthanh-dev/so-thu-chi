\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare doc jsonb; v bigint; begin
  select version,data into v,doc from public.open_ledger();
  doc:=jsonb_set(doc,'{wallets}',doc->'wallets'||'[{"id":"cash","name":"Personal cash","balance":100}]'::jsonb);
  doc:=jsonb_set(doc,'{entries}',doc->'entries'||'[{"id":"personal-entry","wallet":"cash","type":"expense","category":"A","amount":10,"date":"2026-01-01","note":"PERSONAL"}]'::jsonb);
  perform public.save_ledger(v,doc);
end $$;
do $$ declare doc jsonb; v text; result jsonb; shared_id text; begin
  select version,data into v,doc from public.personal_combined_open();
  if jsonb_array_length(doc->'wallets')<>3 or doc::text like '%SECRET_B%' or doc::text not like '%SECRET_A%' or doc::text not like '%SHARED%' or doc::text not like '%PERSONAL%' then raise exception 'combined view incorrect: %',doc; end if;
  select value->>'id' into shared_id from jsonb_array_elements(doc->'wallets') where value->>'name'='Chung';
  doc:=jsonb_set(doc,'{entries}',(select jsonb_agg(case when value->>'id'='s' then jsonb_set(value,'{amount}','99') else value end order by ord) from jsonb_array_elements(doc->'entries') with ordinality x(value,ord)));
  doc:=jsonb_set(doc,'{wallets}',(select jsonb_agg(case when value->>'id'=shared_id then jsonb_set(value,'{name}','"Chung edited"') else value end order by ord) from jsonb_array_elements(doc->'wallets') with ordinality x(value,ord)));
  select data into result from public.personal_combined_save(v,doc);
  if result is null then raise exception 'combined save failed'; end if;
  if not exists(select 1 from public.family_open_ledger() l cross join lateral jsonb_array_elements(l.data->'entries') e where e->>'id'='s' and e->>'amount'='99') then raise exception 'personal -> family entry failed'; end if;
  if not exists(select 1 from public.family_open_ledger() l cross join lateral jsonb_array_elements(l.data->'wallets') w where w->>'name'='Chung edited') then raise exception 'personal -> family wallet failed'; end if;
  if exists(select 1 from public.personal_combined_save(v,doc)) then raise exception 'stale combined save accepted'; end if;
end $$;
do $$ declare doc jsonb; v bigint; begin
  select version,data into v,doc from public.family_open_ledger();
  doc:=jsonb_set(doc,'{entries}',(select jsonb_agg(case when value->>'id'='s' then jsonb_set(value,'{amount}','88') else value end order by ord) from jsonb_array_elements(doc->'entries') with ordinality x(value,ord)));
  perform public.family_save_ledger(v,doc);
  if not exists(select 1 from public.personal_combined_open() l cross join lateral jsonb_array_elements(l.data->'entries') e where e->>'id'='s' and e->>'amount'='88') then raise exception 'family -> personal entry failed'; end if;
end $$;
do $$ declare doc jsonb; v text; shared_id text; begin
  select version,data into v,doc from public.personal_combined_open();
  select value->>'id' into shared_id from jsonb_array_elements(doc->'wallets') where value->>'name'='Chung edited';
  doc:=jsonb_set(doc,'{entries}',(select jsonb_agg(case when value->>'id'='personal-entry' then jsonb_set(value,'{wallet}',to_jsonb(shared_id)) else value end order by ord) from jsonb_array_elements(doc->'entries') with ordinality x(value,ord)));
  begin perform public.personal_combined_save(v,doc); raise exception 'cross storage move accepted'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare doc jsonb; v text; begin
  select version,data into v,doc from public.personal_combined_open();
  if doc::text like '%SECRET_A%' or doc::text like '%SHARED%' or doc::text not like '%SECRET_B%' then raise exception 'personal privacy violated'; end if;
  if not exists(select 1 from public.family_open_ledger() l cross join lateral jsonb_array_elements(l.data->'entries') e where e->>'id'='s' and e->>'amount'='88') then raise exception 'shared change not visible to member'; end if;
  doc:=jsonb_set(doc,'{wallets}',doc->'wallets'||jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'ownerId','00000000-0000-0000-0000-000000000001','visibility','shared','name','forged','balance',0)));
  begin perform public.personal_combined_save(v,doc); raise exception 'forged family wallet accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
-- An error while writing the personal half rolls back the family half.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare doc jsonb; v text; before_name text; begin
 select version,data into v,doc from public.personal_combined_open();
 select value->>'name' into before_name from jsonb_array_elements(doc->'wallets') where value->>'visibility'='shared';
 doc:=jsonb_set(doc,'{wallets}',(select jsonb_agg(case when value->>'visibility'='shared' then jsonb_set(value,'{name}','"must rollback"') else value end order by ord) from jsonb_array_elements(doc->'wallets') with ordinality x(value,ord)));
 doc:=jsonb_set(doc,'{avatar}',to_jsonb(repeat('a',2100000)));
 begin perform public.personal_combined_save(v,doc); raise exception 'oversized personal write accepted'; exception when invalid_parameter_value then null; end;
 if not exists(select 1 from public.family_open_ledger() l cross join lateral jsonb_array_elements(l.data->'wallets') w where w->>'name'=before_name) then raise exception 'family changes survived personal failure'; end if;
end $$;
reset role;
-- Accounts without a family retain normal personal ledger behavior.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ declare doc jsonb; v text; saved jsonb; begin
 select version,data into v,doc from public.personal_combined_open();
 if v not like '%:none:0' then raise exception 'unexpected family for outsider'; end if;
 doc:=jsonb_set(doc,'{budgets,2026-11}','1000',true);
 select data into saved from public.personal_combined_save(v,doc);
 if saved->'budgets'->>'2026-11'<>'1000' then raise exception 'standalone save failed'; end if;
 if exists(select 1 from public.personal_combined_save(v,doc)) then raise exception 'standalone stale save accepted'; end if;
end $$;
reset role;
-- Reassignment changes personal visibility without duplicating the wallet.
begin;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare doc jsonb; v text; wallet_id text; begin
 select version,data into v,doc from public.personal_combined_open();
 select value->>'id' into wallet_id from jsonb_array_elements(doc->'wallets') where value->>'name'='Chung edited';
 doc:=jsonb_set(doc,'{wallets}',(select jsonb_agg(case when value->>'id'=wallet_id then value||'{"ownerId":"00000000-0000-0000-0000-000000000002","visibility":"private"}'::jsonb else value end order by ord) from jsonb_array_elements(doc->'wallets') with ordinality x(value,ord)));
 perform public.personal_combined_save(v,doc);
 if exists(select 1 from public.personal_combined_open() l cross join lateral jsonb_array_elements(l.data->'wallets') w where w->>'id'=wallet_id) then raise exception 'former owner still sees reassigned private wallet'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
 if not exists(select 1 from public.personal_combined_open() l cross join lateral jsonb_array_elements(l.data->'wallets') w where w->>'id'=wallet_id) then raise exception 'new owner does not see reassigned wallet'; end if;
end $$;
rollback;
