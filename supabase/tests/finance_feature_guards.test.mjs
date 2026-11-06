// supabase/tests/finance_feature_guards.test.mjs
//
// Tests supabase/portal/20261107000000_finance_feature_guards.sql against a throwaway Postgres (PGlite), the way the
// portal's own supabase/tests run. Run with:   node --test supabase/tests/finance_feature_guards.test.mjs
// (needs @electric-sql/pglite; the portal repo already has it - this file is meant to move there with the migration).
//
// The fixture below is a minimal stand-in for the portal database: `core` with a feature_on that follows the brief's
// contract (an org row wins, else the catalogue default, else off), and the `finance` objects the migration touches,
// with the three sync functions and the policies copied from the portal's 20261030000000_finance_init.sql as they are
// today - so the test starts from what is really deployed, then applies the migration on top.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const BACKFILL = JSON.parse(readFileSync(new URL('../feature-backfill/finance.json', import.meta.url), 'utf8'));

const MIGRATION = readFileSync(new URL('../portal/20261107000000_finance_feature_guards.sql', import.meta.url), 'utf8');

const ORG_A = '00000000-0000-0000-0000-00000000000a';
const ORG_B = '00000000-0000-0000-0000-00000000000b';
const USER_A = '00000000-0000-0000-0000-0000000000a1';
const USER_B = '00000000-0000-0000-0000-0000000000b1';
const CUST_A = '00000000-0000-0000-0000-00000000c0a1';
const CUST_B = '00000000-0000-0000-0000-00000000c0b1';

