import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Q from './queue-logic.js';

const item = (id, manual = true, tags = []) => ({ id, manual, tags });

test('clearOthers keeps only the current song, as index 0, and drops every chip', () => {
  const state = { items: [item('a'), item('b', false, ['rock']), item('c'), item('d', false, ['rock'])], index: 1, tags: ['rock'] };
  const r = Q.clearOthers(state);
  assert.equal(r.removed, 3);
  assert.deepEqual(r.state.items.map((i) => i.id), ['b']);
  assert.equal(r.state.index, 0);
  assert.deepEqual(r.state.tags, []);
  assert.deepEqual(r.state.items[0].tags, []);
});

test('clearOthers removes manual songs too', () => {
  const state = { items: [item('a'), item('b'), item('c')], index: 0, tags: [] };
  assert.equal(Q.clearOthers(state).removed, 2);
  assert.equal(Q.othersCount(state), 2);
});

test('clearOthers with only the current song changes nothing but chips', () => {
  const state = { items: [item('a')], index: 0, tags: ['x'] };
  const r = Q.clearOthers(state);
  assert.equal(r.removed, 0);
  assert.deepEqual(r.state.tags, []);
  assert.equal(Q.othersCount(r.state), 0);
});

test('clearOthers with no current song empties the queue', () => {
  const r = Q.clearOthers({ items: [item('a'), item('b')], index: -1, tags: [] });
  assert.equal(r.removed, 2);
  assert.deepEqual(r.state.items, []);
  assert.equal(r.state.index, -1);
});

test('clearOthers on an empty queue', () => {
  const r = Q.clearOthers(Q.emptyState());
  assert.equal(r.removed, 0);
  assert.equal(r.state.index, -1);
  assert.equal(Q.othersCount(Q.emptyState()), 0);
});
