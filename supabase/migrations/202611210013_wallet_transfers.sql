begin;
-- Each row is one internal movement, independent from income/expense entries.
create table family_private.wallet_transfers (
  id uuid primary key,
  created_by uuid not null references auth.users(id),
  source_ref text not null,
  request_source_ref text not null,
  source_personal_owner uuid references auth.users(id),
  destination_ref text not null,
  request_destination_ref text not null,
  destination_personal_owner uuid references auth.users(id),
  amount bigint not null check(amount > 0 and amount <= 9007199254740991),
  created_at timestamptz not null default clock_timestamp(),
  effective_date date not null default (now() at time zone 'Asia/Ho_Chi_Minh')::date,
  check(source_ref <> destination_ref or source_personal_owner is distinct from destination_personal_owner)
);
alter table family_private.wallet_transfers enable row level security;
revoke all on family_private.wallet_transfers from public, anon, authenticated;
create index wallet_transfers_source on family_private.wallet_transfers(source_ref,source_personal_owner);
create index wallet_transfers_destination on family_private.wallet_transfers(destination_ref,destination_personal_owner);

-- Only the actor's personal wallets and family wallets currently visible to them.
create function family_private.transfer_choices(p_actor uuid)
returns table(ref text, wallet_id text, label text, owner_id uuid)
language sql stable security definer set search_path='' as $$
  select 'p:'||(w.value->>'id'), w.value->>'id', w.value->>'name', p_actor
  from public.ledgers l cross join lateral jsonb_array_elements(l.data->'wallets') w
  where l.owner_id=p_actor and coalesce((w.value->>'archived')::boolean,false)=false
  union all
  select 'f:'||w.id::text, w.id::text, w.wallet->>'name', w.owner_id
  from family_private.wallets w join family_private.members m on m.household_id=w.household_id
  where m.user_id=p_actor and m.status='active' and (w.visibility='shared' or w.owner_id=p_actor)
    and coalesce((w.wallet->>'archived')::boolean,false)=false
$$;
revoke all on function family_private.transfer_choices(uuid) from public,anon,authenticated;

-- Existing archived wallets remain readable for their balances and movement history.
create function family_private.transfer_visible(p_actor uuid,p_ref text,p_personal_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select case when left(p_ref,2)='p:' then p_personal_owner=p_actor and exists (
    select 1 from public.ledgers l cross join lateral jsonb_array_elements(l.data->'wallets') w
    where l.owner_id=p_actor and w.value->>'id'=substr(p_ref,3))
  when left(p_ref,2)='f:' and p_personal_owner is null then exists (
    select 1 from family_private.wallets w join family_private.members m on m.household_id=w.household_id
    where w.id::text=substr(p_ref,3) and m.user_id=p_actor and m.status='active' and (w.visibility='shared' or w.owner_id=p_actor))
  else false end
$$;
revoke all on function family_private.transfer_visible(uuid,text,uuid) from public,anon,authenticated;

create function public.wallet_transfer_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); choices jsonb; legs jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('ref',ref,'walletId',wallet_id,'name',label,'ownerId',owner_id) order by label,ref),'[]') into choices from family_private.transfer_choices(actor);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'ref',leg.ref,'walletId',substr(leg.ref,3),'direction',leg.direction,
    'amount',t.amount,'date',t.effective_date,'createdAt',t.created_at,
    'otherName',case when family_private.transfer_visible(actor,leg.other_ref,leg.other_owner) then coalesce((select c.label from family_private.transfer_choices(actor) c where c.ref=leg.other_ref),'Ví đã lưu trữ') else 'Ví khác' end
  ) order by t.created_at desc,t.id desc,leg.ref),'[]') into legs
  from family_private.wallet_transfers t
  cross join lateral (values (t.source_ref,t.source_personal_owner,'out',t.destination_ref,t.destination_personal_owner),
                             (t.destination_ref,t.destination_personal_owner,'in',t.source_ref,t.source_personal_owner)) leg(ref,personal_owner,direction,other_ref,other_owner)
  where family_private.transfer_visible(actor,leg.ref,leg.personal_owner);
  return jsonb_build_object('wallets',choices,'legs',legs);
