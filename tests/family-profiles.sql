\set ON_ERROR_STOP on
insert into auth.users(id,phone) values
('00000000-0000-0000-0000-000000000011','+84000000011'),
('00000000-0000-0000-0000-000000000012','+84000000012'),
('00000000-0000-0000-0000-000000000013','+84000000013');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
select public.open_ledger();
select * from public.account_set_display_name(0,'  Mẹ  ');
select public.family_create('Nhà thử') as family_id \gset
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',false);
select public.open_ledger();
select * from public.account_set_display_name(0,'Bố');
select public.family_request_join(:'token');
do $$ begin
 if jsonb_array_length(public.family_status()->'members') <> 0 then raise exception 'pending sees member profiles'; end if;
 if (select count(*) from public.account_set_display_name(0,'Stale')) <> 0 then raise exception 'stale update succeeded'; end if;
 if (select data->>'displayName' from public.open_ledger()) <> 'Bố' then raise exception 'stale update changed profile'; end if;
 begin perform public.account_set_display_name(1,E'bad\nname'); raise exception 'bad name accepted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
update public.ledgers set data=jsonb_set(data,'{avatar}','"data:image/webp;base64,YQ=="') where owner_id='00000000-0000-0000-0000-000000000012';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000013',false);
do $$ begin if public.family_status() is not null then raise exception 'outsider sees family'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000011',false);
do $$ declare m jsonb; begin
 select value into m from jsonb_array_elements(public.family_status()->'members') where value->>'userId'='00000000-0000-0000-0000-000000000012';
 if m->>'displayName' <> 'Bố' or m->>'avatar' <> 'data:image/webp;base64,YQ==' or m ? 'phone' then raise exception 'pending profile incorrect'; end if;
end $$;
select public.family_respond_member('00000000-0000-0000-0000-000000000012',true);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000012',false);
do $$ declare m jsonb; begin
 select value into m from jsonb_array_elements(public.family_status()->'members') where value->>'userId'='00000000-0000-0000-0000-000000000011';
 if m->>'displayName' <> 'Mẹ' or m ? 'phone' then raise exception 'active profile incorrect'; end if;
 if (select data->>'displayName' from public.family_open_ledger()) <> 'Bố' then raise exception 'own family name missing'; end if;
 if (select data->>'avatar' from public.family_open_ledger()) <> 'data:image/webp;base64,YQ==' then raise exception 'own family avatar missing'; end if;
end $$;
reset role;
