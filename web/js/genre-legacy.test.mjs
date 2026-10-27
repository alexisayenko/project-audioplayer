import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyRootId, legacyIds, legacyVisible, legacyMarks } from './genre-legacy.js';

const leaf = { id: 's:b', children: [] };
const mid = { id: 's:a', children: [leaf] };
const legacy = { id: 'g:Legacy', name: 'Legacy', children: [mid, leaf] };
const curated = { id: 'g:House', name: 'House', children: [] };
const tree = { roots: [curated, legacy], byId: new Map([curated, legacy, mid, leaf].map((n) => [n.id, n])) };
const byName = { House: {}, Legacy: { legacy: true } };

test('the legacy root is the level 1 genre flagged legacy, none without one', () => {
  assert.equal(legacyRootId(tree, byName), 'g:Legacy');
  assert.equal(legacyRootId(tree, { House: {} }), null);
  assert.equal(legacyRootId(null, byName), null);
});

test('descendants are collected once even with several parents', () => {
  assert.deepEqual([...legacyIds(tree, 'g:Legacy')].sort(), ['s:a', 's:b']);
});

test('closed Legacy hides its subtree only; open or absent Legacy shows everything', () => {
  assert.deepEqual([...legacyVisible(tree, 'g:Legacy', false)].sort(), ['g:House', 'g:Legacy']);
  assert.equal(legacyVisible(tree, 'g:Legacy', true), null);
  assert.equal(legacyVisible(tree, null, false), null);
});

test('the Legacy circle is marked closed or open', () => {
  assert.equal(legacyMarks('g:Legacy', false).get('g:Legacy'), 'closed');
  assert.equal(legacyMarks('g:Legacy', true).get('g:Legacy'), 'open');
  assert.equal(legacyMarks(null, false).size, 0);
});
