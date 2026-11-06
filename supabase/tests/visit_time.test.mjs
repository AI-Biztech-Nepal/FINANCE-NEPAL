// Tests for supabase/migrations/0031_visit_time.sql, run against a real Postgres (PGlite) with 0030_marketing.sql under it.
//
//   npm i --no-save @electric-sql/pglite     (not a project dependency)
//   node --test supabase/tests/visit_time.test.mjs
//
// Supabase's own pieces that 0030 leans on (auth.users, the roles, finance_current_owner) are stubbed below; the SQL
// under test is the real files.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const view = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

let db;

/** Run as the signed-in company (row level security applies), then go back to the superuser. */
async function asUser(owner, fn) {
  await db.exec(`select set_config('app.owner', '${owner}', false); set role authenticated;`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role;');
  }
}
const list = async (owner, from = '2000-01-01', to = '2100-01-01', limit = 100) =>
  asUser(owner, async () => (await db.query('select public.visits_list($1, $2, $3) as r', [from, to, limit])).rows[0].r);

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users (id uuid primary key);
    create table public.profiles (id uuid primary key references auth.users(id));
    insert into auth.users values ('${OWNER}'), ('${OTHER}');
    insert into public.profiles values ('${OWNER}'), ('${OTHER}');
    create function public.finance_current_owner() returns uuid language sql stable
      as $$ select nullif(current_setting('app.owner', true), '')::uuid $$;
    create function public.finance_touch_updated_at() returns trigger language plpgsql as $$ begin return new; end $$;
    create function public.finance_stamp_owner() returns trigger language plpgsql as $$ begin return new; end $$;
    grant usage on schema public to anon, authenticated;
  `);
  await db.exec(sql('0030_marketing.sql'));
  await db.exec('grant select on public.site_visits to authenticated;');
});

test('0031 applies, and again on top of itself', async () => {
  await db.exec(sql('0031_visit_time.sql'));
  await db.exec(sql('0031_visit_time.sql'));
  const { rows } = await db.query(`select count(*)::int n from pg_proc where proname = 'record_visit'`);
  assert.equal(rows[0].n, 1, 'the old five-argument function is replaced, not left beside the new one');
});

test('old website code (five arguments) still records a page, with no time', async () => {
  await db.query(`select public.record_visit($1, 'old-visitor', '/shop.html', '', 'desktop')`, [OWNER]);
  const { rows } = await db.query(`select path, seconds, view_id from public.site_visits where visitor = 'old-visitor'`);
  assert.deepEqual(rows, [{ path: '/shop.html', seconds: 0, view_id: null }]);
});

test('a page view gains time on later calls, never loses it, and cannot be made up', async () => {
  const v = view(1);
  const call = (s) => db.query(`select public.record_visit($1, 'vis-a', '/shop.html', 'google.com', 'mobile', $2, $3)`, [OWNER, v, s]);
  const seconds = async () => (await db.query(`select seconds from public.site_visits where view_id = $1`, [v])).rows[0].seconds;

  await call(0);
  assert.equal(await seconds(), 0);
  await call(50); // the row is a moment old: 50 seconds cannot have passed
  assert.ok((await seconds()) <= 6, `capped to what has really passed, got ${await seconds()}`);

  await db.query(`update public.site_visits set created_at = now() - interval '100 seconds' where view_id = $1`, [v]);
  await call(60);
  assert.equal(await seconds(), 60);
  await call(20); // a late, older message
  assert.equal(await seconds(), 60, 'never goes down');
  await call(99999);
  const capped = await seconds();
  assert.ok(capped >= 100 && capped <= 106, `capped at the time elapsed + 5 s, got ${capped}`);

  const { rows } = await db.query(`select count(*)::int n from public.site_visits where view_id = $1`, [v]);
  assert.equal(rows[0].n, 1, 'one row per page view however many times it reports');
});

test('a call that arrives first (the opening one was lost) still makes the row', async () => {
  await db.query(`select public.record_visit($1, 'vis-late', '/', null, 'tablet', $2, 40)`, [OWNER, view(2)]);
  const { rows } = await db.query(`select seconds, device from public.site_visits where view_id = $1`, [view(2)]);
  assert.equal(rows[0].device, 'tablet');
  assert.ok(rows[0].seconds <= 40);
});

test('the same view id under another company is a different row, and an unknown company records nothing', async () => {
  await db.query(`select public.record_visit($1, 'x', '/', null, 'desktop', $2, 0)`, [OTHER, view(1)]);
  assert.equal((await db.query(`select count(*)::int n from public.site_visits where view_id = $1`, [view(1)])).rows[0].n, 2);
  await db.query(`select public.record_visit('99999999-9999-9999-9999-999999999999', 'x', '/', null, 'desktop', $1, 0)`, [view(3)]);
  assert.equal((await db.query(`select count(*)::int n from public.site_visits where view_id = $1`, [view(3)])).rows[0].n, 0);
});

test('visits_list: pages less than 30 minutes apart are one visit, with time per page and the total', async () => {
  await db.exec(`truncate public.site_visits`);
  const ins = (visitor, path, ago, secs, ref = null, device = 'desktop') =>
    db.query(
      `insert into public.site_visits (owner_id, visitor, path, referrer, device, seconds, created_at)
       values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' minutes')::interval)`,
      [OWNER, visitor, path, ref, device, secs, String(ago)]
    );
  // Ann: three pages in one sitting, then one two hours later.
  await ins('ann', '/', 300, 120, 'google.com', 'mobile');
  await ins('ann', '/shop.html', 297, 240);
  await ins('ann', '/product.php?id=4', 292, 60);
  await ins('ann', '/contact.html', 100, 30);
  // Bob: one page, no time recorded (opened before the website sent time).
  await ins('bob', '/', 50, 0);
  // Someone else's company.
  await db.query(`insert into public.site_visits (owner_id, visitor, path, seconds) values ($1, 'eve', '/', 999)`, [OTHER]);

  const r = await list(OWNER);
  assert.equal(r.sessions, 3, 'Ann twice, Bob once; Eve belongs to another company');
  assert.equal(r.visits.length, 3);

  const ann = r.visits.find((v) => v.visitor === 'ann' && v.seconds === 420);
  assert.ok(ann, 'Ann first sitting is 120 + 240 + 60 = 420 s');
  assert.deepEqual(ann.pages.map((p) => [p.path, p.seconds]), [['/', 120], ['/shop.html', 240], ['/product.php?id=4', 60]]);
  assert.equal(ann.device, 'mobile');
  assert.equal(ann.referrer, 'google.com');

  const annLate = r.visits.find((v) => v.visitor === 'ann' && v.seconds === 30);
  assert.deepEqual(annLate.pages.map((p) => p.path), ['/contact.html']);

  assert.deepEqual(r.visits.map((v) => v.visitor), ['bob', 'ann', 'ann'], 'newest first');
  assert.equal(r.avg_seconds, 225, 'average of 420 and 30; Bob (no time recorded) is left out');
});

test('visits_list: the gap is measured from when the last page was left, not when it was opened', async () => {
  await db.exec(`truncate public.site_visits`);
  // Opened 50 min ago and read for 40 min; the next page opened 5 min after leaving it: still one visit.
  await db.query(
    `insert into public.site_visits (owner_id, visitor, path, seconds, created_at) values
       ($1, 'cy', '/a', 2400, now() - interval '50 minutes'), ($1, 'cy', '/b', 10, now() - interval '5 minutes')`,
    [OWNER]
  );
  const r = await list(OWNER);
  assert.equal(r.sessions, 1);
  assert.equal(r.visits[0].seconds, 2410);
});

test('visits_list: the period, the limit, and who may ask', async () => {
  await db.exec(`truncate public.site_visits`);
  for (let i = 0; i < 5; i++) {
    await db.query(
      `insert into public.site_visits (owner_id, visitor, path, seconds, created_at) values ($1, $2, '/', 60, now() - ($3 || ' hours')::interval)`,
      [OWNER, `v${i}`, String(i * 10)]
    );
  }
  assert.equal((await list(OWNER)).sessions, 5);
  const two = await list(OWNER, '2000-01-01', '2100-01-01', 2);
  assert.equal(two.visits.length, 2);
  assert.equal(two.sessions, 5, 'the count covers the whole period, only the list is cut');
  assert.equal((await list(OWNER, new Date(Date.now() - 15 * 3600e3).toISOString(), '2100-01-01')).sessions, 2);
  assert.equal((await list(OTHER)).sessions, 0, 'another company sees none of these');

  await db.exec('set role anon;');
  await assert.rejects(() => db.query(`select public.visits_list(now() - interval '1 day', now())`), /permission denied/);
  await assert.doesNotReject(() => db.query(`select public.record_visit($1, 'anon-visitor', '/', null, 'desktop', $2, 0)`, [OWNER, view(9)]));
  await assert.rejects(() => db.query(`select * from public.site_visits`), /permission denied/, 'the table itself stays closed to the website');
  await db.exec('reset role;');
});
