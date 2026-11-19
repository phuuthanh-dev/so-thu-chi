-- Per-account category appearance, shared across the user's two workspaces.
-- Null values are tombstones so revision checks also protect resets.
create table family_private.category_appearances (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('expense','income')),
  category text not null check (length(btrim(category)) between 1 and 2000),
  icon_key text check (icon_key is null or icon_key ~ '^[a-z0-9-]{1,40}$'),
  color_key text check (color_key is null or color_key ~ '^[a-z0-9-]{1,40}$'),
  revision bigint not null default 1,
  primary key (user_id,kind,category)
);
alter table family_private.category_appearances enable row level security;
revoke all on family_private.category_appearances from public,anon,authenticated;

create function public.category_appearances_get() returns table(kind text,category text,icon_key text,color_key text,revision bigint)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  return query select s.kind,s.category,s.icon_key,s.color_key,s.revision from family_private.category_appearances s where s.user_id=actor;
end $$;

create function public.category_appearance_set(p_kind text,p_category text,p_icon text,p_color text,p_expected_revision bigint)
returns table(kind text,category text,icon_key text,color_key text,revision bigint)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); current_revision bigint; next_revision bigint;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if coalesce(p_kind,'') not in ('expense','income') or p_category is null or length(btrim(p_category)) not between 1 and 2000
    or (p_icon is not null and p_icon !~ '^[a-z0-9-]{1,40}$') or (p_color is not null and p_color !~ '^[a-z0-9-]{1,40}$')
    or p_expected_revision is null or p_expected_revision<0 then raise exception 'Invalid category appearance' using errcode='22023'; end if;
  -- Serialize creation as well as update, so concurrent inserts cannot win silently.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_kind||':'||p_category,0));
  select s.revision into current_revision from family_private.category_appearances s where s.user_id=actor and s.kind=p_kind and s.category=p_category for update;
  if coalesce(current_revision,0)<>p_expected_revision then raise exception 'Category appearance changed' using errcode='40001'; end if;
  next_revision:=coalesce(current_revision,0)+1;
  insert into family_private.category_appearances(user_id,kind,category,icon_key,color_key,revision) values(actor,p_kind,p_category,p_icon,p_color,next_revision)
  on conflict on constraint category_appearances_pkey do update set icon_key=excluded.icon_key,color_key=excluded.color_key,revision=excluded.revision;
  return query select p_kind,p_category,p_icon,p_color,next_revision;
end $$;

-- Verify that the category still exists while holding the workspace lock. This
-- prevents a stale tab from saving an appearance to a name renamed elsewhere.
create function public.category_appearance_update(p_mode text,p_kind text,p_category text,p_icon text,p_color text,p_expected_revision bigint)
returns table(kind text,category text,icon_key text,color_key text,revision bigint)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); h_id uuid; current_categories jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_mode='personal' then
    select l.data->'categories' into current_categories from public.ledgers l where l.owner_id=actor for update;
  elsif p_mode='family' then
    select m.household_id into h_id from family_private.members m where m.user_id=actor and m.status='active';
    if h_id is null then raise exception 'Active membership required' using errcode='42501'; end if;
    perform 1 from family_private.households where id=h_id for update;
    if not exists(select 1 from family_private.members m where m.household_id=h_id and m.user_id=actor and m.status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
    select s.categories into current_categories from family_private.member_settings s where s.household_id=h_id and s.user_id=actor;
  else raise exception 'Invalid workspace' using errcode='22023'; end if;
  if coalesce((current_categories->p_kind) ? p_category,false) is not true then raise exception 'Category no longer exists' using errcode='40001'; end if;
  return query select a.kind,a.category,a.icon_key,a.color_key,a.revision from public.category_appearance_set(p_kind,p_category,p_icon,p_color,p_expected_revision) a;
end $$;

-- A rename and its chosen appearance either both commit or neither does.
create function public.category_rename_with_appearance(p_mode text,p_expected_version text,p_new_data jsonb,p_kind text,p_old_name text,p_new_name text,p_icon text,p_color text,p_expected_old_revision bigint,p_expected_new_revision bigint)
returns table(version text,data jsonb)
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); next_version text; next_data jsonb; old_revision bigint;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_mode='family' then
    select f.version::text,f.data into next_version,next_data from public.family_save_ledger(p_expected_version::bigint,p_new_data) f;
  elsif p_mode='personal' then
    select p.version,p.data into next_version,next_data from public.personal_combined_save(p_expected_version,p_new_data) p;
  else raise exception 'Invalid workspace' using errcode='22023'; end if;
  if next_version is null then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||':'||p_kind||':'||p_old_name,0));
  select s.revision into old_revision from family_private.category_appearances s where s.user_id=actor and s.kind=p_kind and s.category=p_old_name for update;
  if coalesce(old_revision,0) is distinct from p_expected_old_revision then raise exception 'Category appearance changed' using errcode='40001'; end if;
  perform public.category_appearance_set(p_kind,p_new_name,p_icon,p_color,p_expected_new_revision);
  return query select next_version,next_data;
end $$;
revoke all on function public.category_appearances_get(),public.category_appearance_set(text,text,text,text,bigint),public.category_appearance_update(text,text,text,text,text,bigint),public.category_rename_with_appearance(text,text,jsonb,text,text,text,text,text,bigint,bigint) from public,anon;
grant execute on function public.category_appearances_get(),public.category_appearance_update(text,text,text,text,text,bigint),public.category_rename_with_appearance(text,text,jsonb,text,text,text,text,text,bigint,bigint) to authenticated;
notify pgrst,'reload schema';
