import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from './queue-logic.js';
import { buildOrder, countsFromListening, localPlayCounts, mergeCounts, createShuffleRank, pickByRank, rankMap } from './shuffle-pick.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const lcg = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

test('countsFromListening sums listened and skipped d30', () => {
  assert.equal(countsFromListening(null), null);
  const c = countsFromListening({ a: { listened: { d30: 2 }, skipped: { d30: 1 } }, b: { listened: {} } });
  assert.deepEqual(c, { a: 3, b: 0 });
});

test('buildOrder sorts by count ascending, absent songs are tier 0', () => {
  const o = buildOrder(['hot', 'warm', 'cold'], { hot: 9, warm: 2 }, lcg(5));
  assert.deepEqual(o, ['cold', 'warm', 'hot']);
});

test('buildOrder: an exhausted tier moves up to the next value present', () => {
  const o = buildOrder(['a', 'b', 'c', 'd', 'e'], { a: 1, b: 4, c: 1, d: 4, e: 7 }, lcg(9));
  assert.deepEqual(o.map((id) => ({ a: 1, b: 4, c: 1, d: 4, e: 7 })[id]), [1, 1, 4, 4, 7]);
});

test('buildOrder ties are random and uniform inside a tier', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const first = { a: 0, b: 0, c: 0, d: 0 };
  const rng = lcg(3);
  for (let i = 0; i < 4000; i++) first[buildOrder(ids, { a: 0, b: 0, c: 0, d: 2 }, rng)[0]] += 1;
  assert.equal(first.d, 0);
  for (const k of ['a', 'b', 'c']) assert.ok(first[k] > 1100 && first[k] < 1560);
});

test('buildOrder without data is a uniform permutation', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual([...buildOrder(ids, null, lcg(1))].sort(), ids);
  const first = { a: 0, b: 0, c: 0, d: 0 };
  const rng = lcg(3);
  for (let i = 0; i < 4000; i++) first[buildOrder(ids, null, rng)[0]] += 1;
  for (const k of ids) assert.ok(first[k] > 800 && first[k] < 1200);
});

test('buildOrder with a fake rng is deterministic and keeps the last song off the first slot', () => {
  const a = buildOrder(['a', 'b', 'c'], null, seq(0.9, 0.5, 0.1));
  assert.deepEqual(buildOrder(['a', 'b', 'c'], null, seq(0.9, 0.5, 0.1), a[0]).slice(1, 2), [a[0]]);
  assert.notEqual(buildOrder(['a', 'b', 'c'], null, seq(0.9, 0.5, 0.1), a[0])[0], a[0]);
  assert.deepEqual(buildOrder(['a'], null, seq(0.5), 'a'), ['a']);
});

test('localPlayCounts counts pending plays of at least 5 s inside 30 days, plus the open play', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');
  const plays = [
    { song_id: 'a', listened_s: 5, timestamp: '2026-10-21T11:58:00Z' },
    { song_id: 'a', listened_s: 4.9, timestamp: '2026-10-21T11:00:00Z' },
    { song_id: 'b', listened_s: 90, timestamp: '2026-09-01T00:00:00Z' },
    { song_id: 'c', listened_s: 60, timestamp: '2026-10-01T00:00:00Z' },
    { listened_s: 60, timestamp: '2026-10-20T00:00:00Z' },
  ];
  assert.deepEqual(localPlayCounts(plays, now, { song_id: 'c', listened_s: 30, timestamp: '2026-10-21T11:59:00Z' }), { a: 1, c: 2 });
  assert.deepEqual(localPlayCounts([], now, { song_id: 'c', listened_s: 2, timestamp: '2026-10-21T11:59:00Z' }), {});
  assert.deepEqual(localPlayCounts(null, now, null), {});
});

test('mergeCounts adds local plays to server counts; no server data means no counts', () => {
  assert.equal(mergeCounts(null, { a: 1 }), null);
  assert.deepEqual(mergeCounts({ a: 2, b: 0 }, { a: 1, c: 1 }), { a: 3, b: 0, c: 1 });
});

test('a song heard locally drops behind unplayed songs in the order', () => {
  const server = countsFromListening({ a: { listened: { d30: 0 } }, b: { listened: { d30: 0 } } });
  const now = Date.parse('2026-10-21T12:00:00Z');
  const counts = mergeCounts(server, localPlayCounts([{ song_id: 'a', listened_s: 120, timestamp: '2026-10-21T11:58:00Z' }], now));
  assert.deepEqual(buildOrder(['a', 'b'], counts, lcg(2)), ['b', 'a']);
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
