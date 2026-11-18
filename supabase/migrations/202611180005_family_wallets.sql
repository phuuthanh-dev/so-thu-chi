-- Family wallets are separate rows so private payloads are never returned to other members.
create table family_private.wallets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references family_private.households(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  visibility text not null check (visibility in ('private','shared')),
  wallet jsonb not null,
  entries jsonb not null default '[]'::jsonb,
  rules jsonb not null default '[]'::jsonb,
  check (jsonb_typeof(wallet)='object' and jsonb_typeof(entries)='array' and jsonb_typeof(rules)='array')
);
-- A restricted pre-transfer copy aids manual recovery if a later change was unintended.
create table family_private.transfer_backups (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references family_private.households(id),
  user_id uuid not null references auth.users(id),
  personal_version bigint not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table family_private.transfer_backups enable row level security;
revoke all on family_private.transfer_backups from public, anon, authenticated;
create index family_wallets_household_idx on family_private.wallets(household_id);
alter table family_private.wallets enable row level security;
revoke all on family_private.wallets from public, anon, authenticated;

create function public.family_open_ledger() returns table(version bigint, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select m.household_id into h_id from family_private.members m where m.user_id=actor and m.status='active';
  if h_id is null then raise exception 'Active membership required' using errcode='42501'; end if;
  return query select h.version, jsonb_build_object(
    'wallets',coalesce((select jsonb_agg(w.wallet || jsonb_build_object('id',w.id::text,'ownerId',w.owner_id::text,'visibility',w.visibility) order by w.id)
      from family_private.wallets w where w.household_id=h_id and (w.visibility='shared' or w.owner_id=actor)),'[]'::jsonb),
    'entries',coalesce((select jsonb_agg(e.value order by w.id,e.ordinality) from family_private.wallets w cross join lateral jsonb_array_elements(w.entries) with ordinality e(value,ordinality) where w.household_id=h_id and (w.visibility='shared' or w.owner_id=actor)),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(r.value order by w.id,r.ordinality) from family_private.wallets w cross join lateral jsonb_array_elements(w.rules) with ordinality r(value,ordinality) where w.household_id=h_id and (w.visibility='shared' or w.owner_id=actor)),'[]'::jsonb),
    'categories',s.categories,'budgets',s.budgets,
    'avatar',(select l.data->'avatar' from public.ledgers l where l.owner_id=actor)
  ) from family_private.households h join family_private.member_settings s on s.household_id=h.id and s.user_id=actor where h.id=h_id;
end $$;

-- Assign each chosen legacy wallet to an active family member. Locks and expected
-- versions prevent silent overwrites; movement and removal happen atomically.
create function public.family_transfer_wallets(expected_personal_version bigint, expected_family_version bigint, choices jsonb) returns integer
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
    moved:=moved+1;
  end loop;
  select jsonb_set(jsonb_set(jsonb_set(doc,'{wallets}',coalesce((select jsonb_agg(w.value) from jsonb_array_elements(doc->'wallets') w where not (w.value->>'id'=any(source_ids))),'[]'::jsonb)),
    '{entries}',coalesce((select jsonb_agg(e.value) from jsonb_array_elements(doc->'entries') e where not (e.value->>'wallet'=any(source_ids))),'[]'::jsonb)),
    '{rules}',coalesce((select jsonb_agg(r.value) from jsonb_array_elements(doc->'rules') r where not (r.value->>'wallet'=any(source_ids))),'[]'::jsonb)) into doc;
  update public.ledgers set data=doc,version=version+1,updated_at=now() where owner_id=actor;
  update family_private.households set version=version+1 where id=h_id;
  return moved;
end $$;

revoke all on function public.family_open_ledger() from public, anon;
revoke all on function public.family_transfer_wallets(bigint,bigint,jsonb) from public, anon;
grant execute on function public.family_open_ledger(),public.family_transfer_wallets(bigint,bigint,jsonb) to authenticated;
notify pgrst, 'reload schema';
