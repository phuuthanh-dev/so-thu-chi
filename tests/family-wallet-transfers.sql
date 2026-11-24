\set ON_ERROR_STOP on
begin;
insert into auth.users(id,phone) values
 ('00000000-0000-0000-0000-000000000601','+84000000601'),
 ('00000000-0000-0000-0000-000000000602','+84000000602'),
 ('00000000-0000-0000-0000-000000000603','+84000000603'),
 ('00000000-0000-0000-0000-000000000604','+84000000604');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000601',true);
select public.open_ledger();
select public.family_create('Family transfer test');
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000602',true);
select public.open_ledger();
select public.family_request_join(:'token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000601',true);
select public.family_respond_member('00000000-0000-0000-0000-000000000602',true);
do $$ declare v text; d jsonb; pv bigint; fv bigint; begin
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{wallets}',d->'wallets'||'[{"id":"common-a","name":"A shared VND","balance":5000,"currency":"VND"},{"id":"private-a","name":"A secret","balance":500,"currency":"VND"}]'::jsonb);
 perform public.personal_combined_save_v2(v,d);
 select version into pv from public.open_ledger();select version into fv from public.family_open_ledger();
 perform public.family_transfer_wallets_v2(pv,fv,'[{"walletId":"common-a","ownerId":"00000000-0000-0000-0000-000000000601","visibility":"shared"},{"walletId":"private-a","ownerId":"00000000-0000-0000-0000-000000000601","visibility":"private"}]');
 perform set_config('test.shared_a',(select value->>'ref' from jsonb_array_elements(public.wallet_transfer_state_v2()->'wallets') where value->>'name'='A shared VND'),true);
 perform set_config('test.private_a',(select value->>'ref' from jsonb_array_elements(public.wallet_transfer_state_v2()->'wallets') where value->>'name'='A secret'),true);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000602',true);
do $$ declare v text; d jsonb; pv bigint; fv bigint; s jsonb; begin
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{wallets}',d->'wallets'||'[{"id":"common-b","name":"B shared USD","balance":1200,"currency":"USD"}]'::jsonb);
 perform public.personal_combined_save_v2(v,d);
 select version into pv from public.open_ledger();select version into fv from public.family_open_ledger();
 perform public.family_transfer_wallets_v2(pv,fv,'[{"walletId":"common-b","ownerId":"00000000-0000-0000-0000-000000000602","visibility":"shared"}]');
 s:=public.wallet_transfer_state_v2();
 if not exists(select 1 from jsonb_array_elements(s->'wallets') where value->>'ref'=current_setting('test.shared_a')) then raise exception 'shared wallet missing';end if;
 if exists(select 1 from jsonb_array_elements(s->'wallets') where value->>'ref'=current_setting('test.private_a')) then raise exception 'private wallet leaked';end if;
 perform set_config('test.shared_b',(select value->>'ref' from jsonb_array_elements(s->'wallets') where value->>'name'='B shared USD'),true);
 perform set_config('test.entries_b',(select data->'entries' from public.personal_combined_open())::text,true);
 -- Legacy clients remain restricted to their own wallets.
 begin perform public.wallet_transfer_create_v2('aaaa0000-0000-0000-0000-000000000001','p:cash',current_setting('test.shared_a'),100,100);raise exception 'legacy restriction bypassed';exception when insufficient_privilege then null;end;
 begin perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000002','p:cash',current_setting('test.private_a'),100,100);raise exception 'private wallet accepted';exception when insufficient_privilege then null;end;
 perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000003','p:cash',current_setting('test.shared_a'),100,100);
 perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000003','p:cash',current_setting('test.shared_a'),100,100);
 perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000004',current_setting('test.shared_b'),current_setting('test.shared_a'),1000,250000);
 if (select data->'entries' from public.personal_combined_open())::text<>current_setting('test.entries_b') then raise exception 'transfer created income/expense';end if;
 s:=public.wallet_transfer_state_v2();
 if (select count(*) from jsonb_array_elements(s->'legs') where value->>'id'='aaaa0000-0000-0000-0000-000000000003')<>2 then raise exception 'duplicate or missing legs';end if;
 if not exists(select 1 from jsonb_array_elements(s->'legs') where value->>'ref'=current_setting('test.shared_b') and value->>'amount'='1000' and value->>'currency'='USD' and value->>'direction'='out') then raise exception 'USD leg incorrect';end if;
 if not exists(select 1 from jsonb_array_elements(s->'legs') where value->>'ref'=current_setting('test.shared_a') and value->>'amount'='250000' and value->>'currency'='VND' and value->>'direction'='in') then raise exception 'VND leg incorrect';end if;
 begin perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000003','p:cash',current_setting('test.shared_a'),101,101);raise exception 'conflicting retry accepted';exception when unique_violation then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000601',true);
do $$ declare s jsonb; d jsonb; begin
 s:=public.wallet_transfer_state_v2();
 if (select count(*) from jsonb_array_elements(s->'legs') where value->>'ref'=current_setting('test.shared_a') and value->>'direction'='in')<>2 then raise exception 'owner shared wallet balance missing';end if;
 if not exists(select 1 from jsonb_array_elements(s->'legs') where value->>'id'='aaaa0000-0000-0000-0000-000000000003' and value->>'otherName'='Ví khác') then raise exception 'private counterpart leaked';end if;
 select data into d from public.personal_combined_open();
 if not exists(select 1 from jsonb_array_elements(d->'wallets') where value->>'id'=substr(current_setting('test.shared_a'),3)) or exists(select 1 from jsonb_array_elements(d->'wallets') where value->>'id'=substr(current_setting('test.shared_b'),3)) then raise exception 'personal mode ownership mismatch';end if;
end $$;
select public.family_create_invite() as token2 \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000603',true);
select public.open_ledger();select public.family_request_join(:'token2');
do $$ begin
 if exists(select 1 from jsonb_array_elements(public.wallet_transfer_state_v2()->'wallets') where value->>'ref'=current_setting('test.shared_a')) then raise exception 'pending member saw shared wallet';end if;
 begin perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000005','p:cash',current_setting('test.shared_a'),1,1);raise exception 'pending member transferred';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000601',true);
select public.family_respond_member('00000000-0000-0000-0000-000000000603',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000603',true);
do $$ begin if not exists(select 1 from jsonb_array_elements(public.wallet_transfer_state_v2()->'wallets') where value->>'ref'=current_setting('test.shared_a')) then raise exception 'approved member missing shared wallet';end if;end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000601',true);
select public.family_remove_member('00000000-0000-0000-0000-000000000603');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000603',true);
do $$ begin
 if exists(select 1 from jsonb_array_elements(public.wallet_transfer_state_v2()->'wallets') where value->>'ref'=current_setting('test.shared_a')) then raise exception 'removed member saw shared wallet';end if;
 begin perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000006','p:cash',current_setting('test.shared_a'),1,1);raise exception 'removed member transferred';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000604',true);select public.open_ledger();
do $$ begin
 if jsonb_array_length(public.wallet_transfer_state_v2()->'legs')<>0 then raise exception 'outsider saw history';end if;
 begin perform public.wallet_transfer_create_v3('aaaa0000-0000-0000-0000-000000000007','p:cash',current_setting('test.shared_a'),1,1);raise exception 'outsider transferred';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin if has_function_privilege('anon','public.wallet_transfer_state_v2()','execute') or has_function_privilege('anon','public.wallet_transfer_create_v3(uuid,text,text,bigint,bigint)','execute') then raise exception 'anonymous access';end if;end $$;
rollback;
