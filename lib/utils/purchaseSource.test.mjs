// lib/utils/purchaseSource.test.mjs
// Run with:  node --test lib/utils/purchaseSource.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOfPurchase } from './purchaseSource.ts';

const sale = (sale_id, source, source_note = null) => ({ kind: 'sale', note: 'Bought Aaa - NPR 500', at: '2026-11-07T00:00:00Z', ...(sale_id ? { sale_id, source, source_note } : null) });

test('each purchase reads its own source, not the person\'s latest', () => {
  const history = [sale('s1', 'walk_in'), sale('s2', 'tiktok'), sale('s3', 'referral', 'Ram Sharma'), sale('s4', 'facebook')];
  assert.deepEqual(sourceOfPurchase(history, 's1'), { source: 'walk_in', note: null });
  assert.deepEqual(sourceOfPurchase(history, 's2'), { source: 'tiktok', note: null });
  assert.deepEqual(sourceOfPurchase(history, 's3'), { source: 'referral', note: 'Ram Sharma' });
  assert.deepEqual(sourceOfPurchase(history, 's4'), { source: 'facebook', note: null });
});

test('a sale saved before sources were kept has none: null, not a guess', () => {
  const history = [sale(null), sale(null), sale('s9', 'facebook')];
  assert.equal(sourceOfPurchase(history, 'old-sale'), null);
  assert.deepEqual(sourceOfPurchase(history, 's9'), { source: 'facebook', note: null });
});

test('no history, or a line without a source, is null', () => {
  assert.equal(sourceOfPurchase(undefined, 's1'), null);
  assert.equal(sourceOfPurchase(null, 's1'), null);
  assert.equal(sourceOfPurchase([], 's1'), null);
  assert.equal(sourceOfPurchase([{ kind: 'sale', note: 'x', at: 'y', sale_id: 's1' }], 's1'), null);
});
