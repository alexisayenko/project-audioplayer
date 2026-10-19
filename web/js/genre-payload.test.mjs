import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree } from './genre-levels.js';

const payload = JSON.parse(readFileSync(new URL('../../server/tests/fixtures/genre_payload_levels.json', import.meta.url), 'utf8'));
const tree = buildTree({ ...payload, genres: [] });

test('the tree built from the served payload puts spacesynth at level 3 under synthwave with an italo disco cross-link', () => {
  const n = tree.byId.get('s:spacesynth');
  assert.equal(n.level, 3);
  assert.equal(n.parent, 's:synthwave');
  assert.equal(n.family, 'Electronic');
  assert.deepEqual(n.alsoUnder, ['italo disco']);
  assert.ok(tree.byId.get('s:synthwave').children.includes(n));
  assert.ok(!tree.byId.get('s:italo disco').children.includes(n));
});

test('the tree built from the served payload puts space disco at level 3 under disco', () => {
  const n = tree.byId.get('s:space disco');
  assert.equal(n.level, 3);
  assert.equal(n.parent, 's:disco');
});
