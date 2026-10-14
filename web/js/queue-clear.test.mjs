import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from './queue-logic.js';

const item = (id, manual = true, tags = []) => ({ id, manual, tags });

test('clearUpcoming drops the songs after the current one and every chip', () => {
  const state = { items: [item('a'), item('b', false, ['rock']), item('c'), item('d', false, ['rock'])], index: 1, tags: ['rock'] };
  const r = Q.clearUpcoming(state);
  assert.equal(r.removed, 2);
  assert.deepEqual(r.state.items.map((i) => i.id), ['a', 'b']);
  assert.equal(r.state.index, 1);
  assert.deepEqual(r.state.tags, []);
  assert.deepEqual(r.state.items[1].tags, []);
});

test('clearUpcoming removes manual songs too (the old Clear left them)', () => {
  const state = { items: [item('a'), item('b'), item('c')], index: 0, tags: [] };
  assert.equal(Q.clearUpcoming(state).removed, 2);
  assert.equal(Q.upcomingCount(state), 2);
});

test('clearUpcoming with nothing upcoming changes nothing but chips', () => {
  const state = { items: [item('a')], index: 0, tags: ['x'] };
  const r = Q.clearUpcoming(state);
  assert.equal(r.removed, 0);
  assert.deepEqual(r.state.tags, []);
  assert.equal(Q.upcomingCount(r.state), 0);
});

test('clearUpcoming on an empty queue', () => {
  const r = Q.clearUpcoming(Q.emptyState());
  assert.equal(r.removed, 0);
  assert.equal(r.state.index, -1);
  assert.equal(Q.upcomingCount(Q.emptyState()), 0);
});
