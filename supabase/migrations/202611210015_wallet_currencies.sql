begin;
-- Existing transfer amounts are in whole VND. Preserve them and their history.
alter table family_private.wallet_transfers
  add column destination_amount bigint check(destination_amount > 0 and destination_amount <= 9007199254740991),
  add column source_currency text not null default 'VND' check(source_currency in ('VND','USD')),
  add column destination_currency text not null default 'VND' check(destination_currency in ('VND','USD'));

create function family_private.wallet_currency(p_actor uuid, p_ref text) returns text
language sql stable security definer set search_path='' as $$
 select case when left(p_ref,2)='p:' then
   (select coalesce(w.value->>'currency','VND') from public.ledgers l cross join lateral jsonb_array_elements(l.data->'wallets') w where l.owner_id=p_actor and w.value->>'id'=substr(p_ref,3))
 when left(p_ref,2)='f:' then (select coalesce(w.wallet->>'currency','VND') from family_private.wallets w where w.id::text=substr(p_ref,3)) end
$$;
revoke all on function family_private.wallet_currency(uuid,text) from public,anon,authenticated;

create or replace function public.wallet_transfer_state() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); choices jsonb; legs jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('ref',ref,'walletId',wallet_id,'name',label,'ownerId',owner_id,'currency',family_private.wallet_currency(actor,ref)) order by label,ref),'[]') into choices from family_private.transfer_choices(actor) where owner_id=actor;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'ref',leg.ref,'walletId',substr(leg.ref,3),'direction',leg.direction,
    'amount',leg.amount,'currency',leg.currency,'date',t.effective_date,'createdAt',t.created_at,
    'otherName',case when family_private.transfer_visible(actor,leg.other_ref,leg.other_owner) then coalesce((select c.label from family_private.transfer_choices(actor) c where c.ref=leg.other_ref),'Ví đã lưu trữ') else 'Ví khác' end
  ) order by t.created_at desc,t.id desc,leg.ref),'[]') into legs
  from family_private.wallet_transfers t
  cross join lateral (values (t.source_ref,t.source_personal_owner,'out',t.destination_ref,t.destination_personal_owner,t.amount,t.source_currency),
    (t.destination_ref,t.destination_personal_owner,'in',t.source_ref,t.source_personal_owner,coalesce(t.destination_amount,t.amount),t.destination_currency)) leg(ref,personal_owner,direction,other_ref,other_owner,amount,currency)
  where family_private.transfer_visible(actor,leg.ref,leg.personal_owner);
  return jsonb_build_object('wallets',choices,'legs',legs);
end $$;

