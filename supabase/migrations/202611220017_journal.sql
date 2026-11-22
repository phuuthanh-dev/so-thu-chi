begin;
-- Journal data is independent from the financial ledgers.
create table family_private.journal_entries (
 id uuid primary key,
 owner_id uuid not null references auth.users(id),
 household_id uuid references family_private.households(id),
 visibility text not null check(visibility in ('private','family')),
 title text not null check(char_length(title)<=120),
 body text not null check(char_length(body)<=10000),
 memory_date date not null,
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 check(visibility='private' or household_id is not null)
);
create table family_private.journal_photos (
 id uuid primary key,
 entry_id uuid not null references family_private.journal_entries(id),
 owner_id uuid not null references auth.users(id),
 format text not null check(format in ('webp','jpg')),
 state text not null check(state in ('pending','ready','deleted')),
 cleanup_after timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create table family_private.journal_upload_limits (
 user_id uuid primary key references auth.users(id),
 window_started timestamptz not null,
 upload_count integer not null
);
alter table family_private.journal_upload_limits enable row level security;
revoke all on family_private.journal_upload_limits from public,anon,authenticated;
create index journal_entries_owner on family_private.journal_entries(owner_id, memory_date desc);
create index journal_entries_household on family_private.journal_entries(household_id, memory_date desc);
create index journal_photos_entry on family_private.journal_photos(entry_id, created_at);
alter table family_private.journal_entries enable row level security;
alter table family_private.journal_photos enable row level security;
revoke all on family_private.journal_entries,family_private.journal_photos from public,anon,authenticated;
create function family_private.journal_can_read(p_actor uuid,p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from family_private.journal_entries e where e.id=p_id and e.deleted_at is null and (e.owner_id=p_actor or (e.visibility='family' and exists(select 1 from family_private.members m where m.household_id=e.household_id and m.user_id=p_actor and m.status='active'))))
$$;
revoke all on function family_private.journal_can_read(uuid,uuid) from public,anon,authenticated;
create function public.journal_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'ownerId',e.owner_id,'title',e.title,'body',e.body,'date',e.memory_date,'visibility',e.visibility,'revision',e.revision,'createdAt',e.created_at,
 'authorName',coalesce(nullif(btrim(l.data->>'displayName'),''),'Thành viên'),
 'photos',coalesce((select jsonb_agg(p.id order by p.created_at,p.id) from family_private.journal_photos p where p.entry_id=e.id and p.state='ready'),'[]'::jsonb)) order by e.memory_date desc,e.created_at desc,e.id),'[]'::jsonb) into result
 from family_private.journal_entries e left join public.ledgers l on l.owner_id=e.owner_id where family_private.journal_can_read(actor,e.id);
 return result;
end $$;
create function public.journal_save(p_id uuid,p_expected integer,p_title text,p_body text,p_date date,p_visibility text) returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); household uuid; old family_private.journal_entries%rowtype; next_rev integer;
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_id is null or p_title is null or p_body is null or p_date is null or p_visibility not in ('private','family') or char_length(p_title)>120 or char_length(p_body)>10000 or (length(btrim(p_title))=0 and length(btrim(p_body))=0) then raise exception 'Invalid memory' using errcode='22023'; end if;
 if p_visibility='family' then select household_id into household from family_private.members where user_id=actor and status='active'; if household is null then raise exception 'Active family membership required' using errcode='42501'; end if; end if;
 select * into old from family_private.journal_entries where id=p_id for update;
 if found then
  if old.owner_id<>actor or old.deleted_at is not null then raise exception 'Memory unavailable' using errcode='42501'; end if;
  if (p_expected=0 or old.revision=p_expected+1) and old.title=btrim(p_title) and old.body=btrim(p_body) and old.memory_date=p_date and old.visibility=p_visibility and old.household_id is not distinct from household then return old.revision; end if;
  if old.revision is distinct from p_expected then raise exception 'Memory has changed' using errcode='40001'; end if;
  update family_private.journal_entries set title=btrim(p_title),body=btrim(p_body),memory_date=p_date,visibility=p_visibility,household_id=household,revision=revision+1,updated_at=now() where id=p_id returning revision into next_rev;
 else
  if p_expected<>0 then raise exception 'Memory not found' using errcode='22023'; end if;
  insert into family_private.journal_entries(id,owner_id,household_id,visibility,title,body,memory_date) values(p_id,actor,household,p_visibility,btrim(p_title),btrim(p_body),p_date) returning revision into next_rev;
 end if;
 return next_rev;
end $$;
create function public.journal_delete(p_id uuid,p_expected integer) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); e family_private.journal_entries%rowtype;
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select * into e from family_private.journal_entries where id=p_id for update;
 if e.owner_id is distinct from actor then raise exception 'Memory unavailable' using errcode='42501'; end if;
 if e.deleted_at is not null then return true; end if;
 if e.revision is distinct from p_expected then raise exception 'Memory has changed' using errcode='40001'; end if;
 update family_private.journal_entries set title='',body='',memory_date=date '1970-01-01',visibility='private',household_id=null,deleted_at=now(),revision=revision+1 where id=p_id;
 update family_private.journal_photos set cleanup_after=case when state='pending' then now()+interval '2 minutes' else now() end,state='deleted' where entry_id=p_id and state<>'deleted';
 return true;
