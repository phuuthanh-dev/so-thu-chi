-- Creation time is assigned by the database only to newly created records.
-- Existing transactions without a timestamp remain unchanged; no guessed backfill.
create function family_private.transaction_creation_time() returns text
language sql volatile set search_path='' as $$
  select pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
$$;
revoke all on function family_private.transaction_creation_time() from public, anon, authenticated;

-- Preserve original metadata for existing entries, even when older clients omit it.
create function family_private.stamp_personal_entries(incoming jsonb, previous jsonb) returns jsonb
language plpgsql volatile set search_path='' as $$
declare entry_item jsonb; old_entry jsonb; next_entry jsonb; prior_by_id jsonb; result jsonb:='[]'::jsonb;
begin
  select coalesce(jsonb_object_agg(e.value->>'id',e.value order by e.ordinality desc),'{}'::jsonb) into prior_by_id
    from jsonb_array_elements(case when jsonb_typeof(previous)='array' then previous else '[]'::jsonb end) with ordinality e(value,ordinality)
    where jsonb_typeof(e.value->'id')='string' and length(e.value->>'id')>0;
  for entry_item in select value from jsonb_array_elements(incoming) loop
    if jsonb_typeof(entry_item)='object' and jsonb_typeof(entry_item->'id')='string' and length(entry_item->>'id')>0 then
      old_entry:=prior_by_id->(entry_item->>'id');
      next_entry:=entry_item - 'createdAt';
      if old_entry ? 'createdAt' then next_entry:=next_entry || jsonb_build_object('createdAt',old_entry->'createdAt');
      elsif old_entry is null then next_entry:=next_entry || jsonb_build_object('createdAt',family_private.transaction_creation_time()); end if;
    else next_entry:=entry_item;
    end if;
    result:=result || jsonb_build_array(next_entry);
  end loop;
  return result;
end $$;
revoke all on function family_private.stamp_personal_entries(jsonb,jsonb) from public, anon, authenticated;

create or replace function public.save_ledger(expected_version bigint, new_data jsonb)
returns table(version bigint, data jsonb)
language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); previous_data jsonb;
begin
  if owner is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if jsonb_typeof(new_data) <> 'object'
     or jsonb_typeof(new_data->'entries') is distinct from 'array'
     or jsonb_typeof(new_data->'wallets') is distinct from 'array'
     or jsonb_typeof(new_data->'rules') is distinct from 'array'
     or jsonb_typeof(new_data->'categories') is distinct from 'object'
     or jsonb_typeof(new_data->'budgets') is distinct from 'object'
     or octet_length(new_data::text)>2000000 then raise exception 'Invalid ledger' using errcode='22023'; end if;
  select l.data into previous_data from public.ledgers l where l.owner_id=owner and l.version=expected_version for update;
  if not found then return; end if;
  new_data:=jsonb_set(new_data,'{entries}',family_private.stamp_personal_entries(new_data->'entries',previous_data->'entries'));
  return query update public.ledgers l set data=new_data,version=l.version+1,updated_at=now()
    where l.owner_id=owner and l.version=expected_version returning l.version,l.data;
end $$;

