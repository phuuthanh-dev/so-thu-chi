-- Personal view joins the owner's two ledgers without copying family wallets.
-- The version contains both source versions and membership identity.
create function public.personal_combined_open() returns table(version text, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid; p_ver bigint; h_ver bigint; personal jsonb; f_wallets jsonb:='[]'; f_entries jsonb:='[]'; f_rules jsonb:='[]';
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select o.version,o.data into p_ver,personal from public.open_ledger() o;
  select m.household_id,h.version into h_id,h_ver from family_private.members m join family_private.households h on h.id=m.household_id where m.user_id=actor and m.status='active';
  if h_id is not null then
    select coalesce(jsonb_agg(w.wallet || jsonb_build_object('id',w.id::text,'ownerId',w.owner_id::text,'visibility',w.visibility) order by w.id),'[]') into f_wallets from family_private.wallets w where w.household_id=h_id and w.owner_id=actor;
    select coalesce(jsonb_agg(e.value order by w.id,e.ordinality),'[]') into f_entries from family_private.wallets w cross join lateral jsonb_array_elements(w.entries) with ordinality e(value,ordinality) where w.household_id=h_id and w.owner_id=actor;
    select coalesce(jsonb_agg(r.value order by w.id,r.ordinality),'[]') into f_rules from family_private.wallets w cross join lateral jsonb_array_elements(w.rules) with ordinality r(value,ordinality) where w.household_id=h_id and w.owner_id=actor;
  end if;
  personal:=jsonb_set(jsonb_set(jsonb_set(personal,'{wallets}',(personal->'wallets')||f_wallets),'{entries}',(personal->'entries')||f_entries),'{rules}',(personal->'rules')||f_rules);
  if exists(select 1 from (select value->>'id' id from jsonb_array_elements(personal->'wallets') group by 1 having count(*)>1) d) then raise exception 'Duplicate wallet ID' using errcode='23505'; end if;
  return query select p_ver::text||':'||coalesce(h_id::text,'none')||':'||coalesce(h_ver::text,'0'),personal;
end $$;

-- Save both sources under locks in a single transaction. Other family wallets
-- are reconstructed from the server snapshot and cannot be overwritten here.
create function public.personal_combined_save(expected_version text, new_data jsonb) returns table(version text, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid; p_ver bigint; h_ver bigint; personal jsonb; f_doc jsonb; combined_ver text; owned text[]:='{}'; new_personal jsonb; new_family jsonb; candidate jsonb; prior_owned_wallets jsonb; prior_owned_entries jsonb; prior_owned_rules jsonb; new_owned_wallets jsonb; new_owned_entries jsonb; new_owned_rules jsonb; item jsonb; result_count int;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if jsonb_typeof(new_data) is distinct from 'object' or jsonb_typeof(new_data->'wallets') is distinct from 'array' or jsonb_typeof(new_data->'entries') is distinct from 'array' or jsonb_typeof(new_data->'rules') is distinct from 'array' or jsonb_typeof(new_data->'categories') is distinct from 'object' or jsonb_typeof(new_data->'budgets') is distinct from 'object' then raise exception 'Invalid data' using errcode='22023'; end if;
  select household_id into h_id from family_private.members where user_id=actor and status='active';
  if h_id is not null then
    select h.version into h_ver from family_private.households h where h.id=h_id for update;
    if not exists(select 1 from family_private.members where household_id=h_id and user_id=actor and status='active') then return; end if;
  end if;
  select l.version,l.data into p_ver,personal from public.ledgers l where l.owner_id=actor for update;
  if p_ver is null then raise exception 'Personal ledger not initialized' using errcode='22023'; end if;
  combined_ver:=p_ver::text||':'||coalesce(h_id::text,'none')||':'||coalesce(h_ver::text,'0');
  if combined_ver is distinct from expected_version then return; end if;
  if h_id is not null then
    select coalesce(array_agg(w.id::text),'{}') into owned from family_private.wallets w where w.household_id=h_id and w.owner_id=actor;
    select f.data into f_doc from public.family_open_ledger() f;
  end if;
  if (select count(*)<>count(distinct x.value->>'id') from jsonb_array_elements(new_data->'wallets') x)
    or (select count(*)<>count(distinct x.value->>'id') from jsonb_array_elements(new_data->'entries') x)
    or (select count(*)<>count(distinct x.value->>'id') from jsonb_array_elements(new_data->'rules') x) then raise exception 'Duplicate ID' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(new_data->'wallets') loop
    if item->>'id' is null or (not ((item->>'id')=any(owned)) and (item ? 'ownerId' or item ? 'visibility')) then raise exception 'Invalid wallet in personal view' using errcode='22023'; end if;
  end loop;
  for item in select value from jsonb_array_elements(new_data->'entries') union all select value from jsonb_array_elements(new_data->'rules') loop
    if not exists(select 1 from jsonb_array_elements(new_data->'wallets') w where w.value->>'id'=item->>'wallet') then raise exception 'Wallet missing' using errcode='22023'; end if;
  end loop;
  if h_id is not null then
    -- Moving a record between storage realms would lose its recurrence origin.
    if exists(select 1 from jsonb_array_elements(new_data->'entries') e join jsonb_array_elements(personal->'entries') p on e.value->>'id'=p.value->>'id' where (e.value->>'wallet')=any(owned))
      or exists(select 1 from jsonb_array_elements(new_data->'rules') e join jsonb_array_elements(personal->'rules') p on e.value->>'id'=p.value->>'id' where (e.value->>'wallet')=any(owned))
      or exists(select 1 from jsonb_array_elements(new_data->'entries') e join jsonb_array_elements(f_doc->'entries') f on e.value->>'id'=f.value->>'id' where (f.value->>'wallet')=any(owned) and not ((e.value->>'wallet')=any(owned)))
      or exists(select 1 from jsonb_array_elements(new_data->'rules') e join jsonb_array_elements(f_doc->'rules') f on e.value->>'id'=f.value->>'id' where (f.value->>'wallet')=any(owned) and not ((e.value->>'wallet')=any(owned))) then raise exception 'Moving records between personal and family storage is not supported' using errcode='22023'; end if;
    select coalesce(jsonb_agg(value order by ord),'[]') into prior_owned_wallets from jsonb_array_elements(f_doc->'wallets') with ordinality x(value,ord) where value->>'id'=any(owned);
    select coalesce(jsonb_agg(value order by ord),'[]') into prior_owned_entries from jsonb_array_elements(f_doc->'entries') with ordinality x(value,ord) where value->>'wallet'=any(owned);
    select coalesce(jsonb_agg(value order by ord),'[]') into prior_owned_rules from jsonb_array_elements(f_doc->'rules') with ordinality x(value,ord) where value->>'wallet'=any(owned);
    select coalesce(jsonb_agg(value order by ord),'[]') into new_owned_wallets from jsonb_array_elements(new_data->'wallets') with ordinality x(value,ord) where value->>'id'=any(owned);
    select coalesce(jsonb_agg(value order by ord),'[]') into new_owned_entries from jsonb_array_elements(new_data->'entries') with ordinality x(value,ord) where value->>'wallet'=any(owned);
    select coalesce(jsonb_agg(value order by ord),'[]') into new_owned_rules from jsonb_array_elements(new_data->'rules') with ordinality x(value,ord) where value->>'wallet'=any(owned);
    if (new_owned_wallets,new_owned_entries,new_owned_rules) is distinct from (prior_owned_wallets,prior_owned_entries,prior_owned_rules) then
      select coalesce(jsonb_agg(value order by ord),'[]')||new_owned_wallets into candidate from jsonb_array_elements(f_doc->'wallets') with ordinality x(value,ord) where not(value->>'id'=any(owned));
      new_family:=jsonb_set(f_doc,'{wallets}',candidate);
      select coalesce(jsonb_agg(value order by ord),'[]')||new_owned_entries into candidate from jsonb_array_elements(f_doc->'entries') with ordinality x(value,ord) where not(value->>'wallet'=any(owned));
      new_family:=jsonb_set(new_family,'{entries}',candidate);
      select coalesce(jsonb_agg(value order by ord),'[]')||new_owned_rules into candidate from jsonb_array_elements(f_doc->'rules') with ordinality x(value,ord) where not(value->>'wallet'=any(owned));
      new_family:=jsonb_set(new_family,'{rules}',candidate);
      select count(*) into result_count from public.family_save_ledger(h_ver,new_family);
      if result_count<>1 then raise exception 'Family data changed' using errcode='40001'; end if;
    end if;
  end if;
  select coalesce(jsonb_agg(value order by ord),'[]') into candidate from jsonb_array_elements(new_data->'wallets') with ordinality x(value,ord) where not(value->>'id'=any(owned));
  new_personal:=jsonb_set(new_data,'{wallets}',candidate);
  select coalesce(jsonb_agg(value order by ord),'[]') into candidate from jsonb_array_elements(new_data->'entries') with ordinality x(value,ord) where not(value->>'wallet'=any(owned));
  new_personal:=jsonb_set(new_personal,'{entries}',candidate);
  select coalesce(jsonb_agg(value order by ord),'[]') into candidate from jsonb_array_elements(new_data->'rules') with ordinality x(value,ord) where not(value->>'wallet'=any(owned));
  new_personal:=jsonb_set(new_personal,'{rules}',candidate);
  if new_personal is distinct from personal then
    select count(*) into result_count from public.save_ledger(p_ver,new_personal);
    if result_count<>1 then raise exception 'Personal data changed' using errcode='40001'; end if;
  end if;
  return query select * from public.personal_combined_open();
end $$;
revoke all on function public.personal_combined_open(),public.personal_combined_save(text,jsonb) from public, anon;
grant execute on function public.personal_combined_open(),public.personal_combined_save(text,jsonb) to authenticated;
notify pgrst,'reload schema';
