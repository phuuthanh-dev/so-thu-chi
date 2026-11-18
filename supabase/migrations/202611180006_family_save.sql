-- Only the caller's visible wallets can participate in a family write.
create function public.family_save_ledger(expected_version bigint, new_data jsonb)
returns table(version bigint, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid; current_version bigint; wallet_item jsonb; wallet_id uuid; wallet_owner uuid; old_wallet family_private.wallets%rowtype; prior_entries jsonb; prior_rules jsonb; wallet_ids uuid[]:='{}'; entry_item jsonb; rule_item jsonb; old_entry jsonb; old_rule jsonb; next_entry jsonb; entry_list jsonb; rule_list jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select household_id into h_id from family_private.members where user_id=actor and status='active';
  if h_id is null then raise exception 'Active membership required' using errcode='42501'; end if;
  select h.version into current_version from family_private.households h where h.id=h_id for update;
  if not exists(select 1 from family_private.members where household_id=h_id and user_id=actor and status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
  if current_version is distinct from expected_version then return; end if;
  if jsonb_typeof(new_data) is distinct from 'object' or jsonb_typeof(new_data->'wallets') is distinct from 'array'
     or jsonb_typeof(new_data->'entries') is distinct from 'array' or jsonb_typeof(new_data->'rules') is distinct from 'array'
     or jsonb_typeof(new_data->'categories') is distinct from 'object' or jsonb_typeof(new_data->'budgets') is distinct from 'object'
     or octet_length(new_data::text)>2000000 then raise exception 'Invalid family data' using errcode='22023'; end if;
  select coalesce(jsonb_agg(e.value),'[]'::jsonb) into prior_entries from family_private.wallets w cross join lateral jsonb_array_elements(w.entries) e where w.household_id=h_id and (w.visibility='shared' or w.owner_id=actor);
  select coalesce(jsonb_agg(r.value),'[]'::jsonb) into prior_rules from family_private.wallets w cross join lateral jsonb_array_elements(w.rules) r where w.household_id=h_id and (w.visibility='shared' or w.owner_id=actor);
  if (select count(*) <> count(distinct x.value->>'id') from jsonb_array_elements(new_data->'entries') x)
     or (select count(*) <> count(distinct x.value->>'id') from jsonb_array_elements(new_data->'rules') x) then raise exception 'Duplicate record ID' using errcode='22023'; end if;
  for wallet_item in select value from jsonb_array_elements(new_data->'wallets') loop
    begin wallet_id:=(wallet_item->>'id')::uuid; wallet_owner:=(wallet_item->>'ownerId')::uuid; exception when others then raise exception 'Invalid wallet' using errcode='22023'; end;
    if wallet_id is null or wallet_owner is null or wallet_id=any(wallet_ids) or coalesce(wallet_item->>'visibility','') not in ('shared','private')
       or jsonb_typeof(wallet_item->'name') is distinct from 'string' or length(btrim(wallet_item->>'name'))=0
       or jsonb_typeof(wallet_item->'balance') is distinct from 'number'
       or (wallet_item ? 'note' and jsonb_typeof(wallet_item->'note') <> 'string') then raise exception 'Invalid wallet' using errcode='22023'; end if;
    wallet_ids:=array_append(wallet_ids,wallet_id);
    select * into old_wallet from family_private.wallets where id=wallet_id and household_id=h_id for update;
    if found then
      if old_wallet.visibility <> 'shared' and old_wallet.owner_id <> actor then raise exception 'Wallet not available' using errcode='42501'; end if;
      if old_wallet.owner_id <> actor and (wallet_owner<>old_wallet.owner_id or wallet_item->>'visibility'<>old_wallet.visibility or (wallet_item - 'id' - 'ownerId' - 'visibility') is distinct from old_wallet.wallet) then raise exception 'Only the wallet owner can change wallet settings' using errcode='42501'; end if;
      if not exists(select 1 from family_private.members where household_id=h_id and user_id=wallet_owner and status='active') then raise exception 'Invalid wallet owner' using errcode='42501'; end if;
    else
      if wallet_owner<>actor then raise exception 'New wallets must belong to their creator' using errcode='42501'; end if;
      if exists(select 1 from family_private.wallets where id=wallet_id) then raise exception 'Wallet not available' using errcode='42501'; end if;
    end if;
  end loop;
  for entry_item in select value from jsonb_array_elements(new_data->'entries') loop
    if jsonb_typeof(entry_item->'id') is distinct from 'string' or length(entry_item->>'id')=0
       or jsonb_typeof(entry_item->'amount') is distinct from 'number' or (entry_item->>'amount')::numeric<=0
       or coalesce(entry_item->>'type','') not in ('income','expense') or jsonb_typeof(entry_item->'category') is distinct from 'string'
       or coalesce(entry_item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or not exists(select 1 from unnest(wallet_ids) id where id::text=entry_item->>'wallet') then raise exception 'Invalid transaction' using errcode='22023'; end if;
  end loop;
  for rule_item in select value from jsonb_array_elements(new_data->'rules') loop
    if jsonb_typeof(rule_item->'id') is distinct from 'string' or length(rule_item->>'id')=0
       or jsonb_typeof(rule_item->'amount') is distinct from 'number' or (rule_item->>'amount')::numeric<=0
       or coalesce(rule_item->>'type','') not in ('income','expense') or jsonb_typeof(rule_item->'category') is distinct from 'string'
       or coalesce(rule_item->>'next','') !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(rule_item->'active') is distinct from 'boolean'
       or not exists(select 1 from unnest(wallet_ids) id where id::text=rule_item->>'wallet') then raise exception 'Invalid recurring rule' using errcode='22023'; end if;
  end loop;
  for old_wallet in select * from family_private.wallets where household_id=h_id and (visibility='shared' or owner_id=actor) and not(id=any(wallet_ids)) loop
    if old_wallet.owner_id<>actor or jsonb_array_length(old_wallet.entries)>0 or jsonb_array_length(old_wallet.rules)>0 then raise exception 'Wallet must be archived instead' using errcode='42501'; end if;
    delete from family_private.wallets where id=old_wallet.id;
  end loop;
  for wallet_item in select value from jsonb_array_elements(new_data->'wallets') loop
    wallet_id:=(wallet_item->>'id')::uuid; wallet_owner:=(wallet_item->>'ownerId')::uuid; entry_list:='[]'::jsonb; rule_list:='[]'::jsonb;
    for entry_item in select value from jsonb_array_elements(new_data->'entries') where value->>'wallet'=wallet_id::text loop
      select e.value into old_entry from jsonb_array_elements(prior_entries) e where e.value->>'id'=entry_item->>'id' limit 1;
      next_entry:=(entry_item - 'createdBy' - 'origin') || jsonb_build_object('createdBy',coalesce(old_entry->>'createdBy',actor::text));
      if old_entry ? 'origin' then next_entry:=next_entry || jsonb_build_object('origin',old_entry->'origin'); end if;
      entry_list:=entry_list || jsonb_build_array(next_entry);
    end loop;
    for rule_item in select value from jsonb_array_elements(new_data->'rules') where value->>'wallet'=wallet_id::text loop
      select r.value into old_rule from jsonb_array_elements(prior_rules) r where r.value->>'id'=rule_item->>'id' limit 1;
      rule_list:=rule_list || jsonb_build_array((rule_item - 'createdBy') || jsonb_build_object('createdBy',coalesce(old_rule->>'createdBy',actor::text)));
    end loop;
    update family_private.wallets set owner_id=wallet_owner,visibility=wallet_item->>'visibility',wallet=wallet_item - 'id' - 'ownerId' - 'visibility',entries=entry_list,rules=rule_list
      where id=wallet_id and household_id=h_id;
    if not found then
      insert into family_private.wallets(id,household_id,owner_id,visibility,wallet,entries,rules)
      values(wallet_id,h_id,wallet_owner,wallet_item->>'visibility',wallet_item - 'id' - 'ownerId' - 'visibility',entry_list,rule_list);
    end if;
  end loop;
  update family_private.member_settings set categories=new_data->'categories',budgets=new_data->'budgets' where household_id=h_id and user_id=actor;
  update family_private.households h set version=h.version+1 where id=h_id;
  return query select * from public.family_open_ledger();
end $$;
revoke all on function public.family_save_ledger(bigint,jsonb) from public, anon;
grant execute on function public.family_save_ledger(bigint,jsonb) to authenticated;
notify pgrst, 'reload schema';