const FIXTURE_BASE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin; create role finance_svc nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;

  create schema core;
  create table core.organizations (id uuid primary key, slug text, name text);
  create table core.profiles (user_id uuid primary key, active_org_id uuid);
  create table core.service_roles (org_id uuid, user_id uuid, service_key text, role text);
  create table core.features (key text primary key, default_on boolean not null default true);
  create table core.org_features (org_id uuid, feature_key text, enabled boolean, primary key (org_id, feature_key));
  insert into core.features values ('finance.vehicles', false), ('finance.rent', false), ('finance.emi', false);

  create schema finance;
  create function finance.finance_current_owner() returns uuid language sql stable security definer set search_path = '' as $$
    select p.active_org_id from core.profiles p
    where p.user_id = auth.uid()
      and exists (select 1 from core.service_roles r where r.org_id = p.active_org_id and r.user_id = p.user_id and r.service_key = 'finance')
  $$;
  create function finance.finance_is_admin() returns boolean language sql stable as $$ select false $$;

  create table finance.org_settings (org_id uuid primary key, sells_vehicles boolean not null default false);
  create table finance.customers (id uuid primary key, owner_id uuid not null);
  create table finance.rentals (
    id uuid primary key default gen_random_uuid(), owner_id uuid not null, car text not null, customer_id uuid references finance.customers(id) on delete set null,
    start_date date not null, returned_on date, rate_per_day numeric not null default 0, wage_per_day numeric not null default 0, employee_id uuid);
  create table finance.emi_plans (id uuid primary key default gen_random_uuid(), owner_id uuid not null, car text not null);
  create table finance.customer_ledger_entries (
    id uuid primary key default gen_random_uuid(), customer_id uuid not null, owner_id uuid not null, entry_type text, amount numeric, note text,
    source text, source_type text, source_id uuid, entry_date date);
  create unique index on finance.customer_ledger_entries (source_type, source_id) where source_type is not null and source_id is not null;
  create table finance.vendor_ledger_entries (
    id uuid primary key default gen_random_uuid(), vendor_id uuid, owner_id uuid not null, entry_type text, amount numeric, note text,
    source text, source_type text, source_id uuid, entry_date date);

  -- Copied from the portal's finance_init (the live definitions this migration replaces).
  create function finance.rental_wage_rows(p_owner uuid) returns table(owner_id uuid, employee_id uuid, day date, amount numeric, note text, source_id uuid)
      language sql stable security definer set search_path to 'finance' as $$
    select r.owner_id, r.customer_id, d::date, r.rate_per_day,
           'Daily rent · ' || r.car,
           md5('rental_wage:' || r.id::text || ':' || d::date::text)::uuid
      from finance.rentals r
     cross join lateral generate_series(
             r.start_date,
             least(coalesce(r.returned_on, (now() at time zone 'Asia/Kathmandu')::date), (now() at time zone 'Asia/Kathmandu')::date),
             interval '1 day') d
     where r.customer_id is not null and r.rate_per_day > 0
       and (p_owner is null or r.owner_id = p_owner)
  $$;
  create function finance.sync_rental_wages() returns void language plpgsql security definer set search_path to 'finance' as $$
  begin
    if auth.uid() is null then return; end if;
    perform finance.sync_rental_wages_for(auth.uid());
  end $$;
  create function finance.sync_rental_wages_for(p_owner uuid) returns void language plpgsql security definer set search_path to 'finance' as $$
  begin
    delete from finance.vendor_ledger_entries v
     where v.source_type = 'rental_wage' and (p_owner is null or v.owner_id = p_owner);
    delete from finance.customer_ledger_entries c
     where c.source_type = 'rental_wage'
       and (p_owner is null or c.owner_id = p_owner)
       and (c.source_id, c.customer_id) not in (select w.source_id, w.employee_id from finance.rental_wage_rows(p_owner) w);
    insert into finance.customer_ledger_entries (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id, entry_date)
    select w.employee_id, w.owner_id, 'debit', w.amount, w.note, 'booking', 'rental_wage', w.source_id, w.day
      from finance.rental_wage_rows(p_owner) w
    on conflict (source_type, source_id) where source_type is not null and source_id is not null
    do update set amount = excluded.amount, customer_id = excluded.customer_id, note = excluded.note, entry_date = excluded.entry_date;
  end $$;

  alter table finance.rentals enable row level security;
  create policy rentals_all_owner on finance.rentals using (owner_id = finance.finance_current_owner()) with check (owner_id = finance.finance_current_owner());
  create policy rentals_admin_all on finance.rentals using (finance.finance_is_admin()) with check (finance.finance_is_admin());
  alter table finance.emi_plans enable row level security;
  create policy emi_plans_all_owner on finance.emi_plans using (owner_id = finance.finance_current_owner()) with check (owner_id = finance.finance_current_owner());
  create policy emi_plans_admin_all on finance.emi_plans using (finance.finance_is_admin()) with check (finance.finance_is_admin());
  alter table finance.customer_ledger_entries enable row level security;
  create policy cle_owner on finance.customer_ledger_entries using (owner_id = finance.finance_current_owner());

  -- The portal's finance_init ends with these blanket grants (the reason for part 3 of the migration).
  grant usage on schema finance to authenticated, service_role;
  grant all on all tables in schema finance to authenticated, service_role;
  grant execute on all functions in schema finance to authenticated, service_role;

  insert into core.profiles values ('${USER_A}', '${ORG_A}'), ('${USER_B}', '${ORG_B}');
  insert into core.service_roles values ('${ORG_A}', '${USER_A}', 'finance', 'admin'), ('${ORG_B}', '${USER_B}', 'finance', 'admin');
  insert into finance.customers values ('${CUST_A}', '${ORG_A}'), ('${CUST_B}', '${ORG_B}');
`;

// The contract's feature_on, reduced: an org row wins, else the catalogue's default_on, else off. (The real one also
// checks the org's service is live and the feature's `requires`; the portal tests that.)
const FEATURE_ON = `
  create function core.feature_on(p_org uuid, p_feature text) returns boolean language sql stable security definer set search_path = '' as $$
    select coalesce((select o.enabled from core.org_features o where o.org_id = p_org and o.feature_key = p_feature),
                    (select f.default_on from core.features f where f.key = p_feature), false)
  $$;
  grant usage on schema core to authenticated;
  grant execute on function core.feature_on(uuid, text) to authenticated;
