-- An owner may remove a member only after their wallet ownership has been resolved.
create function public.family_remove_member(member_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select household_id into h_id from family_private.members where user_id=actor and role='owner' and status='active';
  if h_id is null then raise exception 'Owner access required' using errcode='42501'; end if;
  perform 1 from family_private.households where id=h_id for update;
  if not exists(select 1 from family_private.members where household_id=h_id and user_id=actor and role='owner' and status='active') then raise exception 'Owner access required' using errcode='42501'; end if;
  if member_id is null or not exists(select 1 from family_private.members where household_id=h_id and user_id=member_id and role='member') then raise exception 'Member not found' using errcode='22023'; end if;
  if exists(select 1 from family_private.wallets where household_id=h_id and owner_id=member_id) then raise exception 'Member owns wallets' using errcode='23514'; end if;
  delete from family_private.members where household_id=h_id and user_id=member_id;
  update family_private.households set version=version+1 where id=h_id;
end $$;
revoke all on function public.family_remove_member(uuid) from public, anon;
grant execute on function public.family_remove_member(uuid) to authenticated;
notify pgrst, 'reload schema';
