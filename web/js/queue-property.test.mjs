import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from './queue-logic.js';

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const songs = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, tags: i % 2 ? ['rock'] : ['jazz', 'genre:blues'] }));

function invariants(s, label) {
  const ids = s.items.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: ids unique`);
  if (!ids.length) assert.equal(s.index, -1, `${label}: empty queue has no current`);
  else assert.ok(s.index >= 0 && s.index < ids.length, `${label}: index ${s.index} in range of ${ids.length}`);
}

test('random edit sequences keep the queue consistent (seeded)', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const rnd = mulberry(seed);
    let s = Q.emptyState();
    for (let step = 0; step < 60; step += 1) {
      const id = `s${Math.floor(rnd() * 14)}`;
      const op = Math.floor(rnd() * 11);
      const label = `seed ${seed} step ${step} op ${op}`;
      if (op === 0) s = Q.addManual(s, id).state;
      else if (op === 1) s = Q.playNow(s, id);
      else if (op === 2) s = Q.addTags(s, [rnd() < 0.5 ? 'rock' : 'jazz'], songs).state;
      else if (op === 3) s = Q.removeItem(s, Math.floor(rnd() * (s.items.length + 2)) - 1).state;
      else if (op === 4) s = Q.moveItem(s, Math.floor(rnd() * s.items.length), rnd() < 0.5 ? -1 : 1);
      else if (op === 5) s = Q.clearOthers(s).state;
      else if (op === 6) { const at = s.items.findIndex((it) => it.id === id); s = at >= 0 ? Q.removeItem(s, at).state : Q.addManual(s, id).state; }
      else if (op === 7) s = Q.syncLibrary(s, (x) => x !== id).state;
      else if (op === 8) s = Q.addListed(s, songs.slice(0, Math.floor(rnd() * 12)), rnd() < 0.5 ? 'rock' : '').state;
      else if (op === 9) s = Q.removeTags(s, ['rock']).state ?? Q.removeTags(s, ['rock']);
      else s = Q.parseSaved(JSON.parse(JSON.stringify(s)));
      if (s.state) s = s.state;
      invariants(s, label);
    }
  }
});

test('moving or removing never changes WHICH song is current unless it is the one removed', () => {
  const rnd = mulberry(7);
  for (let k = 0; k < 200; k += 1) {
    let s = Q.emptyState();
    for (let i = 0; i < 6; i += 1) s = Q.addManual(s, `s${i}`).state;
    s = { ...s, index: Math.floor(rnd() * 6) };
    const cur = s.items[s.index].id;
    const i = Math.floor(rnd() * 6);
    const moved = Q.moveItem(s, i, rnd() < 0.5 ? -1 : 1);
    assert.equal(moved.items[moved.index].id, cur);
    const r = Q.removeItem(s, i);
    if (!r.currentRemoved) assert.equal(r.state.items[r.state.index].id, cur);
    else assert.equal(r.currentRemoved, i === s.index);
  }
});

function playRound(queue, repeat, rand, steps) {
  let st = { queue, index: 0, shuffle: true, repeat, played: [] };
  const order = [queue[0]];
  for (let k = 0; k < steps; k += 1) {
    const n = Q.nextStep(st, false, rand);
    if (!n) break;
    st = { ...st, index: n.index, played: n.played };
    order.push(queue[n.index]);
  }
  return order;
}

test('shuffle without repeat plays every song exactly once, then stops', () => {
  const queue = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  for (let seed = 1; seed <= 30; seed += 1) {
    const order = playRound(queue, 'off', mulberry(seed), 50);
    assert.equal(order.length, queue.length);
    assert.deepEqual([...order].sort(), [...queue].sort());
  }
});

test('shuffle with repeat-all: each full round is a permutation', () => {
  const queue = ['a', 'b', 'c', 'd', 'e'];
  const order = playRound(queue, 'all', mulberry(3), 5 * 6 - 1);
  for (let r = 0; r < 5; r += 1) {
    const slice = order.slice(r * 5 + (r ? 0 : 0), r * 5 + 5);
    if (r > 0) continue;
    assert.deepEqual([...slice].sort(), [...queue].sort());
  }
  assert.equal(order.length, 30);
});

test('shuffle is deterministic for a given seed and differs across seeds', () => {
  const queue = Array.from({ length: 20 }, (_, i) => `s${i}`);
  const a = playRound(queue, 'off', mulberry(42), 40);
  const b = playRound(queue, 'off', mulberry(42), 40);
  const c = playRound(queue, 'off', mulberry(43), 40);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('rand() returning exactly 1 or out-of-range values never indexes past the candidates', () => {
  const queue = ['a', 'b', 'c'];
  for (const r of [0, 0.999999, 1, 5]) {
    const n = Q.nextStep({ queue, index: 0, shuffle: true, repeat: 'off', played: [] }, true, () => r);
    assert.ok(n === null || (n.index >= 0 && n.index < 3), `rand ${r}`);
  }
});

test('loop modes: one pins auto-advance only, all wraps, off stops at the end', () => {
  const base = { queue: ['a', 'b', 'c'], index: 2, shuffle: false, played: [] };
  assert.equal(Q.nextStep({ ...base, repeat: 'off' }, false), null);
  assert.equal(Q.nextStep({ ...base, repeat: 'all' }, false).index, 0);
  assert.equal(Q.nextStep({ ...base, repeat: 'one' }, false).index, 2);
  assert.equal(Q.nextStep({ ...base, repeat: 'one' }, true), null);
  assert.equal(Q.nextStep({ ...base, index: 0, repeat: 'one' }, true).index, 1);
  assert.equal(Q.hasNext({ ...base, repeat: 'off' }), false);
  assert.equal(Q.hasNext({ ...base, repeat: 'all' }), true);
  assert.equal(Q.toggleRepeat('off', 'one'), 'one');
  assert.equal(Q.toggleRepeat('one', 'one'), 'off');
});

test('single-song queue: shuffle + repeat-all stays on the song, off stops', () => {
  const st = { queue: ['a'], index: 0, shuffle: true, played: [] };
  assert.equal(Q.nextStep({ ...st, repeat: 'off' }, true), null);
  assert.equal(Q.nextStep({ ...st, repeat: 'all' }, true).index, 0);
});

test('out-of-range or empty state yields null instead of throwing', () => {
  assert.equal(Q.nextStep({ queue: [], index: -1, shuffle: false, repeat: 'off' }, true), null);
  assert.equal(Q.nextStep({ queue: ['a'], index: 5, shuffle: false, repeat: 'all' }, true), null);
  assert.equal(Q.nextStep({ queue: ['a'], index: -1, shuffle: true, repeat: 'all' }, true), null);
  assert.equal(Q.prevStep({ queue: [], index: -1, shuffle: false }), null);
});

test('prevStep in shuffle walks the history, skipping removed songs and the current one', () => {
  const st = { queue: ['a', 'b', 'c'], index: 2, shuffle: true, history: ['a', 'gone', 'b', 'c'] };
  const p = Q.prevStep(st);
  assert.equal(p.index, 1);
  assert.deepEqual(p.history, ['a', 'gone', 'b'].slice(0, 2));
  assert.equal(Q.prevStep({ ...st, history: ['gone'] }), null);
  assert.equal(Q.prevStep({ queue: ['a', 'b'], index: 0, shuffle: false }), null);
});

test('parseSaved rejects junk and repairs bad indexes (random fuzz, seeded)', () => {
  const rnd = mulberry(99);
  const junk = [null, undefined, 5, 'x', [], {}, { items: 'no' }, { ids: [1, 2] }, { items: [null, { id: 3 }, { id: 'a' }, { id: 'a' }], index: 9, tags: ['t', 4] }];
  for (const j of junk) invariants(Q.parseSaved(j), JSON.stringify(j));
  for (let k = 0; k < 100; k += 1) {
    const n = Math.floor(rnd() * 5);
    const d = { items: Array.from({ length: n }, () => ({ id: `s${Math.floor(rnd() * 4)}`, manual: rnd() < 0.5, tags: rnd() < 0.5 ? ['x'] : 'bad' })), index: Math.floor(rnd() * 10) - 3 };
    invariants(Q.parseSaved(d), JSON.stringify(d));
  }
  assert.deepEqual(Q.parseSaved({ items: [{ id: 'a' }, { id: 'a' }] }).items.length, 1);
  assert.equal(Q.parseSaved({ ids: ['a', 'b'] }).items[1].manual, true);
});
