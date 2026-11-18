\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ begin
  begin perform public.family_remove_member('00000000-0000-0000-0000-000000000002'); raise exception 'removed member with wallet'; exception when check_violation then null; end;
end $$;
reset role;
-- Simulate the member transferring their wallet to the owner before removal.
update family_private.wallets set owner_id='00000000-0000-0000-0000-000000000001' where owner_id='00000000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.family_remove_member('00000000-0000-0000-0000-000000000002');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
  begin perform public.family_open_ledger(); raise exception 'removed member retained access'; exception when insufficient_privilege then null; end;
end $$;
reset role;
