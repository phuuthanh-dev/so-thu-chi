\set ON_ERROR_STOP on
insert into auth.users(id, phone) values
('00000000-0000-0000-0000-000000000001','+84000000001'),
('00000000-0000-0000-0000-000000000002','+84000000002'),
('00000000-0000-0000-0000-000000000003','+84000000003');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.open_ledger();
select public.family_create('Gia đình thử') as family_id \gset
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select public.open_ledger();
select public.family_request_join(:'token');
do $$ begin
  if public.family_status()->>'status' <> 'pending' then raise exception 'expected pending'; end if;
  if jsonb_array_length(public.family_status()->'members') <> 0 then raise exception 'pending member sees members'; end if;
  begin perform public.family_create_invite(); raise exception 'member issued invite'; exception when insufficient_privilege then null; end;
  begin perform public.family_respond_member('00000000-0000-0000-0000-000000000002',true); raise exception 'member approved'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',false);
do $$ begin
  if public.family_status() is not null then raise exception 'nonmember saw family'; end if;
  begin perform public.family_create_invite(); raise exception 'nonmember issued invite'; exception when insufficient_privilege then null; end;
end $$;
select set_config('test.invitation', :'token', false);
do $$ begin
  begin perform public.family_request_join(current_setting('test.invitation')); raise exception 'reused invitation accepted'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select public.family_respond_member('00000000-0000-0000-0000-000000000002',true);
do $$ begin
  if jsonb_array_length(public.family_status()->'members') <> 2 then raise exception 'owner member count'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
  if public.family_status()->>'status' <> 'active' then raise exception 'not active'; end if;
  if jsonb_array_length(public.family_status()->'members') <> 2 then raise exception 'member count'; end if;
  begin perform * from family_private.households; raise exception 'direct access granted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
