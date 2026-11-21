\set ON_ERROR_STOP on
begin;
insert into auth.users(id,phone) values ('00000000-0000-0000-0000-000000000201','+84000000201'),('00000000-0000-0000-0000-000000000202','+84000000202'),('00000000-0000-0000-0000-000000000203','+84000000203');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',true);
select public.open_ledger();
select public.family_create('Test family');
select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',true);
select public.open_ledger();
select public.family_request_join(:'token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000201',true);
select public.family_respond_member('00000000-0000-0000-0000-000000000202',true);
do $$ declare d jsonb; v bigint; begin
 select version,data into v,d from public.open_ledger();
 d:=jsonb_set(d,'{avatar}','"data:image/webp;base64,YQ=="',true);
 perform public.save_ledger(v,d);
 if not public.account_migrate_avatar('data:image/webp;base64,YQ==','cloudinary:thu-chi/avatars/00000000-0000-0000-0000-000000000201/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp') then raise exception 'migration failed'; end if;
 if public.account_migrate_avatar('data:image/webp;base64,YQ==','cloudinary:thu-chi/avatars/00000000-0000-0000-0000-000000000201/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.webp') then raise exception 'stale avatar overwritten'; end if;
 begin perform public.account_migrate_avatar('data:image/webp;base64,YQ==','cloudinary:thu-chi/avatars/00000000-0000-0000-0000-000000000202/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.webp'); raise exception 'other owner marker accepted'; exception when invalid_parameter_value then null; end;
 if not public.account_avatar_upload_reserve() then raise exception 'first upload refused'; end if;
 if public.account_avatar_upload_reserve() then raise exception 'rate limit not applied'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',true);
do $$ begin if (public.family_status()->'members')::text not like '%cloudinary:thu-chi/avatars/00000000-0000-0000-0000-000000000201/%' then raise exception 'family profile marker missing'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000203',true);
do $$ begin if public.family_status() is not null then raise exception 'outsider saw profile'; end if; end $$;
reset role;
do $$ begin if has_function_privilege('anon','public.account_avatar_upload_reserve()','execute') then raise exception 'anon upload granted'; end if; end $$;
rollback;
