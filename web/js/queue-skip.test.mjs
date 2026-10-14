import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextPlayable, prevPlayable } from './queue-logic.js';

const queue = ['a', 'b', 'c', 'd', 'e'];
const st = (o) => ({ queue, index: 0, shuffle: false, repeat: 'off', played: [], history: [], ...o });
const has = (...ids) => (id) => ids.includes(id);

test('forward skip over several', () => {
  const r = nextPlayable(st({}), true, has('a', 'd'), false);
  assert.equal(r.index, 3);
  assert.equal(r.skipped, 2);
});

test('backward skip', () => {
  const r = prevPlayable(st({ index: 4 }), has('b', 'e'), false);
  assert.equal(r.index, 1);
  assert.equal(r.skipped, 2);
});

test('nothing playable ahead or behind', () => {
  assert.equal(nextPlayable(st({ index: 3 }), true, has('a', 'd'), false), null);
  assert.equal(prevPlayable(st({ index: 3 }), has('d', 'e'), false), null);
});

test('loop-all wraps to the first playable', () => {
  const r = nextPlayable(st({ index: 3, repeat: 'all' }), false, has('b', 'd'), false);
  assert.equal(r.index, 1);
  assert.equal(r.skipped, 2);
});

test('loop-one is unaffected on auto advance, Next still moves', () => {
  assert.equal(nextPlayable(st({ index: 1, repeat: 'one' }), false, has('b', 'c'), false).index, 1);
  assert.equal(nextPlayable(st({ index: 1, repeat: 'one' }), true, has('b', 'd'), false).index, 3);
});

test('shuffle only picks playable songs', () => {
  for (const r of [0, 0.5, 0.99]) {
    const s = nextPlayable(st({ shuffle: true, index: 0 }), true, has('a', 'c', 'e'), false, () => r);
    assert.ok([2, 4].includes(s.index));
    assert.equal(s.skipped, 0);
  }
  assert.equal(nextPlayable(st({ shuffle: true }), true, has('a'), false), null);
  assert.equal(nextPlayable(st({ shuffle: true }), true, has(), false), null);
});

test('shuffle round ends, loop-all starts a new one', () => {
  const s = st({ shuffle: true, index: 2, played: ['a', 'c'], repeat: 'all' });
  assert.equal(nextPlayable(s, false, has('a', 'c'), false, () => 0).index, 0);
  assert.equal(nextPlayable({ ...s, repeat: 'off' }, false, has('a', 'c'), false), null);
});

test('played bookkeeping follows the chosen song', () => {
  const r = nextPlayable(st({ played: [] }), true, has('a', 'c'), false);
  assert.deepEqual(r.played.includes('a'), true);
  assert.equal(r.index, 2);
});

test('auto-download on: plain next / previous', () => {
  const none = () => false;
  assert.deepEqual(nextPlayable(st({}), true, none, true), { index: 1, played: ['a'], skipped: 0 });
  assert.equal(nextPlayable(st({ index: 4 }), true, none, true), null);
  assert.equal(prevPlayable(st({ index: 2 }), none, true).index, 1);
});
