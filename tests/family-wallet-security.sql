\set ON_ERROR_STOP on
-- All fixture users and values in this file are synthetic.
update public.ledgers set data='{"wallets":[{"id":"private-a","name":"Vợ riêng","balance":10},{"id":"shared","name":"Chung","balance":20},{"id":"private-b","name":"Chồng riêng","balance":30}],"entries":[{"id":"a","wallet":"private-a","type":"expense","category":"A","amount":5,"date":"2026-01-01","note":"SECRET_A"},{"id":"s","wallet":"shared","type":"income","category":"S","amount":50,"date":"2026-01-01","note":"SHARED"},{"id":"b","wallet":"private-b","type":"expense","category":"B","amount":7,"date":"2026-01-01","note":"SECRET_B"}],"rules":[],"categories":{"expense":["A"],"income":["S"]},"budgets":{}}'::jsonb, version=0 where owner_id='00000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.family_transfer_wallets(0,(select version from public.family_open_ledger()), '[{"walletId":"private-a","ownerId":"00000000-0000-0000-0000-000000000001","visibility":"private"},{"walletId":"shared","ownerId":"00000000-0000-0000-0000-000000000001","visibility":"shared"},{"walletId":"private-b","ownerId":"00000000-0000-0000-0000-000000000002","visibility":"private"}]');
do $$ declare doc jsonb; begin
  select data into doc from public.open_ledger();
  if jsonb_array_length(doc->'wallets')<>0 or jsonb_array_length(doc->'entries')<>0 then raise exception 'personal transfer incomplete'; end if;
  select data into doc from public.family_open_ledger();
  if jsonb_array_length(doc->'wallets')<>2 or doc::text like '%SECRET_B%' or doc::text not like '%SECRET_A%' then raise exception 'owner privacy failure'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare doc jsonb; v bigint; shared_id text; result jsonb; begin
  select version,data into v,doc from public.family_open_ledger();
  if jsonb_array_length(doc->'wallets')<>2 or doc::text like '%SECRET_A%' or doc::text not like '%SECRET_B%' then raise exception 'member privacy failure'; end if;
  select value->>'id' into shared_id from jsonb_array_elements(doc->'wallets') where value->>'name'='Chung';
  doc:=jsonb_set(doc,'{entries}',doc->'entries' || jsonb_build_array(jsonb_build_object('id','new','wallet',shared_id,'type','expense','category','S','amount',4,'date','2026-01-02','note','member expense','createdBy','fake')));
  select data into result from public.family_save_ledger(v,doc);
  if not exists(select 1 from jsonb_array_elements(result->'entries') where value->>'id'='new' and value->>'createdBy'='00000000-0000-0000-0000-000000000002') then raise exception 'creator attribution failed'; end if;
  if exists(select 1 from public.family_save_ledger(v,doc)) then raise exception 'stale write accepted'; end if;
end $$;
do $$ declare doc jsonb; v bigint; w jsonb; begin
  select version,data into v,doc from public.family_open_ledger();
  select value into w from jsonb_array_elements(doc->'wallets') where value->>'name'='Chung';
  doc:=jsonb_set(doc,'{wallets}',(select jsonb_agg(case when value->>'name'='Chung' then jsonb_set(value,'{visibility}','"private"') else value end) from jsonb_array_elements(doc->'wallets')));
  begin perform public.family_save_ledger(v,doc); raise exception 'member changed other owner wallet'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
  begin perform public.family_open_ledger(); raise exception 'nonmember accessed family'; exception when insufficient_privilege then null; end;
  begin perform public.family_save_ledger(0,'{}'); raise exception 'nonmember wrote family'; exception when insufficient_privilege then null; end;
end $$;
reset role;
