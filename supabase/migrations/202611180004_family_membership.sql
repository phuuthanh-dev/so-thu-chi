-- Additive family membership. No existing ledger is moved by this migration.
create schema if not exists family_private;
revoke all on schema family_private from public, anon, authenticated;

create table family_private.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  version bigint not null default 0,
  created_at timestamptz not null default now()
);
create table family_private.members (
  household_id uuid not null references family_private.households(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner', 'member')),
  status text not null check (status in ('active', 'pending')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);
create table family_private.invites (
  token_hash bytea primary key,
  household_id uuid not null references family_private.households(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create table family_private.member_settings (
  household_id uuid not null,
  user_id uuid not null,
  categories jsonb not null default '{"expense":[],"income":[]}'::jsonb,
  budgets jsonb not null default '{}'::jsonb,
  primary key (household_id, user_id),
  foreign key (household_id, user_id) references family_private.members(household_id, user_id) on delete cascade
);

alter table family_private.households enable row level security;
alter table family_private.members enable row level security;
alter table family_private.invites enable row level security;
alter table family_private.member_settings enable row level security;
revoke all on all tables in schema family_private from public, anon, authenticated;

create function public.family_create(family_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); new_id uuid; settings jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if family_name is null or length(btrim(family_name)) not between 1 and 80 then raise exception 'Invalid name' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  if exists(select 1 from family_private.members where user_id = actor) then raise exception 'Already in a family or waiting for approval' using errcode = '23505'; end if;
  insert into family_private.households(owner_id, name) values (actor, btrim(family_name)) returning id into new_id;
  insert into family_private.members(household_id,user_id,role,status) values(new_id,actor,'owner','active');
  select data into settings from public.ledgers where owner_id = actor;
  insert into family_private.member_settings(household_id,user_id,categories,budgets)
  values(new_id,actor,coalesce(settings->'categories','{"expense":[],"income":[]}'::jsonb),coalesce(settings->'budgets','{}'::jsonb));
  return new_id;
end $$;

create function public.family_create_invite() returns text
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); h_id uuid; token text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select m.household_id into h_id from family_private.members m where m.user_id=actor and m.role='owner' and m.status='active';
  if h_id is null then raise exception 'Owner access required' using errcode = '42501'; end if;
  token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  insert into family_private.invites(token_hash,household_id,created_by,expires_at)
  values (pg_catalog.sha256(pg_catalog.convert_to(token,'UTF8')),h_id,actor,now()+interval '24 hours');
  return token;
end $$;

create function public.family_request_join(invite_token text) returns text
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); inv family_private.invites%rowtype; family_name text;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if invite_token !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  if exists(select 1 from family_private.members where user_id=actor) then raise exception 'Already in a family or waiting for approval' using errcode='23505'; end if;
  select * into inv from family_private.invites where token_hash=pg_catalog.sha256(pg_catalog.convert_to(invite_token,'UTF8')) for update;
  if inv.household_id is null or inv.consumed_at is not null or inv.expires_at <= now() then raise exception 'Invitation expired or invalid' using errcode='22023'; end if;
  select name into family_name from family_private.households where id=inv.household_id for update;
  insert into family_private.members(household_id,user_id,role,status) values(inv.household_id,actor,'member','pending');
  update family_private.invites set consumed_at=now(), consumed_by=actor where token_hash=inv.token_hash;
  update family_private.households set version=version+1 where id=inv.household_id;
  return family_name;
end $$;

create function public.family_respond_member(member_id uuid, approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); h_id uuid; settings jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select household_id into h_id from family_private.members where user_id=actor and role='owner' and status='active';
  if h_id is null then raise exception 'Owner access required' using errcode='42501'; end if;
  perform 1 from family_private.households where id=h_id for update;
  if not exists(select 1 from family_private.members where household_id=h_id and user_id=member_id and status='pending' and role='member') then raise exception 'No pending member' using errcode='22023'; end if;
  if approve is true then
    update family_private.members set status='active' where household_id=h_id and user_id=member_id;
    select data into settings from public.ledgers where owner_id=member_id;
    insert into family_private.member_settings(household_id,user_id,categories,budgets)
    values(h_id,member_id,coalesce(settings->'categories','{"expense":[],"income":[]}'::jsonb),coalesce(settings->'budgets','{}'::jsonb));
  elsif approve is false then
    delete from family_private.members where household_id=h_id and user_id=member_id;
  else raise exception 'Invalid choice' using errcode='22023'; end if;
  update family_private.households set version=version+1 where id=h_id;
end $$;

create function public.family_status() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); membership family_private.members%rowtype; result jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into membership from family_private.members where user_id=actor;
  if membership.household_id is null then return null; end if;
  select jsonb_build_object('id',h.id,'name',h.name,'role',membership.role,'status',membership.status,
    'members', case when membership.status='active' then coalesce((select jsonb_agg(jsonb_build_object('userId',m.user_id,'role',m.role,'status',m.status,'phone',u.phone) order by m.joined_at)
      from family_private.members m join auth.users u on u.id=m.user_id where m.household_id=h.id and (m.status='active' or membership.role='owner')),'[]'::jsonb) else '[]'::jsonb end)
  into result from family_private.households h where h.id=membership.household_id;
  return result;
end $$;

revoke all on function public.family_create(text) from public, anon;
revoke all on function public.family_create_invite() from public, anon;
revoke all on function public.family_request_join(text) from public, anon;
revoke all on function public.family_respond_member(uuid,boolean) from public, anon;
revoke all on function public.family_status() from public, anon;
grant execute on function public.family_create(text), public.family_create_invite(), public.family_request_join(text), public.family_respond_member(uuid,boolean), public.family_status() to authenticated;
notify pgrst, 'reload schema';
