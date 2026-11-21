\set ON_ERROR_STOP on
begin;
insert into auth.users(id,phone) values ('00000000-0000-0000-0000-000000000101','+84000000101'),('00000000-0000-0000-0000-000000000102','+84000000102'),('00000000-0000-0000-0000-000000000103','+84000000103');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
select public.open_ledger();
select public.family_create('Test family');
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
select public.open_ledger();
select public.family_request_join(:'token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
select public.family_respond_member('00000000-0000-0000-0000-000000000102',true);
do $$ declare d jsonb; v bigint; begin
 select version,data into v,d from public.open_ledger();
 d:=jsonb_set(d,'{wallets}',d->'wallets'||'[{"id":"bank","name":"Bank private","balance":1000},{"id":"shared-source","name":"Shared wallet","balance":500}]'::jsonb);
 perform public.save_ledger(v,d);
 select version into v from public.open_ledger();
 perform public.family_transfer_wallets(v,(select version from public.family_open_ledger()), '[{"walletId":"shared-source","ownerId":"00000000-0000-0000-0000-000000000101","visibility":"shared"}]');
end $$;
do $$ declare s jsonb; shared text; before_entries jsonb; v text; d jsonb; begin
 s:=public.wallet_transfer_state();
 select value->>'ref' into shared from jsonb_array_elements(s->'wallets') where value->>'name'='Shared wallet';
 select version,data->'entries' into v,before_entries from public.personal_combined_open();
 perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000001','p:bank',shared,250);
 perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000001','p:bank',shared,250);
 s:=public.wallet_transfer_state();
 if jsonb_array_length(s->'legs')<>2 or (select sum(case when value->>'direction'='in' then (value->>'amount')::int else -(value->>'amount')::int end) from jsonb_array_elements(s->'legs'))<>0 then raise exception 'not atomic, or duplicate'; end if;
 if (select data->'entries' from public.personal_combined_open())<>before_entries then raise exception 'transfer changed income/expense'; end if;
 if exists(select 1 from public.personal_combined_save(v,(select data from public.personal_combined_open()))) then raise exception 'stale version accepted'; end if;
 begin perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000001','p:bank',shared,251); raise exception 'different retry accepted'; exception when unique_violation then null; end;
 begin perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000002','p:bank','p:bank',5); raise exception 'same wallet accepted'; exception when invalid_parameter_value then null; end;
 begin perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000002','p:bank',shared,-1); raise exception 'negative amount accepted'; exception when invalid_parameter_value then null; end;
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{wallets}',(select jsonb_agg(value) from jsonb_array_elements(d->'wallets') where value->>'id'<>'bank'));
 begin perform public.personal_combined_save(v,d); raise exception 'deleting transfer wallet accepted'; exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',true);
do $$ declare s jsonb; shared text; begin
 s:=public.wallet_transfer_state();
 if jsonb_array_length(s->'legs')<>1 or s::text like '%Bank private%' then raise exception 'personal wallet leaked to other member'; end if;
 if s->'legs'->0->>'otherName'<>'Ví khác' then raise exception 'hidden counterpart not redacted'; end if;
 select value->>'ref' into shared from jsonb_array_elements(s->'wallets') where value->>'name'='Shared wallet';
 perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000003',shared,'p:cash',100);
 begin perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000004','p:bank',shared,5); raise exception 'other personal wallet accessible'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',true);
select public.open_ledger();
do $$ begin if jsonb_array_length(public.wallet_transfer_state()->'legs')<>0 then raise exception 'outsider saw transfers'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',true);
-- Moving a personal wallet to family must retain transfer legs and totals.
do $$ declare v bigint; s jsonb; moved text; begin
 select version into v from public.open_ledger();
 perform public.family_transfer_wallets(v,(select version from public.family_open_ledger()), '[{"walletId":"bank","ownerId":"00000000-0000-0000-0000-000000000101","visibility":"private"}]');
 s:=public.wallet_transfer_state();
 select value->>'ref' into moved from jsonb_array_elements(s->'wallets') where value->>'name'='Bank private';
 if not exists(select 1 from jsonb_array_elements(s->'legs') where value->>'ref'=moved and (value->>'amount')::int=250 and value->>'direction'='out') then raise exception 'movement lost during wallet migration'; end if;
 perform public.wallet_transfer_create('aaaaaaaa-0000-0000-0000-000000000001','p:bank',(select value->>'ref' from jsonb_array_elements(s->'wallets') where value->>'name'='Shared wallet'),250);
 if jsonb_array_length(public.wallet_transfer_state()->'legs')<>3 then raise exception 'retry after migration duplicated transfer'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.wallet_transfer_create(uuid,text,text,bigint)','execute') or has_function_privilege('authenticated','family_private.transfer_visible(uuid,text,uuid)','execute') then raise exception 'permission widened'; end if;
end $$;
rollback;
