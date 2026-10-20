import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LOOPS, MAX_NAME, FULL_TEXT, loopsOf, defaultName, cleanName, addLoop, renameLoop, removeLoop, sameRegion } from './loops-model.js';

const R = (start, end) => ({ start, end });

test('WEB-153: loopsOf reads the saved list and tolerates a song without one', () => {
  assert.deepEqual(loopsOf({ loops: [{ name: 'a', start: 1, end: 2 }] }), [{ name: 'a', start: 1, end: 2 }]);
  assert.deepEqual(loopsOf({}), []);
  assert.deepEqual(loopsOf(null), []);
  assert.deepEqual(loopsOf({ loops: 'x' }), []);
});

test('WEB-153: the default name is Loop 1, Loop 2, ... and reuses a freed number', () => {
  assert.equal(defaultName([]), 'Loop 1');
  assert.equal(defaultName([{ name: 'Loop 1' }, { name: 'Solo' }]), 'Loop 2');
  assert.equal(defaultName([{ name: 'Loop 2' }]), 'Loop 1');
});

test('WEB-153: addLoop appends a named loop and rounds the times', () => {
  const first = addLoop([], R(12.3456, 27.5), 200);
  assert.deepEqual(first, { ok: true, loops: [{ name: 'Loop 1', start: 12.346, end: 27.5 }] });
  const second = addLoop(first.loops, R(1, 2), 200, '  Intro  ');
  assert.deepEqual(second.loops.map((l) => l.name), ['Loop 1', 'Intro']);
});

test('WEB-153: addLoop refuses an incomplete region, a duplicate region and a 21st loop', () => {
  assert.equal(addLoop([], R(null, 5), 100).ok, false);
  assert.equal(addLoop([], R(5, 5.01), 100).ok, false);
  const one = addLoop([], R(1, 2), 100).loops;
  const twin = addLoop(one, R(1, 2.001), 100);
  assert.equal(twin.ok, false);
  assert.match(twin.error, /Already saved as Loop 1/);
  let list = [];
  for (let i = 0; i < MAX_LOOPS; i++) list = addLoop(list, R(i, i + 1), 100).loops;
  assert.equal(list.length, MAX_LOOPS);
  assert.deepEqual(addLoop(list, R(50, 51), 100), { ok: false, error: FULL_TEXT });
});

test('WEB-153: names are trimmed and cut at 40 characters', () => {
  assert.equal(cleanName('  x '), 'x');
  assert.equal(cleanName('y'.repeat(60)).length, MAX_NAME);
  assert.equal(cleanName(null), '');
  assert.equal(addLoop([], R(1, 2), 100, 'z'.repeat(60)).loops[0].name.length, MAX_NAME);
});

test('WEB-153: renameLoop changes one name and keeps the order; an empty name or a gone loop is refused', () => {
  const list = [{ name: 'A', start: 1, end: 2 }, { name: 'B', start: 3, end: 4 }];
  const r = renameLoop(list, 1, ' Solo ');
  assert.deepEqual(r.loops.map((l) => l.name), ['A', 'Solo']);
  assert.equal(list[1].name, 'B', 'the input is not changed');
  assert.equal(renameLoop(list, 0, '   ').ok, false);
  assert.equal(renameLoop(list, 5, 'x').ok, false);
});

test('WEB-153: removeLoop drops one loop; a gone loop is refused', () => {
  const list = [{ name: 'A', start: 1, end: 2 }, { name: 'B', start: 3, end: 4 }];
  assert.deepEqual(removeLoop(list, 0).loops, [list[1]]);
  assert.equal(removeLoop(list, 2).ok, false);
  assert.equal(list.length, 2);
});

test('WEB-153: sameRegion compares to within 5 ms', () => {
  assert.equal(sameRegion(R(1, 2), R(1.004, 2)), true);
  assert.equal(sameRegion(R(1, 2), R(1.1, 2)), false);
  assert.equal(sameRegion(null, R(1, 2)), false);
});
