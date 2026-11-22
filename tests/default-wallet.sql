\set ON_ERROR_STOP on
begin;
insert into auth.users(id,phone) values ('00000000-0000-0000-0000-000000000301','+84000000301'),('00000000-0000-0000-0000-000000000302','+84000000302');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',true);
select public.open_ledger();
select public.family_create('Default test');
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000302',true);
select public.open_ledger();
select public.family_request_join(:'token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',true);
select public.family_respond_member('00000000-0000-0000-0000-000000000302',true);
do $$ declare v text; d jsonb; begin
 select version,data into v,d from public.personal_combined_open();
 d:=jsonb_set(d,'{wallets}',d->'wallets'||'[{"id":"private-wallet","name":"Private","balance":0},{"id":"shared-wallet","name":"Shared","balance":0},{"id":"archived","name":"Archived","balance":0,"archived":true}]'::jsonb);
 perform public.personal_combined_save_v2(v,d);
 perform public.account_default_wallet_set('private-wallet');
 if public.account_default_wallet_get()<>'private-wallet' then raise exception 'preference not saved'; end if;
 begin perform public.account_default_wallet_set('archived'); raise exception 'archived accepted'; exception when insufficient_privilege then null; end;
 begin perform public.account_default_wallet_set('unknown'); raise exception 'unknown accepted'; exception when insufficient_privilege then null; end;
end $$;
-- Moving a wallet changes its identifier, but the owner's preference follows it.
do $$ declare pv bigint; fv bigint; new_id text; begin
 select version into pv from public.open_ledger(); select version into fv from public.family_open_ledger();
 perform public.family_transfer_wallets_v2(pv,fv,'[{"walletId":"private-wallet","ownerId":"00000000-0000-0000-0000-000000000301","visibility":"private"},{"walletId":"shared-wallet","ownerId":"00000000-0000-0000-0000-000000000301","visibility":"shared"}]');
 select value->>'id' into new_id from public.personal_combined_open() o cross join lateral jsonb_array_elements(o.data->'wallets') where value->>'name'='Private';
 if public.account_default_wallet_get()<>new_id then raise exception 'preference did not follow wallet'; end if;
 perform set_config('test.private_wallet_id',new_id,true);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000302',true);
do $$ declare d jsonb; shared_id text; begin
 if public.account_default_wallet_get() is not null then raise exception 'other account preference leaked'; end if;
 select data into d from public.family_open_ledger();
 select value->>'id' into shared_id from jsonb_array_elements(d->'wallets') where value->>'name'='Shared';
 perform public.account_default_wallet_set(shared_id);
 if public.account_default_wallet_get()<>shared_id then raise exception 'shared wallet not selectable'; end if;
 begin perform public.account_default_wallet_set(current_setting('test.private_wallet_id')); raise exception 'another private wallet accepted'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',true);
do $$ begin if public.account_default_wallet_get()='cash' then raise exception 'accounts share preference'; end if; end $$;
reset role;
do $$ begin if has_function_privilege('anon','public.account_default_wallet_get()','execute') or has_function_privilege('anon','public.account_default_wallet_set(text)','execute') then raise exception 'anonymous access'; end if; end $$;
rollback;