end $$;
create function public.journal_photo_reserve(p_entry uuid,p_photo uuid,p_format text) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); e family_private.journal_entries%rowtype; p family_private.journal_photos%rowtype; at_time timestamptz:=clock_timestamp(); uploads family_private.journal_upload_limits%rowtype;
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 if p_entry is null or p_photo is null or p_format not in ('webp','jpg') then raise exception 'Invalid photo' using errcode='22023'; end if;
 select * into e from family_private.journal_entries where id=p_entry for update;
 if e.owner_id is distinct from actor or e.deleted_at is not null then raise exception 'Memory unavailable' using errcode='42501'; end if;
 select * into p from family_private.journal_photos where id=p_photo;
 if found then
  if p.owner_id=actor and p.entry_id=p_entry and p.format=p_format and p.state='pending' and p.created_at<now()-interval '2 minutes' then
   update family_private.journal_photos set state='deleted',cleanup_after=now() where id=p_photo; return 'expired';
  end if;
  if p.owner_id=actor and p.entry_id=p_entry and p.format=p_format and p.state in ('pending','ready') then return p.state; end if;
  raise exception 'Photo identifier used' using errcode='23505';
 end if;
 update family_private.journal_photos set state='deleted',cleanup_after=now() where entry_id=p_entry and state='pending' and created_at<now()-interval '30 minutes';
 if (select count(*) from family_private.journal_photos where entry_id=p_entry and state in ('pending','ready'))>=8 then raise exception 'Too many photos' using errcode='23514'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('journal-upload:'||actor::text,0));
 select * into uploads from family_private.journal_upload_limits where user_id=actor for update;
 if uploads.user_id is not null and uploads.window_started>at_time-interval '1 hour' and uploads.upload_count>=40 then raise exception 'Too many uploads' using errcode='54000'; end if;
 insert into family_private.journal_upload_limits(user_id,window_started,upload_count) values(actor,at_time,1)
 on conflict(user_id) do update set window_started=case when family_private.journal_upload_limits.window_started<=at_time-interval '1 hour' then at_time else family_private.journal_upload_limits.window_started end,
 upload_count=case when family_private.journal_upload_limits.window_started<=at_time-interval '1 hour' then 1 else family_private.journal_upload_limits.upload_count+1 end;
 insert into family_private.journal_photos(id,entry_id,owner_id,format,state) values(p_photo,p_entry,actor,p_format,'pending');
 return 'reserved';
end $$;
create function public.journal_photo_finish(p_photo uuid,p_success boolean) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 update family_private.journal_photos p set cleanup_after=case when p_success then p.cleanup_after else now()+interval '2 minutes' end,state=case when p_success then 'ready' else 'deleted' end where p.id=p_photo and p.owner_id=actor and p.state='pending' and exists(select 1 from family_private.journal_entries e where e.id=p.entry_id and e.owner_id=actor and e.deleted_at is null);
 return found;
end $$;
create function public.journal_photo_delete(p_photo uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 update family_private.journal_photos set cleanup_after=case when state='pending' then now()+interval '2 minutes' else now() end,state='deleted' where id=p_photo and owner_id=actor and state in ('ready','pending');
 return found;
end $$;
create function public.journal_photo_access(p_photo uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select jsonb_build_object('ownerId',p.owner_id,'id',p.id,'format',p.format) into result from family_private.journal_photos p where p.id=p_photo and p.state='ready' and family_private.journal_can_read(actor,p.entry_id);
 return result;
end $$;
create function public.journal_cleanup_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb;
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'format',p.format)),'[]'::jsonb) into result from (select id,format from family_private.journal_photos where owner_id=actor and state='deleted' and cleanup_after<=now() order by created_at limit 32) p;
 return result;
end $$;
create function public.journal_cleanup_finish(p_photo uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
 delete from family_private.journal_photos where id=p_photo and owner_id=actor and state='deleted' and cleanup_after<=now();
 return found;
end $$;
revoke all on function public.journal_list(),public.journal_save(uuid,integer,text,text,date,text),public.journal_delete(uuid,integer),public.journal_photo_reserve(uuid,uuid,text),public.journal_photo_finish(uuid,boolean),public.journal_photo_delete(uuid),public.journal_photo_access(uuid),public.journal_cleanup_list(),public.journal_cleanup_finish(uuid) from public,anon;
grant execute on function public.journal_list(),public.journal_save(uuid,integer,text,text,date,text),public.journal_delete(uuid,integer),public.journal_photo_reserve(uuid,uuid,text),public.journal_photo_finish(uuid,boolean),public.journal_photo_delete(uuid),public.journal_photo_access(uuid),public.journal_cleanup_list(),public.journal_cleanup_finish(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