`;

let db;

async function asUser(userId, fn) {
  await db.exec(`set role authenticated; set test.uid = '${userId}'`);
  try { return await fn(); } finally { await db.exec(`reset role; reset test.uid`); }
}
const setFlag = (org, key, enabled) => db.query(
  'insert into core.org_features values ($1, $2, $3) on conflict (org_id, feature_key) do update set enabled = excluded.enabled', [org, key, enabled]);
const count = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
const rentLines = (org) => count(`select count(*) n from finance.customer_ledger_entries where source_type = 'rental_wage' and owner_id = $1`, [org]);
const yesterday = `(now() at time zone 'Asia/Kathmandu')::date - 2`;

before(async () => {
  db = new PGlite();
  await db.exec(FIXTURE_BASE);
});

test('the migration refuses to run before the portal feature migration', async () => {
  await assert.rejects(db.exec(MIGRATION), /core\.feature_on\(uuid, text\) is missing/);
  await db.exec('rollback'); // the migration opened its own transaction; a real session would end here and roll it back
  // the failed run left nothing half-applied
  assert.equal(await count(`select count(*) n from pg_policies where tablename = 'rentals' and policyname = 'rentals_owner_read'`), 0);
});

test('migration applies, and applies twice', async () => {
  await db.exec(FEATURE_ON);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
});

test('missing flag falls back to the catalogue default (off): writes are refused, reads are not', async () => {
  await db.query(`insert into finance.rentals (owner_id, car, customer_id, start_date, rate_per_day) values ($1, 'seeded', $2, ${yesterday}, 100)`, [ORG_A, CUST_A]);
  await asUser(USER_A, async () => {
    await assert.rejects(db.query(`insert into finance.rentals (owner_id, car, start_date) values ($1, 'x', current_date)`, [ORG_A]), /row-level security/);
    await assert.rejects(db.query(`insert into finance.emi_plans (owner_id, car) values ($1, 'x')`, [ORG_A]), /row-level security/);
    assert.equal(await count('select count(*) n from finance.rentals'), 1, 'the seeded rental is still readable');
    const upd = await db.query(`update finance.rentals set car = 'renamed'`);
    assert.equal(upd.affectedRows, 0, 'update touches nothing');
    const del = await db.query(`delete from finance.rentals`);
    assert.equal(del.affectedRows, 0, 'delete touches nothing');
  });
  assert.equal(await count('select count(*) n from finance.rentals'), 1);
});

test('catalogue default_on = true lets an org with no row through', async () => {
  await db.query(`update core.features set default_on = true where key = 'finance.emi'`);
  await asUser(USER_A, async () => {
    await db.query(`insert into finance.emi_plans (owner_id, car) values ($1, 'honda')`, [ORG_A]);
  });
  await db.query(`update core.features set default_on = false where key = 'finance.emi'`);
  await db.query(`delete from finance.emi_plans`);
});

test('flag on: rentals can be added, changed and removed; emi stays separate', async () => {
  await setFlag(ORG_A, 'finance.rent', true);
  await asUser(USER_A, async () => {
    await db.query(`insert into finance.rentals (owner_id, car, start_date) values ($1, 'new', current_date)`, [ORG_A]);
    assert.equal((await db.query(`update finance.rentals set car = 'edited' where car = 'new'`)).affectedRows, 1);
    assert.equal((await db.query(`delete from finance.rentals where car = 'edited'`)).affectedRows, 1);
    await assert.rejects(db.query(`insert into finance.emi_plans (owner_id, car) values ($1, 'x')`, [ORG_A]), /row-level security/, 'rent on does not open emi');
  });
  await setFlag(ORG_A, 'finance.emi', true);
  await asUser(USER_A, async () => {
    await db.query(`insert into finance.emi_plans (owner_id, car) values ($1, 'honda')`, [ORG_A]);
  });
});

test("an org cannot write into another org's rentals, flag or not", async () => {
  await setFlag(ORG_B, 'finance.rent', true);
  await asUser(USER_B, async () => {
    await assert.rejects(db.query(`insert into finance.rentals (owner_id, car, start_date) values ($1, 'x', current_date)`, [ORG_A]), /row-level security/);
    assert.equal(await count('select count(*) n from finance.rentals'), 0, 'org B sees none of org A rentals');
  });
});

test('sync: flag on writes the daily rent lines onto the renter ledger, through the app entry point', async () => {
  assert.equal(await rentLines(ORG_A), 0);
  await asUser(USER_A, () => db.query('select finance.sync_rental_wages()'));
  assert.equal(await rentLines(ORG_A), 3, 'three days at 100 (two days ago, yesterday, today)');
  assert.equal(await count(`select sum(amount) n from finance.customer_ledger_entries where owner_id = $1`, [ORG_A]), 300);
});

test('sync: flag off pauses it - nothing is deleted, nothing is added', async () => {
  await setFlag(ORG_A, 'finance.rent', false);
  // change the rental so a running sync would rewrite the lines: it is returned yesterday, so only 2 lines are due
  await db.query(`update finance.rentals set returned_on = ${yesterday} + 1 where car = 'seeded'`);
  await asUser(USER_A, () => db.query('select finance.sync_rental_wages()'));
  await db.query('select finance.sync_rental_wages_for($1)', [ORG_A]);
  await db.query('select finance.sync_rental_wages_for(null)');
  assert.equal(await rentLines(ORG_A), 3, 'the three lines are all still there');
  // the legacy vendor lines the old function wiped on every run are left alone too
  await db.query(`insert into finance.vendor_ledger_entries (vendor_id, owner_id, source_type, source_id, amount) values ($1, $2, 'rental_wage', gen_random_uuid(), 5)`, [CUST_A, ORG_A]);
  await db.query('select finance.sync_rental_wages_for(null)');
  assert.equal(await count(`select count(*) n from finance.vendor_ledger_entries where owner_id = $1`, [ORG_A]), 1);
});

test('sync: switched back on, it catches up and the books match the rentals again', async () => {
  await setFlag(ORG_A, 'finance.rent', true);
  await asUser(USER_A, () => db.query('select finance.sync_rental_wages()'));
  assert.equal(await rentLines(ORG_A), 2, 'returned yesterday: two days are due, the stale one is removed');
  assert.equal(await count(`select count(*) n from finance.vendor_ledger_entries where owner_id = $1`, [ORG_A]), 0, 'legacy vendor lines go as before');
});

test('sync for every org (null) only touches the orgs that have Rent on', async () => {
  await db.query(`insert into finance.rentals (owner_id, car, customer_id, start_date, rate_per_day) values ($1, 'b-car', $2, ${yesterday}, 50)`, [ORG_B, CUST_B]);
  await setFlag(ORG_B, 'finance.rent', false);
  await db.query('select finance.sync_rental_wages_for(null)');
  assert.equal(await rentLines(ORG_B), 0, 'org B has Rent off');
  await setFlag(ORG_B, 'finance.rent', true);
  await db.query('select finance.sync_rental_wages_for(null)');
  assert.equal(await rentLines(ORG_B), 3);
  assert.equal(await rentLines(ORG_A), 2);
});

test('a suspended service or ended trial (feature_on false for everything) pauses the sync too', async () => {
  // what core.feature_on does when the org's service is not live: false for every feature, whatever its row says
  await db.exec(`create or replace function core.feature_on(p_org uuid, p_feature text) returns boolean language sql stable as $$ select false $$`);
  await db.query(`update finance.rentals set returned_on = null where car = 'seeded'`);
  await db.query('select finance.sync_rental_wages_for(null)');
  assert.equal(await rentLines(ORG_A), 2, 'unchanged');
  await db.exec(FEATURE_ON.replace('create function', 'create or replace function'));
});

test('signed-in users cannot run the sync for someone else, or read another org\'s rent rows', async () => {
  await asUser(USER_A, async () => {
    await assert.rejects(db.query('select finance.sync_rental_wages_for($1)', [ORG_B]), /permission denied/);
    await assert.rejects(db.query('select * from finance.rental_wage_rows($1)', [ORG_B]), /permission denied/);
    await db.query('select finance.sync_rental_wages()'); // their own, through the entry point, still works
  });
});

test('the app entry point uses the active org, not the user id', async () => {
  // org A's user id differs from the org id; before the fix auth.uid() was passed and nothing matched
  assert.notEqual(USER_A, ORG_A);
  await db.query(`delete from finance.customer_ledger_entries where owner_id = $1`, [ORG_A]);
  await asUser(USER_A, () => db.query('select finance.sync_rental_wages()'));
  assert.ok((await rentLines(ORG_A)) > 0);
});

test('the backfill list for the portal: its queries run, pick the right orgs, and load into the flags', async () => {
  const ORG_C = '00000000-0000-0000-0000-00000000000c'; // vehicle account by name only
  const ORG_D = '00000000-0000-0000-0000-00000000000d'; // switched on in org_settings
  const ORG_E = '00000000-0000-0000-0000-00000000000e'; // plain store with an EMI plan on file
  const ORG_F = '00000000-0000-0000-0000-00000000000f'; // plain store, nothing
  await db.exec(`
    delete from core.org_features; delete from finance.rentals; delete from finance.emi_plans;
    insert into core.organizations values
      ('${ORG_A}', 'deeva-auto-enterprises', 'Deeva Auto Enterprises'),
      ('${ORG_B}', 'hamro-store', 'Hamro Store'),
      ('${ORG_C}', 'deva-auto', 'Deva Auto'),
      ('${ORG_D}', 'rolling-wheels', 'Rolling Wheels'),
      ('${ORG_E}', 'corner-shop', 'Corner Shop'),
      ('${ORG_F}', 'medeva-autos', 'Medeva Autos');
    insert into finance.org_settings values ('${ORG_D}', true), ('${ORG_B}', false);
    insert into finance.emi_plans (owner_id, car) values ('${ORG_E}', 'honda');
  `);

  // what the portal migration does with the file: slugs first, then each rule's query
  const wanted = new Map(); // org id -> Set of keys
  const add = (org, keys) => wanted.set(org, new Set([...(wanted.get(org) ?? []), ...keys]));
  for (const [slug, keys] of Object.entries(BACKFILL.backfill.orgs)) {
    const org = (await db.query('select id from core.organizations where slug = $1', [slug])).rows[0];
    assert.ok(org, `slug ${slug} exists`);
    add(org.id, keys);
  }
  for (const rule of BACKFILL.backfill.also_on) {
    for (const r of (await db.query(rule.org_ids_sql)).rows) add(Object.values(r)[0], rule.features);
  }
  for (const [org, keys] of wanted) for (const key of keys) await setFlag(org, key, true);

  const on = async (org, key) => (await db.query('select core.feature_on($1, $2) v', [org, key])).rows[0].v;
  for (const key of ['finance.vehicles', 'finance.rent', 'finance.emi']) {
    assert.equal(await on(ORG_A, key), true, `Deeva has ${key}`);
    assert.equal(await on(ORG_C, key), true, `"Deva Auto" (the name match) has ${key}`);
    assert.equal(await on(ORG_D, key), true, `sells_vehicles org has ${key}`);
    assert.equal(await on(ORG_B, key), false, `a plain store has no ${key}`);
    assert.equal(await on(ORG_F, key), false, `"Medeva Autos" is not Deeva: no ${key}`);
  }
  assert.equal(await on(ORG_E, 'finance.emi'), true, 'an org with an EMI plan keeps EMI');
  assert.equal(await on(ORG_E, 'finance.rent'), false);
  assert.equal(await on(ORG_E, 'finance.vehicles'), false);
});
