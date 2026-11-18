\set ON_ERROR_STOP on
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare doc jsonb; v bigint; target text; due text; begin
  select version,data into v,doc from public.family_open_ledger();
  select value->>'id' into target from jsonb_array_elements(doc->'wallets') where value->>'name'='Chung';
  due:=(((now() at time zone 'Asia/Ho_Chi_Minh')-interval '7 hours')::date)::text;
  doc:=jsonb_set(doc,'{rules}',doc->'rules' || jsonb_build_array(jsonb_build_object('id','family-rule','wallet',target,'type','expense','category','A','amount',123,'note','recurring fixture','next',due,'active',true,'anchorDay',extract(day from due::date)::int,'createdBy','fake')));
  perform public.family_save_ledger(v,doc);
end $$;
reset role;
do $$ declare first_count int; second_count int; begin
  first_count:=public.family_run_recurring();
  second_count:=public.family_run_recurring();
  if first_count<>1 or second_count<>0 then raise exception 'recurring not idempotent %, %',first_count,second_count; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
do $$ declare doc jsonb; begin
  select data into doc from public.family_open_ledger();
  if (select count(*) from jsonb_array_elements(doc->'entries') where value->>'note'='recurring fixture')<>1 then raise exception 'missing family recurring'; end if;
  if not exists(select 1 from jsonb_array_elements(doc->'entries') where value->>'note'='recurring fixture' and value->>'createdBy'='00000000-0000-0000-0000-000000000001') then raise exception 'recurring creator incorrect'; end if;
  begin perform public.family_run_recurring(); raise exception 'member ran scheduler'; exception when insufficient_privilege then null; end;
end $$;
reset role;
