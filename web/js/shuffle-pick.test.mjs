import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from './queue-logic.js';
import { weightFor, buildOrder, countsFromListening, createShuffleRank, pickByRank, rankMap } from './shuffle-pick.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

test('weightFor', () => {
  assert.equal(weightFor(0), 1);
  assert.equal(weightFor(1), 0.25);
  assert.equal(weightFor(3), 1 / 16);
  assert.equal(weightFor(-2), 1);
  assert.equal(weightFor(NaN), 1);
});

test('countsFromListening sums listened and skipped d30', () => {
  assert.equal(countsFromListening(null), null);
  const c = countsFromListening({ a: { listened: { d30: 2 }, skipped: { d30: 1 } }, b: { listened: {} } });
  assert.deepEqual(c, { a: 3, b: 0 });
});

test('buildOrder favours low counts and zero most', () => {
  const ids = ['hot', 'warm', 'cold'];
  const counts = { hot: 9, warm: 2 };
  const first = { hot: 0, warm: 0, cold: 0 };
  const rng = lcg(7);
  for (let i = 0; i < 4000; i++) first[buildOrder(ids, counts, rng)[0]] += 1;
  assert.ok(first.cold > first.warm && first.warm > first.hot);
  assert.ok(first.hot > 0);
});

test('buildOrder is a permutation and uniform without counts', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual([...buildOrder(ids, { a: 5 }, lcg(1))].sort(), ids);
  const first = { a: 0, b: 0, c: 0, d: 0 };
  const rng = lcg(3);
  for (let i = 0; i < 4000; i++) first[buildOrder(ids, null, rng)[0]] += 1;
  for (const k of ids) assert.ok(first[k] > 800 && first[k] < 1200);
});

test('buildOrder with a fake rng is deterministic and avoids the last song at the seam', () => {
  assert.deepEqual(buildOrder(['a', 'b', 'c'], null, seq(0.9, 0.5, 0.1)), ['a', 'b', 'c']);
  assert.deepEqual(buildOrder(['a', 'b', 'c'], null, seq(0.9, 0.5, 0.1), 'a'), ['b', 'a', 'c']);
  assert.deepEqual(buildOrder(['a'], null, seq(0.5), 'a'), ['a']);
});

test('pickByRank takes the lowest rank among candidates, first when unranked', () => {
  const queue = ['a', 'b', 'c'];
  assert.equal(pickByRank([0, 2], queue, rankMap(['c', 'b', 'a'])), 2);
  assert.equal(pickByRank([1, 2], queue, new Map()), 1);
});

test('createShuffleRank caches per list and rebuilds on change, fresh and counts arrival', () => {
  let counts = null;
  let builds = 0;
  const rank = createShuffleRank({ getCounts: () => counts, rng: () => { builds++; return 0.5; } });
  rank(['a', 'b']);
  const n = builds;
  rank(['a', 'b']);
  assert.equal(builds, n);
  rank(['a', 'b', 'c']);
  assert.ok(builds > n);
  const m = builds;
  rank(['a', 'b', 'c'], true, 'a');
  assert.ok(builds > m);
  counts = { a: 1 };
  const k = builds;
  rank(['a', 'b', 'c']);
  assert.ok(builds > k);
  const j = builds;
  rank(['a', 'b', 'c']);
  assert.equal(builds, j);
});

test('nextStep in shuffle follows the order and never picks the just-played song', () => {
  const queue = ['a', 'b', 'c', 'd'];
  const shuffleRank = () => rankMap(['c', 'a', 'd', 'b']);
  let st = { queue, index: 0, shuffle: true, repeat: 'off', played: [], shuffleRank };
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const s = Q.nextStep(st, false);
    seen.push(queue[s.index]);
    st = { ...st, index: s.index, played: s.played };
  }
  assert.deepEqual(seen, ['c', 'd', 'b']);
  assert.equal(Q.nextStep(st, false), null);
});

test('nextStep new round passes fresh and last to shuffleRank; uniform without it', () => {
  const queue = ['a', 'b'];
  const calls = [];
  const shuffleRank = (ids, fresh, last) => { calls.push([fresh, last]); return rankMap(['b', 'a']); };
  const s = Q.nextStep({ queue, index: 1, shuffle: true, repeat: 'all', played: ['a', 'b'], shuffleRank }, false);
  assert.equal(s.index, 0);
  assert.deepEqual(calls, [[true, 'b']]);
  const u = Q.nextStep({ queue: ['a', 'b', 'c'], index: 0, shuffle: true, repeat: 'off', played: [] }, false, () => 0.99);
  assert.equal(u.index, 2);
});

test('nextPlayable shuffle uses the order among playable songs', () => {
  const queue = ['a', 'b', 'c'];
  const shuffleRank = () => rankMap(['b', 'c', 'a']);
  const s = Q.nextPlayable({ queue, index: 0, shuffle: true, repeat: 'off', played: [], shuffleRank }, false, (id) => id !== 'b', false);
  assert.equal(s.index, 2);
});