create function public.wallet_transfer_create_v2(p_id uuid,p_source text,p_destination text,p_amount bigint,p_destination_amount bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h_id uuid; existing family_private.wallet_transfers%rowtype; source_owner uuid; destination_owner uuid; source_unit text; destination_unit text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_id is null or p_source is null or p_destination is null or p_source=p_destination or p_amount is null or p_amount<=0 or p_amount>9007199254740991 or p_destination_amount is null or p_destination_amount<=0 or p_destination_amount>9007199254740991 then raise exception 'Invalid transfer' using errcode='22023'; end if;
  select household_id into h_id from family_private.members where user_id=actor and status='active';
  if h_id is not null then perform 1 from family_private.households where id=h_id for update; end if;
  perform 1 from public.ledgers where owner_id=actor for update;
  if not found then raise exception 'Personal ledger not initialized' using errcode='22023'; end if;
  select * into existing from family_private.wallet_transfers where id=p_id;
  if found then
    if existing.created_by=actor and existing.request_source_ref=p_source and existing.request_destination_ref=p_destination and existing.amount=p_amount and coalesce(existing.destination_amount,existing.amount)=p_destination_amount then return p_id; end if;
    raise exception 'Transfer identifier already used' using errcode='23505';
  end if;
  if not exists(select 1 from family_private.transfer_choices(actor) where ref=p_source and owner_id=actor) or not exists(select 1 from family_private.transfer_choices(actor) where ref=p_destination and owner_id=actor) then raise exception 'Only your own wallets may be used' using errcode='42501'; end if;
  source_unit:=family_private.wallet_currency(actor,p_source); destination_unit:=family_private.wallet_currency(actor,p_destination);
  if source_unit not in ('VND','USD') or destination_unit not in ('VND','USD') or source_unit is null or destination_unit is null or (source_unit=destination_unit and p_amount<>p_destination_amount) then raise exception 'Invalid currency or destination amount' using errcode='22023'; end if;
  source_owner:=case when left(p_source,2)='p:' then actor else null end;
  destination_owner:=case when left(p_destination,2)='p:' then actor else null end;
  insert into family_private.wallet_transfers(id,created_by,source_ref,request_source_ref,source_personal_owner,destination_ref,request_destination_ref,destination_personal_owner,amount,destination_amount,source_currency,destination_currency)
  values(p_id,actor,p_source,p_source,source_owner,p_destination,p_destination,destination_owner,p_amount,p_destination_amount,source_unit,destination_unit);
  update public.ledgers set version=version+1,updated_at=now() where owner_id=actor;
  if h_id is not null and (left(p_source,2)='f:' or left(p_destination,2)='f:') then update family_private.households set version=version+1 where id=h_id; end if;
  return p_id;
end $$;
revoke all on function public.wallet_transfer_create_v2(uuid,text,text,bigint,bigint) from public,anon;
grant execute on function public.wallet_transfer_create_v2(uuid,text,text,bigint,bigint) to authenticated;
-- Old clients can retry their existing movement, but cannot create a USD movement.
create or replace function public.wallet_transfer_create(p_id uuid,p_source text,p_destination text,p_amount bigint) returns uuid
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from family_private.wallet_transfers t where t.id=p_id and t.created_by=auth.uid()) and
   (family_private.wallet_currency(auth.uid(),p_source)='USD' or family_private.wallet_currency(auth.uid(),p_destination)='USD') then
   raise exception 'Update the app before using USD wallets' using errcode='22023';
 end if;
 return public.wallet_transfer_create_v2(p_id,p_source,p_destination,p_amount,p_amount);
end $$;

-- Snapshot only USD wallets and related records, so old clients may still edit VND data.
create function family_private.usd_snapshot(doc jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'wallets',coalesce((select jsonb_agg(w.value order by w.value->>'id') from jsonb_array_elements(doc->'wallets') w where coalesce(w.value->>'currency','VND')='USD'),'[]'::jsonb),
  'entries',coalesce((select jsonb_agg(e.value order by e.value->>'id') from jsonb_array_elements(doc->'entries') e where exists(select 1 from jsonb_array_elements(doc->'wallets') w where w.value->>'id'=e.value->>'wallet' and coalesce(w.value->>'currency','VND')='USD')),'[]'::jsonb),
  'rules',coalesce((select jsonb_agg(r.value order by r.value->>'id') from jsonb_array_elements(doc->'rules') r where exists(select 1 from jsonb_array_elements(doc->'wallets') w where w.value->>'id'=r.value->>'wallet' and coalesce(w.value->>'currency','VND')='USD')),'[]'::jsonb))
$$;
revoke all on function family_private.usd_snapshot(jsonb) from public,anon,authenticated;
create function family_private.guard_personal_currency() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from jsonb_array_elements(new.data->'wallets') w where coalesce(w.value->>'currency','VND') not in ('VND','USD')) then raise exception 'Invalid currency' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(old.data->'wallets') o join jsonb_array_elements(new.data->'wallets') n on o.value->>'id'=n.value->>'id' where coalesce(o.value->>'currency','VND')<>coalesce(n.value->>'currency','VND')) then raise exception 'Wallet currency cannot be changed' using errcode='22023'; end if;
 if auth.uid() is not null and current_setting('nha.currency_aware',true) is distinct from '2' and family_private.usd_snapshot(old.data) is distinct from family_private.usd_snapshot(new.data) then raise exception 'Update the app before editing USD wallets' using errcode='0A000'; end if;
 return new;
