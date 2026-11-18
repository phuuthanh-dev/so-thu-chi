-- Separate family cron; leave the existing personal-ledger schedule intact.
create table family_private.recurring_errors (
  wallet_id uuid primary key references family_private.wallets(id) on delete cascade,
  failed_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table family_private.recurring_errors enable row level security;
revoke all on family_private.recurring_errors from public, anon, authenticated;

create function public.family_recurring_status() returns table(failed_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select household_id into h_id from family_private.members where user_id=actor and status='active';
  if h_id is null then raise exception 'Active membership required' using errcode='42501'; end if;
  return query select e.failed_at from family_private.recurring_errors e join family_private.wallets w on w.id=e.wallet_id
    where w.household_id=h_id and (w.owner_id=actor or w.visibility='shared') and e.resolved_at is null;
end $$;

create function public.family_run_recurring() returns integer
language plpgsql security definer set search_path = '' as $$
declare household record; wallet_row record; r jsonb; new_rules jsonb; doc_entries jsonb; due date; target date; month_start date; month_end date; anchor_day int; occurrence text; processed int:=0; wallet_processed int; today date:=((now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 hours')::date; iterations int; changed boolean;
begin
  for household in select id from family_private.households order by id for update skip locked loop
    changed:=false;
    for wallet_row in select * from family_private.wallets where household_id=household.id order by id for update loop
      begin
        wallet_processed:=0; doc_entries:=wallet_row.entries; new_rules:='[]'::jsonb;
        for r in select value from jsonb_array_elements(wallet_row.rules) loop
          if coalesce((r->>'active')::boolean,false) then
            due:=(r->>'next')::date;
            anchor_day:=least(31,greatest(1,coalesce((r->>'anchorDay')::int,extract(day from due)::int)));
            iterations:=0;
            while due<=today and iterations<120 loop
              occurrence:=(r->>'id')||':'||due::text;
              if not exists(select 1 from jsonb_array_elements(doc_entries) e where e->>'origin'=occurrence) then
                doc_entries:=doc_entries || jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'type',r->>'type','amount',r->'amount','date',due::text,'category',r->>'category','note',r->>'note','wallet',wallet_row.id::text,'createdBy',coalesce(r->>'createdBy',wallet_row.owner_id::text),'origin',occurrence));
                wallet_processed:=wallet_processed+1;
              end if;
              month_start:=(date_trunc('month',due)::date+interval '1 month')::date;
              month_end:=(month_start+interval '1 month - 1 day')::date;
              target:=month_start+(least(anchor_day,extract(day from month_end)::int)-1);
              due:=target; iterations:=iterations+1;
            end loop;
            r:=jsonb_set(jsonb_set(r,'{next}',to_jsonb(due::text)),'{anchorDay}',to_jsonb(anchor_day),true);
          end if;
          new_rules:=new_rules || jsonb_build_array(r);
        end loop;
        if doc_entries is distinct from wallet_row.entries or new_rules is distinct from wallet_row.rules then
          update family_private.wallets set entries=doc_entries,rules=new_rules where id=wallet_row.id;
          changed:=true;
        end if;
        processed:=processed+wallet_processed;
        update family_private.recurring_errors set resolved_at=now() where wallet_id=wallet_row.id and resolved_at is null;
      exception when others then
        insert into family_private.recurring_errors(wallet_id,failed_at,resolved_at) values(wallet_row.id,now(),null)
        on conflict(wallet_id) do update set failed_at=excluded.failed_at,resolved_at=null;
        raise warning 'Family recurring processing failed for a wallet: %',sqlstate;
      end;
    end loop;
    if changed then update family_private.households set version=version+1 where id=household.id; end if;
  end loop;
  return processed;
end $$;
revoke all on function public.family_run_recurring() from public, anon, authenticated;
revoke all on function public.family_recurring_status() from public, anon;
grant execute on function public.family_recurring_status() to authenticated;
select cron.schedule('nha-minh-family-recurring','*/15 * * * *','select public.family_run_recurring();');
notify pgrst, 'reload schema';
