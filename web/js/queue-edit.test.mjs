import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from './queue-logic.js';

const mk = (list, index, extra = {}) => ({
  items: list.map((id) => ({ id, manual: true, tags: [] })), index, tags: [], ...extra,
});
const ids = (s) => Q.queueIds(s);
const cur = (s) => s.items[s.index]?.id;

test('move keeps the current song current', () => {
  const s = mk(['a', 'b', 'c', 'd'], 1);
  const up = Q.moveItem(s, 1, -1);
  assert.deepEqual(ids(up), ['b', 'a', 'c', 'd']);
  assert.equal(cur(up), 'b');
  const down = Q.moveItem(s, 1, 1);
  assert.deepEqual(ids(down), ['a', 'c', 'b', 'd']);
  assert.equal(cur(down), 'b');
  // an upcoming row moved above the current one
  const across = Q.moveItem(s, 2, -1);
  assert.deepEqual(ids(across), ['a', 'c', 'b', 'd']);
  assert.equal(cur(across), 'b');
  assert.equal(across.index, 2);
  // a played row moved below the current one
  const past = Q.moveItem(s, 0, 1);
  assert.deepEqual(ids(past), ['b', 'a', 'c', 'd']);
  assert.equal(cur(past), 'b');
  // unrelated rows leave the index alone
  const far = Q.moveItem(mk(['a', 'b', 'c', 'd'], 0), 2, 1);
  assert.equal(far.index, 0);
  assert.equal(cur(far), 'a');
});

test('move at the edges is a no-op', () => {
  const s = mk(['a', 'b', 'c'], 2);
  assert.equal(Q.moveItem(s, 0, -1), s);
  assert.equal(Q.moveItem(s, 2, 1), s);
  assert.equal(Q.moveItem(s, 5, 1), s);
});

test('remove before, after and at the current song', () => {
  const s = mk(['a', 'b', 'c', 'd'], 2);
  const before = Q.removeItem(s, 0);
  assert.deepEqual(ids(before.state), ['b', 'c', 'd']);
  assert.equal(before.currentRemoved, false);
  assert.equal(cur(before.state), 'c');
  const after = Q.removeItem(s, 3);
  assert.equal(after.currentRemoved, false);
  assert.equal(cur(after.state), 'c');
  const at = Q.removeItem(s, 2);
  assert.equal(at.currentRemoved, true);
  assert.deepEqual(ids(at.state), ['a', 'b', 'd']);
  assert.equal(cur(at.state), 'd');
  assert.equal(Q.removeItem(s, 9).state, s);
});

test('remove the current song when it is last or the only one', () => {
  const last = Q.removeItem(mk(['a', 'b', 'c'], 2), 2);
  assert.equal(last.currentRemoved, true);
  assert.deepEqual(ids(last.state), ['a', 'b']);
  assert.equal(last.state.index, 1);
  const only = Q.removeItem(mk(['a'], 0), 0);
  assert.equal(only.currentRemoved, true);
  assert.deepEqual(only.state, Q.emptyState());
});

test('tag bookkeeping survives edits', () => {
  const s = {
    items: [
      { id: 'a', manual: false, tags: ['rock'] },
      { id: 'b', manual: false, tags: ['rock'] },
      { id: 'c', manual: false, tags: ['rock'] },
    ],
    index: 1,
    tags: ['rock'],
  };
  const r = Q.removeItem(s, 0).state;
  assert.deepEqual(r.tags, ['rock']);
  assert.equal(cur(r), 'b');
  const m = Q.moveItem(r, 1, -1);
  assert.deepEqual(m.tags, ['rock']);
  assert.equal(cur(m), 'b');
  // chip removal still drops upcoming tag-only songs after edits
  const chip = Q.removeTags(m, ['rock']);
  assert.deepEqual(ids(chip.state), ['c', 'b']);
  assert.equal(cur(chip.state), 'b');
});

test('persistence round trip after edits, shuffle on', () => {
  let s = mk(['a', 'b', 'c', 'd', 'e'], 2);
  s = Q.moveItem(s, 4, -1);
  s = Q.removeItem(s, 0).state;
  s = Q.removeItem(s, 2).state;
  assert.equal(cur(s), 'c');
  const back = Q.parseSaved(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  const step = Q.nextStep({ queue: ids(s), index: s.index, shuffle: true, repeat: 'off', played: ['c'] }, true, () => 0);
  assert.ok(step && ids(s)[step.index] !== 'c');
  // a removed id left in the played / history lists is harmless
  const stale = Q.nextStep({ queue: ids(s), index: s.index, shuffle: true, repeat: 'off', played: ['a', 'c'] }, true, () => 0);
  assert.ok(stale && ids(s)[stale.index] !== 'c');
  const prev = Q.prevStep({ queue: ids(s), index: s.index, shuffle: true, history: ['a', 'zzz'] });
  assert.equal(prev, null);
});

test('queuedSet lists the queued ids', () => {
  const s = mk(['a', 'b'], 0);
  assert.deepEqual([...Q.queuedSet(s)].sort(), ['a', 'b']);
  assert.equal(Q.queuedSet(Q.emptyState()).size, 0);
});

test('toggleQueued adds a missing song and removes a queued one', () => {
  let r = Q.toggleQueued(Q.emptyState(), 'a');
  assert.equal(r.action, 'queued');
  assert.deepEqual(ids(r.state), ['a']);
  r = Q.toggleQueued(r.state, 'b');
  assert.equal(r.action, 'added');
  assert.ok(Q.queuedSet(r.state).has('b'));
  r = Q.toggleQueued(r.state, 'b');
  assert.equal(r.action, 'removed');
  assert.ok(!Q.queuedSet(r.state).has('b'));
  assert.equal(r.currentRemoved, false);
  assert.deepEqual(ids(r.state), ['a']);
});

test('toggleQueued on the current song reports currentRemoved', () => {
  const r = Q.toggleQueued(mk(['a', 'b', 'c'], 1), 'b');
  assert.equal(r.action, 'removed');
  assert.equal(r.currentRemoved, true);
  assert.equal(cur(r.state), 'c');
  const last = Q.toggleQueued(mk(['a'], 0), 'a');
  assert.equal(last.state.index, -1);
});

test('toggleQueued on a song queued by tag makes it manual again via add', () => {
  const s = { items: [{ id: 'a', manual: false, tags: ['x'] }], index: 0, tags: ['x'] };
  assert.equal(Q.toggleQueued(s, 'a').action, 'removed');
});
