import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree } from './genre-levels.js';

const payload = JSON.parse(readFileSync(new URL('../../server/tests/fixtures/genre_payload_levels.json', import.meta.url), 'utf8'));
const tree = buildTree({ ...payload, genres: [] });

test('the tree built from the served payload puts spacesynth at level 3 under both synthwave and italo disco, and in Electronic and Funk / Soul', () => {
  const n = tree.byId.get('s:spacesynth');
  assert.equal(n.level, 3);
  assert.deepEqual([...n.parents].sort(), ['s:italo disco', 's:synthwave']);
  assert.equal(n.parent, 's:synthwave', 'the display chain follows the parent on the shortest path');
  assert.deepEqual(n.fams, ['Electronic', 'Funk / Soul']);
  assert.equal(n.family, 'Electronic');
  assert.ok(tree.byId.get('s:synthwave').children.includes(n));
  assert.ok(tree.byId.get('s:italo disco').children.includes(n));
});

test('the served payload agrees with the tree built in the browser: level, families and parents of every genre', () => {
  for (const [k, v] of Object.entries(payload.levels)) {
    const n = tree.byId.get(`s:${k}`);
    assert.deepEqual(n.fams, v.families, k);
    assert.deepEqual(n.parentNames, v.parents, k);
    assert.equal(n.level, v.level, k);
  }
});

test('disco belongs to Funk / Soul and Electronic and so do its children; post-disco is under disco', () => {
  for (const k of ['disco', 'euro disco', 'nu-disco', 'hi-nrg', 'italo disco', 'space disco', 'post-disco']) assert.deepEqual(tree.byId.get(`s:${k}`).fams, ['Electronic', 'Funk / Soul'], k);
  assert.deepEqual(tree.byId.get('s:post-disco').parents, ['s:disco']);
  assert.ok(tree.byId.get('g:Funk / Soul').children.some((c) => c.name === 'disco') && tree.byId.get('g:Electronic').children.some((c) => c.name === 'disco'));
});

test('the tree built from the served payload puts space disco at level 3 under disco', () => {
  const n = tree.byId.get('s:space disco');
  assert.equal(n.level, 3);
  assert.equal(n.parent, 's:disco');
});
