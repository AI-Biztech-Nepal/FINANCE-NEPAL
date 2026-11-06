-- Finance feature guards, for the PORTAL database (the `finance` schema next to `core`). Not for the standalone
-- project: nothing in supabase/migrations/ runs here, and this does not run there.
--
-- Apply AFTER the portal's feature-flag migration (core.features, core.org_features, core.feature_on,
-- core.org_features(p_org)) - and after supabase/feature-backfill/finance.json has been loaded into them, or every
-- org reads as "everything off" the moment the guards are in. Rename the file to the portal's timestamp order.
--
-- What it does, for the Finance features that have data behind them (see FEATURE-INVENTORY.md):
--
--   finance.rent  ->  finance.rentals, and the daily-rent lines it writes onto ledgers
--   finance.emi   ->  finance.emi_plans
--   (finance.vehicles is display only: no table, nothing to guard here.)
--
-- 1. Row security: a switched-off feature cannot be written to, even by a direct API call. Reading stays open on
--    purpose. The rows are not deleted, the reports that add them up (rent income in the Profit & Loss) must not change
--    when someone hides a screen, and switching the feature back on restores everything with nothing lost. "Off" pauses.
-- 2. The security-definer rent sync does nothing for an org with Rent off - and in particular deletes nothing. The
--    function used to delete every `rental_wage` ledger line it did not rebuild; with the flag off it now leaves them.
-- 3. Who may call the sync. The portal's blanket "grant execute on all functions to authenticated" let any signed-in
--    user run sync_rental_wages_for(<any org id>) and read rental_wage_rows(<any org id>). Both are now service-only;
--    the app calls sync_rental_wages(), which works on the caller's own active org.
--
-- Safe to run more than once.
begin;

do $$
begin
  if to_regprocedure('core.feature_on(uuid, text)') is null then
    raise exception 'core.feature_on(uuid, text) is missing: apply the portal feature-flag migration before this one';
  end if;
  -- The policies below call it as the signed-in user.
  if not has_function_privilege('authenticated', 'core.feature_on(uuid, text)', 'execute')
     or not has_schema_privilege('authenticated', 'core', 'usage') then
    raise exception 'role authenticated cannot execute core.feature_on: grant it in the portal feature-flag migration';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Row security
-- ---------------------------------------------------------------------------------------------------------------
-- Replaces each table's one `for all` owner policy (and the admin one) with a read policy and three write policies.
-- finance_is_admin() is `select false` in the portal schema, so the admin policies match nothing today; they are
-- rebuilt the same way so they cannot become a way round the flag if that function ever returns true.
do $$
declare
  t record;
  who record;
begin
  for t in select * from (values ('rentals', 'finance.rent'), ('emi_plans', 'finance.emi')) v(tbl, feat) loop
    for who in select * from (values
      ('owner', 'owner_id = finance.finance_current_owner()'),
      ('admin', 'finance.finance_is_admin()')
    ) w(name, cond) loop
      execute format('drop policy if exists %I on finance.%I', t.tbl || '_all_' || who.name, t.tbl);
      execute format('drop policy if exists %I on finance.%I', t.tbl || '_' || who.name || '_read', t.tbl);
      execute format('drop policy if exists %I on finance.%I', t.tbl || '_' || who.name || '_insert', t.tbl);
      execute format('drop policy if exists %I on finance.%I', t.tbl || '_' || who.name || '_update', t.tbl);
      execute format('drop policy if exists %I on finance.%I', t.tbl || '_' || who.name || '_delete', t.tbl);

      execute format('create policy %I on finance.%I for select using (%s)',
                     t.tbl || '_' || who.name || '_read', t.tbl, who.cond);
      execute format('create policy %I on finance.%I for insert with check (%s and core.feature_on(owner_id, %L))',
                     t.tbl || '_' || who.name || '_insert', t.tbl, who.cond, t.feat);
      execute format('create policy %I on finance.%I for update using (%s and core.feature_on(owner_id, %L)) with check (%s and core.feature_on(owner_id, %L))',
                     t.tbl || '_' || who.name || '_update', t.tbl, who.cond, t.feat, who.cond, t.feat);
      execute format('create policy %I on finance.%I for delete using (%s and core.feature_on(owner_id, %L))',
                     t.tbl || '_' || who.name || '_delete', t.tbl, who.cond, t.feat);
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. The rent sync
-- ---------------------------------------------------------------------------------------------------------------
-- p_owner = one org, or null for every org (a nightly job). Only orgs with finance.rent on are touched; for any other
-- org the function returns before it reads or writes a ledger. core.feature_on also says "off" for an org whose
-- Finance service is suspended or whose trial has ended, so those pause too.
create or replace function finance.sync_rental_wages_for(p_owner uuid) returns void
    language plpgsql security definer
    set search_path to 'finance'
as $$
declare
  v_orgs uuid[];
begin
  select coalesce(array_agg(c.org), '{}') into v_orgs
    from (select r.owner_id as org from finance.rentals r
           where p_owner is null or r.owner_id = p_owner
          union
          select l.owner_id from finance.customer_ledger_entries l
           where l.source_type = 'rental_wage' and (p_owner is null or l.owner_id = p_owner)) c
   where core.feature_on(c.org, 'finance.rent');
  if cardinality(v_orgs) = 0 then return; end if;

  delete from finance.vendor_ledger_entries v
   where v.source_type = 'rental_wage' and v.owner_id = any (v_orgs);
  delete from finance.customer_ledger_entries c
   where c.source_type = 'rental_wage'
     and c.owner_id = any (v_orgs)
     and (c.source_id, c.customer_id) not in (select w.source_id, w.employee_id from finance.rental_wage_rows(p_owner) w);
  insert into finance.customer_ledger_entries (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id, entry_date)
  select w.employee_id, w.owner_id, 'debit', w.amount, w.note, 'booking', 'rental_wage', w.source_id, w.day
    from finance.rental_wage_rows(p_owner) w
   where w.owner_id = any (v_orgs)
  on conflict (source_type, source_id) where source_type is not null and source_id is not null
  do update set amount = excluded.amount, customer_id = excluded.customer_id, note = excluded.note, entry_date = excluded.entry_date;
end $$;

-- What the app calls (useRentalWageSync). It used to pass auth.uid() - a USER id - where every owner_id now holds an ORG
-- id, so for anyone whose org id differs from their user id (staff, multi-org owners) it matched nothing. It works on
-- the caller's active org, the same one every other Finance policy uses.
create or replace function finance.sync_rental_wages() returns void
    language plpgsql security definer
    set search_path to 'finance'
as $$
declare
  v_org uuid := finance.finance_current_owner();
begin
  if v_org is null then return; end if;
  perform finance.sync_rental_wages_for(v_org);
end $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Who may call them
-- ---------------------------------------------------------------------------------------------------------------
revoke execute on function finance.sync_rental_wages_for(uuid) from public, anon, authenticated;
revoke execute on function finance.rental_wage_rows(uuid) from public, anon, authenticated;
grant execute on function finance.sync_rental_wages_for(uuid) to service_role, finance_svc;
grant execute on function finance.rental_wage_rows(uuid) to service_role, finance_svc;
revoke execute on function finance.sync_rental_wages() from public, anon;
grant execute on function finance.sync_rental_wages() to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
