import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree } from './genre-levels.js';

const payload = JSON.parse(readFileSync(new URL('../../server/tests/fixtures/genre_payload_levels.json', import.meta.url), 'utf8'));
const tree = buildTree({ ...payload, genres: [] });

test('the tree built from the served payload puts spacesynth at level 2 under both synthwave (level 1) and italo disco, and in synthwave and Funk / Soul', () => {
  const n = tree.byId.get('s:spacesynth');
  assert.equal(n.level, 2);
  assert.deepEqual([...n.parents].sort(), ['g:synthwave', 's:italo disco']);
  assert.equal(n.parent, 'g:synthwave', 'the display chain follows the parent on the shortest path');
  assert.deepEqual(n.fams, ['synthwave', 'Funk / Soul']);
  assert.equal(n.family, 'synthwave');
  assert.ok(tree.byId.get('g:synthwave').children.includes(n));
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

test('disco belongs to Funk / Soul only (it left Others) and so do its children; post-disco is under disco', () => {
  for (const k of ['disco', 'euro disco', 'nu-disco', 'hi-nrg', 'italo disco', 'space disco', 'post-disco']) assert.deepEqual(tree.byId.get(`s:${k}`).fams, ['Funk / Soul'], k);
  assert.deepEqual(tree.byId.get('s:post-disco').parents, ['s:disco']);
  assert.ok(tree.byId.get('g:Funk / Soul').children.some((c) => c.name === 'disco') && !tree.byId.get('g:Others').children.some((c) => c.name === 'disco'));
  assert.deepEqual(Object.keys(payload.forms).sort(), ['drum and bass', 'house', 'synthwave', 'techno', 'trance']);
  for (const f of Object.keys(payload.forms)) assert.equal(tree.byId.get(`g:${f}`).level, 1, f);
});

test('the tree built from the served payload puts space disco at level 3 under disco', () => {
  const n = tree.byId.get('s:space disco');
  assert.equal(n.level, 3);
  assert.equal(n.parent, 's:disco');
});
