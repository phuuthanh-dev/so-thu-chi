-- Display name is stored with the existing account avatar in the owner's ledger.
-- Version checks protect every unrelated ledger field from a stale profile edit.
create function public.account_set_display_name(p_expected_version bigint,p_display_name text)
returns table(version bigint,display_name text)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean_name text;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  clean_name:=btrim(p_display_name);
  if clean_name is null or char_length(clean_name) not between 1 and 50 or clean_name ~ '[[:cntrl:]]' then raise exception 'Invalid display name' using errcode='22023'; end if;
  return query update public.ledgers l set data=jsonb_set(l.data,'{displayName}',to_jsonb(clean_name),true),version=l.version+1,updated_at=now()
    where l.owner_id=actor and l.version=p_expected_version returning l.version, l.data->>'displayName';
end $$;
revoke all on function public.account_set_display_name(bigint,text) from public,anon;
grant execute on function public.account_set_display_name(bigint,text) to authenticated;

-- Members may see profiles only after approval; owners can identify requests.
-- The result never returns private ledgers, wallet data or phone numbers.
create or replace function public.family_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); membership family_private.members%rowtype; result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into membership from family_private.members where user_id=actor;
  if membership.household_id is null then return null; end if;
  select jsonb_build_object('id',h.id,'name',h.name,'role',membership.role,'status',membership.status,
    'members',case when membership.status='active' then coalesce((select jsonb_agg(jsonb_build_object(
      'userId',m.user_id,'role',m.role,'status',m.status,
      'displayName',case when jsonb_typeof(l.data->'displayName')='string' and char_length(btrim(l.data->>'displayName')) between 1 and 50 and (l.data->>'displayName') !~ '[[:cntrl:]]' then btrim(l.data->>'displayName') else null end,
      'avatar',case when jsonb_typeof(l.data->'avatar')='string' and char_length(l.data->>'avatar')<=140000 and (l.data->>'avatar') ~ '^data:image/(webp|jpeg);base64,[A-Za-z0-9+/=]+$' then l.data->>'avatar' else null end
    ) order by m.joined_at) from family_private.members m left join public.ledgers l on l.owner_id=m.user_id
      where m.household_id=h.id and (m.status='active' or membership.role='owner')),'[]'::jsonb) else '[]'::jsonb end)
  into result from family_private.households h where h.id=membership.household_id;
  return result;
end $$;

create or replace function public.family_open_ledger() returns table(version bigint, data jsonb)
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
    'avatar',(select l.data->'avatar' from public.ledgers l where l.owner_id=actor),
    'displayName',(select l.data->'displayName' from public.ledgers l where l.owner_id=actor)
  ) from family_private.households h join family_private.member_settings s on s.household_id=h.id and s.user_id=actor where h.id=h_id;
end $$;

notify pgrst,'reload schema';
