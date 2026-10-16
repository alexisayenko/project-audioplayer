import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSync, describeSync } from './sync-status.js';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const owner = (o) => ({ state: 'stale', unpushed: 3, last_push_at: '2026-10-16T09:55:00Z', timer_seen: true, repos: [], last_error: null, ...o });

test('normalizeSync accepts strings, objects and nothing', () => {
  assert.deepEqual(normalizeSync('pending'), { state: 'pending' });
  assert.equal(normalizeSync({ state: 'stale', unpushed: 1 }).unpushed, 1);
  assert.equal(normalizeSync(undefined).state, 'ok');
  assert.equal(normalizeSync(null).state, 'ok');
});

test('ok and pending carry no mark', () => {
  for (const [state, text] of [['ok', 'In sync with git'], ['pending', 'Saving to git']]) {
    const v = describeSync({ state, unpushed: 1 }, NOW);
    assert.deepEqual(v, { level: 'none', text, label: '', dot: false });
  }
});

test('stale owner: minutes ago and unpushed count', () => {
  const v = describeSync(owner({}), NOW);
  assert.equal(v.level, 'warn');
  assert.equal(v.text, 'last pushed 5 min ago, 3 changes not pushed');
  assert.equal(v.label, 'Sync is behind: 3 changes not pushed');
  assert.equal(v.dot, true);
});

test('minutes round and never drop below 1', () => {
  assert.match(describeSync(owner({ last_push_at: '2026-10-16T09:59:01Z' }), NOW).text, /^last pushed 1 min ago/);
  assert.match(describeSync(owner({ last_push_at: '2026-10-16T09:59:50Z' }), NOW).text, /^last pushed 1 min ago/);
  assert.match(describeSync(owner({ last_push_at: '2026-10-16T09:58:20Z' }), NOW).text, /^last pushed 2 min ago/);
});

test('stale without a recorded push', () => {
  assert.equal(describeSync(owner({ last_push_at: null, unpushed: 1 }), NOW).text, 'no push recorded, 1 change not pushed');
});

test('stale with the timer missing says so', () => {
  const v = describeSync(owner({ timer_seen: false }), NOW);
  assert.equal(v.text, 'Git push timer not installed or not running, 3 changes not pushed');
  assert.equal(v.label, 'Sync is behind: 3 changes not pushed, push timer not running');
  assert.equal(v.level, 'warn');
});

test('error reasons', () => {
  assert.equal(describeSync({ state: 'error', repos: [{ rejected: true }] }, NOW).text, 'Sync failed: push rejected');
  assert.equal(describeSync({ state: 'error', last_error: 'No upstream configured' }, NOW).text, 'Sync failed: no upstream');
  const v = describeSync({ state: 'error', last_error: 'timeout' }, NOW);
  assert.deepEqual([v.level, v.text, v.label, v.dot], ['error', 'Sync failed: not reaching git', 'Sync failed', true]);
});

test('legacy string error and non-owner degraded', () => {
  assert.equal(describeSync('error', NOW).level, 'error');
  const d = describeSync({ state: 'degraded' }, NOW);
  assert.deepEqual([d.level, d.text, d.label, d.dot], ['warn', 'Sync is behind', 'Sync is behind', true]);
});

test('unknown state shows nothing', () => {
  assert.equal(describeSync('weird', NOW).level, 'none');
});
