begin;
create table family_private.avatar_upload_limits (
  user_id uuid primary key references auth.users(id),
  window_started timestamptz not null,
  upload_count integer not null,
  last_attempt timestamptz not null
);
alter table family_private.avatar_upload_limits enable row level security;
revoke all on family_private.avatar_upload_limits from public,anon,authenticated;
create function public.account_avatar_upload_reserve() returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); previous family_private.avatar_upload_limits%rowtype; at_time timestamptz:=clock_timestamp();
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('avatar:'||actor::text,0));
  select * into previous from family_private.avatar_upload_limits where user_id=actor for update;
  if previous.user_id is not null and previous.window_started > at_time-interval '1 day' and (previous.upload_count >= 20 or previous.last_attempt > at_time-interval '3 seconds') then return false; end if;
  insert into family_private.avatar_upload_limits(user_id,window_started,upload_count,last_attempt)
  values(actor,at_time,1,at_time)
  on conflict (user_id) do update set
    window_started=case when family_private.avatar_upload_limits.window_started <= at_time-interval '1 day' then at_time else family_private.avatar_upload_limits.window_started end,
    upload_count=case when family_private.avatar_upload_limits.window_started <= at_time-interval '1 day' then 1 else family_private.avatar_upload_limits.upload_count+1 end,
    last_attempt=at_time;
  return true;
end $$;
revoke all on function public.account_avatar_upload_reserve() from public,anon;
grant execute on function public.account_avatar_upload_reserve() to authenticated;
-- Compare-and-swap leaves unrelated changes and a newer avatar untouched.
create function public.account_migrate_avatar(p_expected text,p_avatar text) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); changed integer;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_avatar is null or p_expected is null or p_expected !~ '^data:image/(webp|jpeg);base64,[A-Za-z0-9+/=]+$' or length(p_expected)>140000
    or p_avatar !~ ('^cloudinary:thu-chi/avatars/'||actor::text||'/[0-9a-f-]{36}\.(webp|jpg)$') then raise exception 'Invalid avatar' using errcode='22023'; end if;
  update public.ledgers set data=jsonb_set(data,'{avatar}',to_jsonb(p_avatar),true),version=version+1,updated_at=now()
    where owner_id=actor and data->>'avatar'=p_expected;
  get diagnostics changed=row_count;
  return changed=1;
end $$;
revoke all on function public.account_migrate_avatar(text,text) from public,anon;
grant execute on function public.account_migrate_avatar(text,text) to authenticated;
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
      'avatar',case when jsonb_typeof(l.data->'avatar')='string' and char_length(l.data->>'avatar')<=140000 and ((l.data->>'avatar') ~ '^data:image/(webp|jpeg);base64,[A-Za-z0-9+/=]+$' or (l.data->>'avatar') ~ ('^cloudinary:thu-chi/avatars/' || m.user_id::text || '/[0-9a-f-]{36}\.(webp|jpg)$')) then l.data->>'avatar' else null end
    ) order by m.joined_at) from family_private.members m left join public.ledgers l on l.owner_id=m.user_id
      where m.household_id=h.id and (m.status='active' or membership.role='owner')),'[]'::jsonb) else '[]'::jsonb end)
  into result from family_private.households h where h.id=membership.household_id;
  return result;
end $$;

notify pgrst,'reload schema';
commit;