create or replace function public.family_save_ledger(expected_version bigint, new_data jsonb)
returns table(version bigint, data jsonb)
language plpgsql security definer set search_path = '' as $$
declare actor uuid:=auth.uid(); h_id uuid; current_version bigint; wallet_item jsonb; wallet_id uuid; wallet_owner uuid; old_wallet family_private.wallets%rowtype; prior_entries jsonb; prior_rules jsonb; wallet_ids uuid[]:='{}'; entry_item jsonb; rule_item jsonb; old_entry jsonb; old_rule jsonb; next_entry jsonb; entry_list jsonb; rule_list jsonb;
begin
  if actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  select household_id into h_id from family_private.members where user_id=actor and status='active';
  if h_id is null then raise exception 'Active membership required' using errcode='42501'; end if;
  select h.version into current_version from family_private.households h where h.id=h_id for update;
  if not exists(select 1 from family_private.members where household_id=h_id and user_id=actor and status='active') then raise exception 'Active membership required' using errcode='42501'; end if;
  if current_version is distinct from expected_version then return; end if;
  if jsonb_typeof(new_data) is distinct from 'object' or jsonb_typeof(new_data->'wallets') is distinct from 'array'
     or jsonb_typeof(new_data->'entries') is distinct from 'array' or jsonb_typeof(new_data->'rules') is distinct from 'array'
     or jsonb_typeof(new_data->'categories') is distinct from 'object' or jsonb_typeof(new_data->'budgets') is distinct from 'object'
     or octet_length(new_data::text)>2000000 then raise exception 'Invalid family data' using errcode='22023'; end if;
  select coalesce(jsonb_agg(e.value),'[]'::jsonb) into prior_entries from family_private.wallets w cross join lateral jsonb_array_elements(w.entries) e where w.household_id=h_id and (w.visibility='shared' or w.owner_id=actor);
  select coalesce(jsonb_agg(r.value),'[]'::jsonb) into prior_rules from family_private.wallets w cross join lateral jsonb_array_elements(w.rules) r where w.household_id=h_id and (w.visibility='shared' or w.owner_id=actor);
  if (select count(*) <> count(distinct x.value->>'id') from jsonb_array_elements(new_data->'entries') x)
     or (select count(*) <> count(distinct x.value->>'id') from jsonb_array_elements(new_data->'rules') x) then raise exception 'Duplicate record ID' using errcode='22023'; end if;
  for wallet_item in select value from jsonb_array_elements(new_data->'wallets') loop
    begin wallet_id:=(wallet_item->>'id')::uuid; wallet_owner:=(wallet_item->>'ownerId')::uuid; exception when others then raise exception 'Invalid wallet' using errcode='22023'; end;
    if wallet_id is null or wallet_owner is null or wallet_id=any(wallet_ids) or coalesce(wallet_item->>'visibility','') not in ('shared','private')
       or jsonb_typeof(wallet_item->'name') is distinct from 'string' or length(btrim(wallet_item->>'name'))=0
       or jsonb_typeof(wallet_item->'balance') is distinct from 'number'
       or (wallet_item ? 'note' and jsonb_typeof(wallet_item->'note') <> 'string') then raise exception 'Invalid wallet' using errcode='22023'; end if;
    wallet_ids:=array_append(wallet_ids,wallet_id);
    select * into old_wallet from family_private.wallets where id=wallet_id and household_id=h_id for update;
    if found then
      if old_wallet.visibility <> 'shared' and old_wallet.owner_id <> actor then raise exception 'Wallet not available' using errcode='42501'; end if;
      if old_wallet.owner_id <> actor and (wallet_owner<>old_wallet.owner_id or wallet_item->>'visibility'<>old_wallet.visibility or (wallet_item - 'id' - 'ownerId' - 'visibility') is distinct from old_wallet.wallet) then raise exception 'Only the wallet owner can change wallet settings' using errcode='42501'; end if;
      if not exists(select 1 from family_private.members where household_id=h_id and user_id=wallet_owner and status='active') then raise exception 'Invalid wallet owner' using errcode='42501'; end if;
    else
      if wallet_owner<>actor then raise exception 'New wallets must belong to their creator' using errcode='42501'; end if;
      if exists(select 1 from family_private.wallets where id=wallet_id) then raise exception 'Wallet not available' using errcode='42501'; end if;
    end if;
  end loop;
  for entry_item in select value from jsonb_array_elements(new_data->'entries') loop
    if jsonb_typeof(entry_item->'id') is distinct from 'string' or length(entry_item->>'id')=0
       or jsonb_typeof(entry_item->'amount') is distinct from 'number' or (entry_item->>'amount')::numeric<=0
       or coalesce(entry_item->>'type','') not in ('income','expense') or jsonb_typeof(entry_item->'category') is distinct from 'string'
       or coalesce(entry_item->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or not exists(select 1 from unnest(wallet_ids) id where id::text=entry_item->>'wallet') then raise exception 'Invalid transaction' using errcode='22023'; end if;
  end loop;
  for rule_item in select value from jsonb_array_elements(new_data->'rules') loop
    if jsonb_typeof(rule_item->'id') is distinct from 'string' or length(rule_item->>'id')=0
       or jsonb_typeof(rule_item->'amount') is distinct from 'number' or (rule_item->>'amount')::numeric<=0
       or coalesce(rule_item->>'type','') not in ('income','expense') or jsonb_typeof(rule_item->'category') is distinct from 'string'
       or coalesce(rule_item->>'next','') !~ '^\d{4}-\d{2}-\d{2}$' or jsonb_typeof(rule_item->'active') is distinct from 'boolean'
       or not exists(select 1 from unnest(wallet_ids) id where id::text=rule_item->>'wallet') then raise exception 'Invalid recurring rule' using errcode='22023'; end if;
  end loop;
  for old_wallet in select * from family_private.wallets where household_id=h_id and (visibility='shared' or owner_id=actor) and not(id=any(wallet_ids)) loop
    if old_wallet.owner_id<>actor or jsonb_array_length(old_wallet.entries)>0 or jsonb_array_length(old_wallet.rules)>0 then raise exception 'Wallet must be archived instead' using errcode='42501'; end if;
    delete from family_private.wallets where id=old_wallet.id;
  end loop;
  for wallet_item in select value from jsonb_array_elements(new_data->'wallets') loop
    wallet_id:=(wallet_item->>'id')::uuid; wallet_owner:=(wallet_item->>'ownerId')::uuid; entry_list:='[]'::jsonb; rule_list:='[]'::jsonb;
    for entry_item in select value from jsonb_array_elements(new_data->'entries') where value->>'wallet'=wallet_id::text loop
      select e.value into old_entry from jsonb_array_elements(prior_entries) e where e.value->>'id'=entry_item->>'id' limit 1;
      next_entry:=(entry_item - 'createdBy' - 'origin' - 'createdAt') || jsonb_build_object('createdBy',coalesce(old_entry->>'createdBy',actor::text));
      if old_entry ? 'createdAt' then next_entry:=next_entry || jsonb_build_object('createdAt',old_entry->'createdAt');
      elsif old_entry is null then next_entry:=next_entry || jsonb_build_object('createdAt',family_private.transaction_creation_time()); end if;
      if old_entry ? 'origin' then next_entry:=next_entry || jsonb_build_object('origin',old_entry->'origin'); end if;
      entry_list:=entry_list || jsonb_build_array(next_entry);
    end loop;
    for rule_item in select value from jsonb_array_elements(new_data->'rules') where value->>'wallet'=wallet_id::text loop
      select r.value into old_rule from jsonb_array_elements(prior_rules) r where r.value->>'id'=rule_item->>'id' limit 1;
      rule_list:=rule_list || jsonb_build_array((rule_item - 'createdBy') || jsonb_build_object('createdBy',coalesce(old_rule->>'createdBy',actor::text)));
    end loop;
    update family_private.wallets set owner_id=wallet_owner,visibility=wallet_item->>'visibility',wallet=wallet_item - 'id' - 'ownerId' - 'visibility',entries=entry_list,rules=rule_list
      where id=wallet_id and household_id=h_id;
    if not found then
      insert into family_private.wallets(id,household_id,owner_id,visibility,wallet,entries,rules)
      values(wallet_id,h_id,wallet_owner,wallet_item->>'visibility',wallet_item - 'id' - 'ownerId' - 'visibility',entry_list,rule_list);
    end if;
  end loop;
  update family_private.member_settings set categories=new_data->'categories',budgets=new_data->'budgets' where household_id=h_id and user_id=actor;
  update family_private.households h set version=h.version+1 where id=h_id;
  return query select * from public.family_open_ledger();
end $$;

create or replace function public.run_recurring_ledgers() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ledger record; r jsonb; new_rules jsonb; doc jsonb; due date; target date;
  month_start date; month_end date; anchor_day int; origin text; processed int := 0; ledger_processed int;
  -- Daily retries begin at 07:00 Vietnam time, consistent with the old schedule.
  today date := ((now() at time zone 'Asia/Ho_Chi_Minh') - interval '7 hours')::date;
  iterations int;
begin
  for ledger in select * from public.ledgers order by owner_id for update skip locked loop
    begin
      ledger_processed := 0;
      doc := ledger.data; new_rules := '[]'::jsonb;
      for r in select value from jsonb_array_elements(doc->'rules') loop
        if coalesce((r->>'active')::boolean, false) then
          due := (r->>'next')::date;
          anchor_day := least(31, greatest(1, coalesce((r->>'anchorDay')::int, extract(day from due)::int)));
          iterations := 0;
          while due <= today and iterations < 120 loop
            origin := (r->>'id') || ':' || due::text;
            if not exists (select 1 from jsonb_array_elements(doc->'entries') e where e->>'origin' = origin) then
              doc := jsonb_set(doc, '{entries}', (doc->'entries') || jsonb_build_array(jsonb_build_object(
                'id', gen_random_uuid()::text, 'type', r->>'type', 'amount', r->'amount',
                'date', due::text, 'category', r->>'category', 'note', r->>'note',
                'wallet', r->>'wallet', 'origin', origin, 'createdAt', family_private.transaction_creation_time())));
              ledger_processed := ledger_processed + 1;
            end if;
            month_start := (date_trunc('month', due)::date + interval '1 month')::date;
            month_end := (month_start + interval '1 month - 1 day')::date;
            target := month_start + (least(anchor_day, extract(day from month_end)::int) - 1);
            due := target; iterations := iterations + 1;
          end loop;
          r := jsonb_set(jsonb_set(r, '{next}', to_jsonb(due::text)), '{anchorDay}', to_jsonb(anchor_day), true);
        end if;
        new_rules := new_rules || jsonb_build_array(r);
      end loop;
      doc := jsonb_set(doc, '{rules}', new_rules);
      if doc is distinct from ledger.data then
        update public.ledgers set data = doc, version = ledgers.version + 1, updated_at = now() where owner_id = ledger.owner_id;
      end if;
      update public.recurring_job_errors set resolved_at = now()
        where owner_id = ledger.owner_id and resolved_at is null;
      processed := processed + ledger_processed;
    exception when others then
      insert into public.recurring_job_errors(owner_id, error_code, failed_at, resolved_at)
        values (ledger.owner_id, sqlstate, now(), null)
        on conflict (owner_id) do update set error_code = excluded.error_code,
          failed_at = excluded.failed_at, resolved_at = null;
      raise warning 'Recurring processing failed for one ledger: %', sqlstate;
    end;
  end loop;
  return processed;
end $$;

create or replace function public.family_run_recurring() returns integer
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
                doc_entries:=doc_entries || jsonb_build_array(jsonb_build_object('id',gen_random_uuid()::text,'type',r->>'type','amount',r->'amount','date',due::text,'category',r->>'category','note',r->>'note','wallet',wallet_row.id::text,'createdBy',coalesce(r->>'createdBy',wallet_row.owner_id::text),'origin',occurrence,'createdAt',family_private.transaction_creation_time()));
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

notify pgrst,'reload schema';
