\set ON_ERROR_STOP on
begin;
insert into auth.users(id,phone) values ('00000000-0000-0000-0000-000000000401','+84000000401'),('00000000-0000-0000-0000-000000000402','+84000000402'),('00000000-0000-0000-0000-000000000403','+84000000403'),('00000000-0000-0000-0000-000000000404','+84000000404');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
select public.open_ledger(); select public.family_create('Kỷ niệm'); select public.family_create_invite() as token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
select public.open_ledger(); select public.family_request_join(:'token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
select public.family_respond_member('00000000-0000-0000-0000-000000000402',true); select public.family_create_invite() as pending_token \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
select public.open_ledger(); select public.family_request_join(:'pending_token');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
do $$ declare rev integer; before_ledger jsonb; after_ledger jsonb; begin
 select data into before_ledger from public.open_ledger();
 rev:=public.journal_save('aaaaaaaa-0000-0000-0000-000000000401',0,'Bí mật','riêng tư','2026-11-22','private');
 if rev<>1 or public.journal_save('aaaaaaaa-0000-0000-0000-000000000401',0,'Bí mật','riêng tư','2026-11-22','private')<>1 then raise exception 'creation retry failed'; end if;
 perform public.journal_save('aaaaaaaa-0000-0000-0000-000000000402',0,'Chung','cho gia đình','2026-11-22','family');
 perform public.journal_photo_reserve('aaaaaaaa-0000-0000-0000-000000000401','bbbbbbbb-0000-0000-0000-000000000401','webp');
 perform public.journal_photo_finish('bbbbbbbb-0000-0000-0000-000000000401',true);
 if public.journal_photo_reserve('aaaaaaaa-0000-0000-0000-000000000402','bbbbbbbb-0000-0000-0000-000000000402','jpg')<>'reserved' then raise exception 'first reserve incorrect'; end if;
 if public.journal_photo_reserve('aaaaaaaa-0000-0000-0000-000000000402','bbbbbbbb-0000-0000-0000-000000000402','jpg')<>'pending' then raise exception 'duplicate reserve incorrect'; end if;
 perform public.journal_photo_finish('bbbbbbbb-0000-0000-0000-000000000402',true);
 if jsonb_array_length(public.journal_list())<>2 then raise exception 'owner cannot see entries'; end if;
 select data into after_ledger from public.open_ledger(); if before_ledger<>after_ledger then raise exception 'finance ledger changed'; end if;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',true);
do $$ begin
 if jsonb_array_length(public.journal_list())<>0 or public.journal_photo_access('bbbbbbbb-0000-0000-0000-000000000402') is not null then raise exception 'pending member sees family content'; end if;
 begin perform public.journal_save('aaaaaaaa-0000-0000-0000-000000000403',0,'x','','2026-11-22','family'); raise exception 'pending member shared'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',true);
select public.open_ledger();
do $$ begin if jsonb_array_length(public.journal_list())<>0 or public.journal_photo_access('bbbbbbbb-0000-0000-0000-000000000402') is not null then raise exception 'outsider sees content'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
do $$ begin
 if jsonb_array_length(public.journal_list())<>1 or public.journal_photo_access('bbbbbbbb-0000-0000-0000-000000000401') is not null or public.journal_photo_access('bbbbbbbb-0000-0000-0000-000000000402') is null then raise exception 'shared/private access invalid'; end if;
 begin perform public.journal_save('aaaaaaaa-0000-0000-0000-000000000402',1,'Hacked','','2026-11-22','family'); raise exception 'other member changed entry'; exception when insufficient_privilege then null; end;
 begin perform public.journal_photo_reserve('aaaaaaaa-0000-0000-0000-000000000402','bbbbbbbb-0000-0000-0000-000000000403','jpg'); raise exception 'other member added photo'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
do $$ begin
 perform public.journal_save('aaaaaaaa-0000-0000-0000-000000000402',1,'Chung','cho gia đình','2026-11-22','private');
 if public.journal_save('aaaaaaaa-0000-0000-0000-000000000402',1,'Chung','cho gia đình','2026-11-22','private')<>2 then raise exception 'update retry failed'; end if;
 begin perform public.journal_save('aaaaaaaa-0000-0000-0000-000000000402',1,'Stale','','2026-11-22','private'); raise exception 'stale update accepted'; exception when serialization_failure then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
do $$ begin if jsonb_array_length(public.journal_list())<>0 or public.journal_photo_access('bbbbbbbb-0000-0000-0000-000000000402') is not null then raise exception 'visibility change did not revoke access'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
do $$ begin
 perform public.journal_save('aaaaaaaa-0000-0000-0000-000000000402',2,'Chung','cho gia đình','2026-11-22','family');
 perform public.family_remove_member('00000000-0000-0000-0000-000000000402');
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',true);
do $$ begin if jsonb_array_length(public.journal_list())<>0 or public.journal_photo_access('bbbbbbbb-0000-0000-0000-000000000402') is not null then raise exception 'removed member retained access'; end if; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',true);
do $$ begin
 perform public.journal_delete('aaaaaaaa-0000-0000-0000-000000000402',3);
 if public.journal_photo_access('bbbbbbbb-0000-0000-0000-000000000402') is not null then raise exception 'deleted photo still accessible'; end if;
 if jsonb_array_length(public.journal_cleanup_list())<>1 then raise exception 'cleanup not queued'; end if;
end $$;
reset role;
do $$ begin if exists(select 1 from family_private.journal_entries where id='aaaaaaaa-0000-0000-0000-000000000402' and (title<>'' or body<>'' or household_id is not null)) then raise exception 'deleted memory retained content'; end if; end $$;
do $$ begin if has_function_privilege('anon','public.journal_list()','execute') or has_function_privilege('anon','public.journal_photo_access(uuid)','execute') or has_table_privilege('authenticated','family_private.journal_entries','select') then raise exception 'permission widened'; end if; end $$;
rollback;
