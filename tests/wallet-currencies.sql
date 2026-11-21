\set ON_ERROR_STOP on
begin;
insert into auth.users(id,phone) values ('00000000-0000-0000-0000-000000000201','+84000000201'),('00000000-0000-0000-0000-000000000202','+84000000202');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',true);
select public.open_ledger();
select public.family_create('USD test');
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',true);
select public.open_ledger();
select public.family_request_join(:'token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',true);
select public.family_respond_member('00000000-0000-0000-0000-000000000202',true);
do $$ declare v text; d jsonb; begin
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{wallets}',d->'wallets'||'[{"id":"paypal","name":"PayPal","balance":12345,"currency":"USD"},{"id":"usd2","name":"USD 2","balance":0,"currency":"USD"}]'::jsonb);
 perform public.personal_combined_save_v2(v,d);
 -- Each RPC is normally a separate request transaction. Reset the version marker here.
 perform set_config('nha.currency_aware','1',true);
 -- Old clients cannot lose/change currency or edit its transactions.
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{wallets}',(select jsonb_agg(case when value->>'id'='paypal' then value-'currency' else value end) from jsonb_array_elements(d->'wallets')));
 begin perform public.personal_combined_save(v,d); raise exception 'currency changed'; exception when invalid_parameter_value then null; end;
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{entries}',d->'entries'||'[{"id":"usd-entry","type":"expense","amount":29,"wallet":"paypal","category":"Ăn uống","date":"2026-01-01","note":""}]'::jsonb);
 begin perform public.personal_combined_save(v,d); raise exception 'old client changed USD'; exception when feature_not_supported then null; end;
 perform public.personal_combined_save_v2(v,d);
end $$;
do $$ declare before_entries jsonb; s jsonb; begin
 select data->'entries' into before_entries from public.personal_combined_open();
 perform public.wallet_transfer_create_v2('bbbbbbbb-0000-0000-0000-000000000001','p:cash','p:paypal',250000,1000);
 perform public.wallet_transfer_create_v2('bbbbbbbb-0000-0000-0000-000000000001','p:cash','p:paypal',250000,1000);
 s:=public.wallet_transfer_state();
 if jsonb_array_length(s->'legs')<>2 or not exists(select 1 from jsonb_array_elements(s->'legs') where value->>'ref'='p:cash' and value->>'amount'='250000' and value->>'currency'='VND') or not exists(select 1 from jsonb_array_elements(s->'legs') where value->>'ref'='p:paypal' and value->>'amount'='1000' and value->>'currency'='USD') then raise exception 'cross currency movement invalid'; end if;
 if (select data->'entries' from public.personal_combined_open())<>before_entries then raise exception 'transfer affected income or expenses'; end if;
 begin perform public.wallet_transfer_create_v2('bbbbbbbb-0000-0000-0000-000000000002','p:paypal','p:usd2',29,30); raise exception 'same currency accepted unequal amounts'; exception when invalid_parameter_value then null; end;
 begin perform public.wallet_transfer_create('bbbbbbbb-0000-0000-0000-000000000003','p:cash','p:paypal',1); raise exception 'old client transferred USD'; exception when invalid_parameter_value then null; end;
 begin perform public.wallet_transfer_create_v2('bbbbbbbb-0000-0000-0000-000000000001','p:cash','p:paypal',250000,1001); raise exception 'conflicting retry accepted'; exception when unique_violation then null; end;
end $$;
-- Automatic recurring entries retain the exact USD cents and run only once.
do $$ declare v text; d jsonb; due text; begin
 select version,data into v,d from public.personal_combined_open();
 due:=(((now() at time zone 'Asia/Ho_Chi_Minh')-interval '7 hours')::date)::text;
 d:=jsonb_set(d,'{rules}',d->'rules'||jsonb_build_array(jsonb_build_object('id','usd-rule','wallet','paypal','type','expense','category','Ăn uống','amount',29,'note','usd recurring','next',due,'active',true)));
 perform public.personal_combined_save_v2(v,d);
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true);
select public.run_recurring_ledgers();
select public.run_recurring_ledgers();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',true);
do $$ declare d jsonb; begin
 select data into d from public.personal_combined_open();
 if (select count(*) from jsonb_array_elements(d->'entries') where value->>'note'='usd recurring' and value->>'amount'='29')<>1 then raise exception 'USD recurring incorrect or duplicated'; end if;
end $$;
-- Move the USD wallet to family and verify the same history and balance leg survive.
do $$ declare pv bigint; fv bigint; s jsonb; moved text; v text; d jsonb; begin
 select version into pv from public.open_ledger(); select version into fv from public.family_open_ledger();
 perform public.family_transfer_wallets_v2(pv,fv,'[{"walletId":"paypal","ownerId":"00000000-0000-0000-0000-000000000201","visibility":"shared"}]');
 s:=public.wallet_transfer_state(); select value->>'ref' into moved from jsonb_array_elements(s->'wallets') where value->>'name'='PayPal';
 if not exists(select 1 from jsonb_array_elements(s->'legs') where value->>'ref'=moved and value->>'amount'='1000' and value->>'currency'='USD') then raise exception 'USD history lost'; end if;
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{entries}',d->'entries'||jsonb_build_array(jsonb_build_object('id','usd-entry-2','type','expense','amount',10,'wallet',substr(moved,3),'category','Ăn uống','date','2026-01-02','note','')));
 perform set_config('nha.currency_aware','1',true);
 begin perform public.personal_combined_save(v,d); raise exception 'old client edited family USD'; exception when feature_not_supported then null; end;
 perform public.personal_combined_save_v2(v,d);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',true);
do $$ declare s jsonb; shared text; begin
 s:=public.wallet_transfer_state();
 if exists(select 1 from jsonb_array_elements(s->'wallets') where value->>'name'='PayPal') then raise exception 'other owner USD wallet offered'; end if;
 select value->>'ref' into shared from jsonb_array_elements(s->'legs') where value->>'currency'='USD';
 if shared is null then raise exception 'shared legacy movement not visible'; end if;
 begin perform public.wallet_transfer_create_v2('bbbbbbbb-0000-0000-0000-000000000004',shared,'p:cash',10,100); raise exception 'other owner USD transfer accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin if has_function_privilege('anon','public.wallet_transfer_create_v2(uuid,text,text,bigint,bigint)','execute') or has_function_privilege('anon','public.personal_combined_save_v2(text,jsonb)','execute') then raise exception 'permission widened'; end if; end $$;
rollback;