end $$;
revoke all on function public.wallet_transfer_state() from public,anon;
grant execute on function public.wallet_transfer_state() to authenticated;

create function public.wallet_transfer_create(p_id uuid,p_source text,p_destination text,p_amount bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h_id uuid; existing family_private.wallet_transfers%rowtype; source_owner uuid; destination_owner uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_id is null or p_source is null or p_destination is null or p_source=p_destination or p_amount is null or p_amount<=0 or p_amount>9007199254740991 then raise exception 'Invalid transfer' using errcode='22023'; end if;
  select household_id into h_id from family_private.members where user_id=actor and status='active';
  if h_id is not null then perform 1 from family_private.households where id=h_id for update; end if;
  perform 1 from public.ledgers where owner_id=actor for update;
  if not found then raise exception 'Personal ledger not initialized' using errcode='22023'; end if;
  select * into existing from family_private.wallet_transfers where id=p_id;
  if found then
    if existing.created_by=actor and existing.request_source_ref=p_source and existing.request_destination_ref=p_destination and existing.amount=p_amount then return p_id; end if;
    raise exception 'Transfer identifier already used' using errcode='23505';
  end if;
  if not exists(select 1 from family_private.transfer_choices(actor) where ref=p_source) or not exists(select 1 from family_private.transfer_choices(actor) where ref=p_destination) then raise exception 'Wallet not available' using errcode='42501'; end if;
  source_owner:=case when left(p_source,2)='p:' then actor else null end;
  destination_owner:=case when left(p_destination,2)='p:' then actor else null end;
  insert into family_private.wallet_transfers(id,created_by,source_ref,request_source_ref,source_personal_owner,destination_ref,request_destination_ref,destination_personal_owner,amount)
  values(p_id,actor,p_source,p_source,source_owner,p_destination,p_destination,destination_owner,p_amount);
  -- Version bump prevents stale ledger edits from racing movement/archival.
  update public.ledgers set version=version+1,updated_at=now() where owner_id=actor;
  if h_id is not null and (left(p_source,2)='f:' or left(p_destination,2)='f:') then update family_private.households set version=version+1 where id=h_id; end if;
  return p_id;
end $$;
revoke all on function public.wallet_transfer_create(uuid,text,text,bigint) from public,anon;
grant execute on function public.wallet_transfer_create(uuid,text,text,bigint) to authenticated;

-- A wallet with movement history cannot disappear; it may be archived.
create function family_private.prevent_transfer_wallet_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from family_private.wallet_transfers t where (t.source_ref='f:'||old.id::text and t.source_personal_owner is null) or (t.destination_ref='f:'||old.id::text and t.destination_personal_owner is null)) then raise exception 'Wallet has transfer history; archive it' using errcode='23514'; end if;
  return old;
end $$;
revoke all on function family_private.prevent_transfer_wallet_delete() from public,anon,authenticated;
create trigger prevent_transfer_wallet_delete before delete on family_private.wallets for each row execute function family_private.prevent_transfer_wallet_delete();

create function family_private.prevent_personal_wallet_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from jsonb_array_elements(old.data->'wallets') w
    where not exists(select 1 from jsonb_array_elements(new.data->'wallets') n where n.value->>'id'=w.value->>'id')
      and exists(select 1 from family_private.wallet_transfers t where (t.source_ref='p:'||(w.value->>'id') and t.source_personal_owner=old.owner_id) or (t.destination_ref='p:'||(w.value->>'id') and t.destination_personal_owner=old.owner_id)))
  then raise exception 'Wallet has transfer history; archive it' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function family_private.prevent_personal_wallet_delete() from public,anon,authenticated;
create trigger prevent_personal_wallet_delete before update of data on public.ledgers for each row execute function family_private.prevent_personal_wallet_delete();

-- Preserve transfer history when a personal wallet is moved into a household.
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
