import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree } from './genre-levels.js';
import { treeFacts } from './genre-tree-facts.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const doc = read('../../server/data/genre_levels.json');
const discogs = read('../../server/data/genre_discogs.json');
const HEAD = read('../../server/tests/fixtures/genre_parents_snapshot_web.json');

const entries = Object.fromEntries(Object.entries(doc).filter(([k]) => !['_meta', 'families', 'flavours'].includes(k)));
const vocabOf = (levels) => ({
  families: discogs.families,
  family_synonyms: Object.fromEntries(Object.entries(doc.families).map(([k, v]) => [k, v.synonyms])),
  flavours: doc.flavours,
  levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { synonyms: [], provisional: false, ...v }])),
  genres: [],
});

test('the tree built from parents lists is identical to the snapshot taken from the old parent/also_under data (before the two edits of 2026-10-19)', () => {
  const levels = structuredClone(entries);
  levels.spacesynth.parents = ['Electronic', 'italo disco'];
  delete levels['space disco'];
  const now = JSON.parse(JSON.stringify(treeFacts(vocabOf(levels))));
  assert.deepEqual(Object.keys(now.nodes).sort(), Object.keys(HEAD.nodes).sort());
  for (const id of Object.keys(HEAD.nodes)) assert.deepEqual(now.nodes[id], HEAD.nodes[id], id);
  assert.deepEqual(now.familyCounts, HEAD.familyCounts);
  assert.deepEqual(now.lines, HEAD.lines);
  for (const label of ['full', 'sparse']) {
    assert.deepEqual(now.trees[label].counts, HEAD.trees[label].counts, label);
    assert.deepEqual(now.trees[label].rows, HEAD.trees[label].rows, label);
    assert.deepEqual(now.trees[label].rowsPopulated, HEAD.trees[label].rowsPopulated, label);
    assert.deepEqual(now.trees[label].layouts, HEAD.trees[label].layouts, label);
  }
});

test('level and family come from parents[0]; extra parents are cross-links', () => {
  const t = buildTree(vocabOf(entries));
  const node = (k) => t.byId.get(`s:${k}`);
  assert.equal(node('house').level, 2);
  assert.equal(node('deep house').level, 3);
  assert.equal(node('deep house').parent, 's:house');
  assert.equal(node('deep house').family, 'Electronic');
  assert.equal(node('disco').family, 'Funk / Soul');
  assert.deepEqual(node('disco').alsoIn, ['Electronic']);
  assert.ok(t.byId.get('g:Electronic').children.includes(node('disco')));
  assert.ok(t.byId.get('g:Funk / Soul').children.includes(node('disco')));
  assert.equal(node('italo disco').family, 'Electronic', 'an explicit family chooses among the families of the primary parent');
  assert.equal(node('italo disco').parent, 's:disco');
  assert.deepEqual(node('jungle').alsoUnder, ['breakbeat']);
  assert.equal(node('jungle').parent, 's:drum and bass');
  assert.ok(!t.byId.get('s:breakbeat').children.includes(node('jungle')), 'a cross-link is not a child');
});

test('spacesynth is level 3 under synthwave with italo disco as a cross-link', () => {
  const t = buildTree(vocabOf(entries));
  const n = t.byId.get('s:spacesynth');
  assert.equal(n.level, 3);
  assert.equal(n.parent, 's:synthwave');
  assert.equal(n.family, 'Electronic');
  assert.deepEqual(n.alsoUnder, ['italo disco']);
  assert.equal(n.status, 'approved');
  assert.ok(t.byId.get('s:synthwave').children.includes(n));
});

test('space disco is an approved extra, level 3 under disco, in Electronic', () => {
  const t = buildTree(vocabOf(entries));
  const n = t.byId.get('s:space disco');
  assert.equal(n.level, 3);
  assert.equal(n.parent, 's:disco');
  assert.equal(n.family, 'Electronic');
  assert.equal(n.label, 'Space Disco');
  assert.equal(n.discogs, false);
  assert.equal(n.status, 'approved');
  assert.deepEqual(n.synonyms, ['space-disco']);
  assert.deepEqual(n.alsoIn, []);
  assert.deepEqual(n.alsoUnder, []);
  assert.ok(t.byId.get('s:disco').children.includes(n));
});

test('Electronic counts after the two edits', () => {
  const f = treeFacts(vocabOf(entries)).familyCounts.Electronic;
  assert.deepEqual(f, { level2: 51, level3: 95 });
});
