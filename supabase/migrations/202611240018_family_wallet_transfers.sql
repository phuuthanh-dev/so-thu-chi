begin;
-- New RPCs preserve old clients' owner-only behavior while allowing active members to use shared wallets.
create or replace function public.wallet_transfer_state_v2() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); choices jsonb; legs jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('ref',ref,'walletId',wallet_id,'name',label,'ownerId',owner_id,'currency',family_private.wallet_currency(actor,ref)) order by label,ref),'[]') into choices from family_private.transfer_choices(actor);
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

create function public.wallet_transfer_create_v3(p_id uuid,p_source text,p_destination text,p_amount bigint,p_destination_amount bigint) returns uuid
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
  if not exists(select 1 from family_private.transfer_choices(actor) where ref=p_source) or not exists(select 1 from family_private.transfer_choices(actor) where ref=p_destination) then raise exception 'Wallet not available' using errcode='42501'; end if;
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
revoke all on function public.wallet_transfer_create_v3(uuid,text,text,bigint,bigint) from public,anon;
grant execute on function public.wallet_transfer_create_v3(uuid,text,text,bigint,bigint) to authenticated;
revoke all on function public.wallet_transfer_state_v2() from public,anon;
grant execute on function public.wallet_transfer_state_v2() to authenticated;
notify pgrst,'reload schema';
commit;