end $$;
create trigger guard_personal_currency before update of data on public.ledgers for each row execute function family_private.guard_personal_currency();
create function family_private.guard_family_currency() returns trigger language plpgsql security definer set search_path='' as $$
declare old_unit text; new_unit text;
begin
 if tg_op <> 'INSERT' then old_unit:=coalesce(old.wallet->>'currency','VND'); end if;
 if tg_op <> 'DELETE' then new_unit:=coalesce(new.wallet->>'currency','VND'); end if;
 if new_unit is not null and new_unit not in ('VND','USD') then raise exception 'Invalid currency' using errcode='22023'; end if;
 if tg_op='UPDATE' and old_unit<>new_unit then raise exception 'Wallet currency cannot be changed' using errcode='22023'; end if;
 if auth.uid() is not null and current_setting('nha.currency_aware',true) is distinct from '2' and (old_unit='USD' or new_unit='USD') then
   if tg_op <> 'UPDATE' then raise exception 'Update the app before editing USD wallets' using errcode='0A000'; end if;
   if old.wallet is distinct from new.wallet or old.entries is distinct from new.entries or old.rules is distinct from new.rules or old.owner_id is distinct from new.owner_id or old.visibility is distinct from new.visibility then raise exception 'Update the app before editing USD wallets' using errcode='0A000'; end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger guard_family_currency before insert or update or delete on family_private.wallets for each row execute function family_private.guard_family_currency();
revoke all on function family_private.guard_personal_currency(),family_private.guard_family_currency() from public,anon,authenticated;

-- Versioned mutations identify clients that understand cents and mixed currencies.
create function public.personal_combined_save_v2(expected_version text,new_data jsonb) returns table(version text,data jsonb) language plpgsql security definer set search_path='' as $$ begin perform set_config('nha.currency_aware','2',true); return query select * from public.personal_combined_save(expected_version,new_data); end $$;
create function public.family_save_ledger_v2(expected_version bigint,new_data jsonb) returns table(version bigint,data jsonb) language plpgsql security definer set search_path='' as $$ begin perform set_config('nha.currency_aware','2',true); return query select * from public.family_save_ledger(expected_version,new_data); end $$;
create function public.family_transfer_wallets_v2(expected_personal_version bigint,expected_family_version bigint,choices jsonb) returns integer language plpgsql security definer set search_path='' as $$ begin perform set_config('nha.currency_aware','2',true); return public.family_transfer_wallets(expected_personal_version,expected_family_version,choices); end $$;
create function public.category_rename_with_appearance_v2(p_mode text,p_expected_version text,p_new_data jsonb,p_kind text,p_old_name text,p_new_name text,p_icon text,p_color text,p_expected_old_revision bigint,p_expected_new_revision bigint) returns table(version text,data jsonb) language plpgsql security definer set search_path='' as $$ begin perform set_config('nha.currency_aware','2',true); return query select * from public.category_rename_with_appearance(p_mode,p_expected_version,p_new_data,p_kind,p_old_name,p_new_name,p_icon,p_color,p_expected_old_revision,p_expected_new_revision); end $$;
revoke all on function public.personal_combined_save_v2(text,jsonb),public.family_save_ledger_v2(bigint,jsonb),public.family_transfer_wallets_v2(bigint,bigint,jsonb),public.category_rename_with_appearance_v2(text,text,jsonb,text,text,text,text,text,bigint,bigint) from public,anon;
grant execute on function public.personal_combined_save_v2(text,jsonb),public.family_save_ledger_v2(bigint,jsonb),public.family_transfer_wallets_v2(bigint,bigint,jsonb),public.category_rename_with_appearance_v2(text,text,jsonb,text,text,text,text,text,bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
