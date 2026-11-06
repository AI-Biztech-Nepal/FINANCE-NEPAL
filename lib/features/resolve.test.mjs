// lib/features/resolve.test.mjs
// Run with:  node --test lib/features/resolve.test.mjs     (Node 24 runs the .ts import as it is)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CATALOGUE_DEFAULTS, FEATURE_NAMES, FINANCE_FEATURES, resolveFeatures } from './resolve.ts';

const row = (feature_key, enabled) => ({ feature_key, enabled, config: {} });
const ALL_OFF = { 'finance.vehicles': false, 'finance.rent': false, 'finance.emi': false };

test('the portal answers: each feature takes its row', () => {
  const { flags, source } = resolveFeatures([row('finance.vehicles', true), row('finance.rent', true), row('finance.emi', false)], false);
  assert.deepEqual(flags, { 'finance.vehicles': true, 'finance.rent': true, 'finance.emi': false });
  assert.equal(source, 'portal');
});

test('missing flag: a feature with no row takes the catalogue default', () => {
  const { flags } = resolveFeatures([row('finance.rent', true)], false);
  assert.deepEqual(flags, { ...CATALOGUE_DEFAULTS, 'finance.rent': true });
});

test('an empty answer is an answer: defaults apply and the old per-account switch is not read', () => {
  const { flags, source } = resolveFeatures([], true);
  assert.deepEqual(flags, ALL_OFF);
  assert.equal(source, 'portal');
});

test('flag off stays off: only an enabled of exactly true turns a feature on', () => {
  const { flags } = resolveFeatures([row('finance.vehicles', 'true'), row('finance.rent', 1), row('finance.emi', null)], false);
  assert.deepEqual(flags, ALL_OFF);
});

test('keys the app does not know are ignored', () => {
  const { flags } = resolveFeatures([row('finance.jageer', true), row('attendance.payroll', true), null], false);
  assert.deepEqual(flags, ALL_OFF);
});

test('the portal cannot be asked (null or undefined): a vehicle account keeps vehicles, Rent and EMI, nobody else gets them', () => {
  for (const unanswered of [null, undefined]) {
    const on = resolveFeatures(unanswered, true);
    assert.deepEqual(on.flags, { 'finance.vehicles': true, 'finance.rent': true, 'finance.emi': true });
    assert.equal(on.source, 'legacy');
    assert.deepEqual(resolveFeatures(unanswered, false).flags, ALL_OFF);
  }
});

test('the catalogue sent to the portal (supabase/feature-backfill/finance.json) matches the app', () => {
  const file = JSON.parse(readFileSync(new URL('../../supabase/feature-backfill/finance.json', import.meta.url), 'utf8'));
  const keys = file.features.map((f) => f.key);
  assert.deepEqual([...keys].sort(), [...FINANCE_FEATURES].sort());
  for (const f of file.features) {
    assert.equal(f.default_on, CATALOGUE_DEFAULTS[f.key], `${f.key} default_on`);
    assert.equal(f.name, FEATURE_NAMES[f.key], `${f.key} name`);
    assert.ok(f.description.length > 20, `${f.key} has a description for the owner`);
    for (const need of f.requires) assert.ok(keys.includes(need), `${f.key} requires ${need}, which must be in the catalogue`);
  }
  const named = [...Object.values(file.backfill.orgs).flat(), ...file.backfill.also_on.flatMap((r) => r.features)];
  for (const key of named) assert.ok(keys.includes(key), `backfill names ${key}, which is not in the catalogue`);
  for (const rule of file.backfill.also_on) assert.match(rule.org_ids_sql, /^select /i);
});
