begin;
-- User preference is separate from ledger JSON, so stale clients cannot erase it.
alter table public.ledgers add column default_wallet_id text;
create function public.account_default_wallet_get() returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); value text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select default_wallet_id into value from public.ledgers where owner_id=actor;
  return value;
end $$;
create function public.account_default_wallet_set(p_wallet_id text) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_wallet_id is null or not exists(select 1 from family_private.transfer_choices(actor) where wallet_id=p_wallet_id) then
    raise exception 'Wallet is unavailable' using errcode='42501';
  end if;
  update public.ledgers set default_wallet_id=p_wallet_id where owner_id=actor;
  if not found then raise exception 'Personal ledger not initialized' using errcode='22023'; end if;
  return p_wallet_id;
end $$;
revoke all on function public.account_default_wallet_get(),public.account_default_wallet_set(text) from public,anon;
grant execute on function public.account_default_wallet_get(),public.account_default_wallet_set(text) to authenticated;
create or replace function public.family_transfer_wallets(expected_personal_version bigint, expected_family_version bigint, choices jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid; family_version bigint; personal_version bigint; doc jsonb; item jsonb; source_wallet jsonb; target uuid; new_id uuid; moved integer:=0; entries jsonb; rules jsonb; source_ids text[]:='{}';
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select household_id into h_id from family_private.members where user_id=actor and status='active';
  if h_id is null then raise exception 'Active membership required' using errcode='42501'; end if;
  if jsonb_typeof(choices) is distinct from 'array' or jsonb_array_length(choices)=0 then raise exception 'Select wallets' using errcode='22023'; end if;
  select h.version into family_version from family_private.households h where h.id=h_id for update;
  if not exists(select 1 from family_private.members where household_id=h_id and user_id=actor and status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
  select l.version,l.data into personal_version,doc from public.ledgers l where l.owner_id=actor for update;
  if family_version is distinct from expected_family_version or personal_version is distinct from expected_personal_version then raise exception 'Data changed; reload before moving' using errcode='40001'; end if;
  insert into family_private.transfer_backups(household_id,user_id,personal_version,data) values(h_id,actor,personal_version,doc);
  for item in select value from jsonb_array_elements(choices) loop
    if item->>'walletId' is null or (item->>'walletId')=any(source_ids) or item->>'visibility' not in ('private','shared') then raise exception 'Invalid wallet selection' using errcode='22023'; end if;
    source_ids:=array_append(source_ids,item->>'walletId');
    if (select count(*) from jsonb_array_elements(doc->'wallets') w where w.value->>'id'=item->>'walletId') <> 1 then raise exception 'Wallet missing or duplicated' using errcode='22023'; end if;
    select w.value into source_wallet from jsonb_array_elements(doc->'wallets') w where w.value->>'id'=item->>'walletId';
    begin target:=(item->>'ownerId')::uuid; exception when others then raise exception 'Invalid owner' using errcode='22023'; end;
    if not exists(select 1 from family_private.members where household_id=h_id and user_id=target and status='active') then raise exception 'Owner must be an active member' using errcode='42501'; end if;
    new_id:=gen_random_uuid();
    select coalesce(jsonb_agg((e.value || jsonb_build_object('wallet',new_id::text,'createdBy',actor::text))),'[]'::jsonb) into entries
      from jsonb_array_elements(doc->'entries') e where e.value->>'wallet'=item->>'walletId';
    select coalesce(jsonb_agg((r.value || jsonb_build_object('wallet',new_id::text,'createdBy',actor::text))),'[]'::jsonb) into rules
      from jsonb_array_elements(doc->'rules') r where r.value->>'wallet'=item->>'walletId';
    insert into family_private.wallets(id,household_id,owner_id,visibility,wallet,entries,rules)
    values(new_id,h_id,target,item->>'visibility',source_wallet - 'id' - 'ownerId' - 'visibility',entries,rules);
    update family_private.wallet_transfers set source_ref='f:'||new_id::text,source_personal_owner=null where source_ref='p:'||(item->>'walletId') and source_personal_owner=actor;
    update family_private.wallet_transfers set destination_ref='f:'||new_id::text,destination_personal_owner=null where destination_ref='p:'||(item->>'walletId') and destination_personal_owner=actor;
    -- Keep the actor's preferred wallet when its ID changes during this move.
    if target=actor or item->>'visibility'='shared' then
      update public.ledgers set default_wallet_id=new_id::text where owner_id=actor and default_wallet_id=item->>'walletId';
    end if;
    moved:=moved+1;
  end loop;
  select jsonb_set(jsonb_set(jsonb_set(doc,'{wallets}',coalesce((select jsonb_agg(w.value) from jsonb_array_elements(doc->'wallets') w where not (w.value->>'id'=any(source_ids))),'[]'::jsonb)),
    '{entries}',coalesce((select jsonb_agg(e.value) from jsonb_array_elements(doc->'entries') e where not (e.value->>'wallet'=any(source_ids))),'[]'::jsonb)),
    '{rules}',coalesce((select jsonb_agg(r.value) from jsonb_array_elements(doc->'rules') r where not (r.value->>'wallet'=any(source_ids))),'[]'::jsonb)) into doc;
  update public.ledgers set data=doc,version=version+1,updated_at=now() where owner_id=actor;
  update family_private.households set version=version+1 where id=h_id;
  return moved;
end $$;

notify pgrst,'reload schema';
commit;
