\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare r record; begin
 select * into r from public.category_appearance_update('personal','expense','A','food','rose',0);
 if r.revision<>1 or r.icon_key<>'food' or r.color_key<>'rose' then raise exception 'first save failed'; end if;
 begin perform public.category_appearance_update('personal','expense','A','gift','blue',0); raise exception 'stale insert accepted'; exception when serialization_failure then null; end;
 perform public.category_appearance_update('personal','income','S','gift','blue',0);
 if (select count(*) from public.category_appearances_get())<>2 then raise exception 'kind isolation failed'; end if;
 begin perform 1 from family_private.category_appearances; raise exception 'direct table access allowed'; exception when insufficient_privilege then null; end;
 begin perform public.category_appearance_set('expense','A','gift','blue',1); raise exception 'internal setter callable directly'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ begin
 if exists(select 1 from public.category_appearances_get()) then raise exception 'other user can read styles'; end if;
 perform public.category_appearance_update('personal','expense','Ăn uống','health','green',0);
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare doc jsonb; v text; out_doc jsonb; begin
 select version,data into v,doc from public.personal_combined_open();
 doc:=jsonb_set(doc,'{categories,expense}', '["A renamed"]'::jsonb);
 doc:=jsonb_set(doc,'{entries}',(select coalesce(jsonb_agg(case when value->>'category'='A' then jsonb_set(value,'{category}','"A renamed"') else value end),'[]') from jsonb_array_elements(doc->'entries')));
 select data into out_doc from public.category_rename_with_appearance('personal',v,doc,'expense','A','A renamed','food','rose',1,0);
 if out_doc->'categories'->'expense' <> '["A renamed"]'::jsonb then raise exception 'rename failed'; end if;
 if not exists(select 1 from public.category_appearances_get() where kind='expense' and category='A renamed' and icon_key='food' and color_key='rose' and revision=1) then raise exception 'style not carried'; end if;
 if not exists(select 1 from public.category_appearances_get() where kind='expense' and category='A' and icon_key='food') then raise exception 'historical style lost'; end if;
 begin perform public.category_appearance_update('personal','expense','A','food','blue',1); raise exception 'stale renamed category accepted'; exception when serialization_failure then null; end;
end $$;
do $$ declare doc jsonb; v text; begin
 select version,data into v,doc from public.personal_combined_open();
 doc:=jsonb_set(doc,'{categories,expense}', '["ROLLBACK"]'::jsonb);
 begin perform public.category_rename_with_appearance('personal',v,doc,'expense','A renamed','ROLLBACK','tag','blue',0,0); raise exception 'stale style accepted'; exception when serialization_failure then null; end;
 if exists(select 1 from public.personal_combined_open() p where p.data->'categories'->'expense'='["ROLLBACK"]'::jsonb) then raise exception 'ledger change not rolled back'; end if;
 if exists(select 1 from public.category_appearances_get() where category='ROLLBACK') then raise exception 'style change not rolled back'; end if;
end $$;
do $$ begin
 perform public.category_appearance_update('personal','expense','A renamed',null,null,1);
 if not exists(select 1 from public.category_appearances_get() where category='A renamed' and revision=2 and icon_key is null and color_key is null) then raise exception 'reset failed'; end if;
 begin perform public.category_appearance_update('personal','expense','A renamed','food','red',1); raise exception 'stale reset accepted'; exception when serialization_failure then null; end;
end $$;
reset role;
set role anon;
do $$ begin
 begin perform public.category_appearances_get(); raise exception 'anonymous access allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Family-mode rename uses the same per-account appearance store.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare doc jsonb; v bigint; out_doc jsonb; begin
 select version,data into v,doc from public.family_open_ledger();
 doc:=jsonb_set(doc,'{categories,expense}','["Family rename"]'::jsonb);
 doc:=jsonb_set(doc,'{entries}',(select coalesce(jsonb_agg(case when value->>'category'='A' then jsonb_set(value,'{category}','"Family rename"') else value end),'[]') from jsonb_array_elements(doc->'entries')));
 select data into out_doc from public.category_rename_with_appearance('family',v::text,doc,'expense','A','Family rename','food','green',1,0);
 if out_doc->'categories'->'expense' <> '["Family rename"]'::jsonb then raise exception 'family rename failed'; end if;
 if not exists(select 1 from public.category_appearances_get() where category='Family rename' and color_key='green') then raise exception 'family style missing'; end if;
 perform public.category_appearance_update('family','expense','Family rename','food','blue',1);
 if not exists(select 1 from public.category_appearances_get() where category='Family rename' and color_key='blue' and revision=2) then raise exception 'family appearance update failed'; end if;
 if exists(select 1 from public.category_rename_with_appearance('family',v::text,doc,'expense','A','FAILED','food','green',1,0)) then raise exception 'stale family ledger accepted'; end if;
 if exists(select 1 from public.category_appearances_get() where category='FAILED') then raise exception 'stale family created style'; end if;
end $$;
reset role;
-- A concurrent target appearance change rolls back the category rename too.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare doc jsonb; v bigint; begin
 select version,data into v,doc from public.family_open_ledger();
 doc:=jsonb_set(doc,'{categories,expense}','["A"]'::jsonb);
 begin perform public.category_rename_with_appearance('family',v::text,doc,'expense','Family rename','A','food','blue',2,0); raise exception 'stale target appearance accepted'; exception when serialization_failure then null; end;
 if exists(select 1 from public.family_open_ledger() f where f.data->'categories'->'expense'='["A"]'::jsonb) then raise exception 'family rename did not roll back'; end if;
end $$;
reset role;
