import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, genreLines, ancestorIds, depthIn } from './genre-levels.js';
import { treeFacts } from './genre-tree-facts.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const doc = read('../../server/data/genre_levels.json');
const FAMILIES = Object.keys(doc.families);

const entries = Object.fromEntries(Object.entries(doc).filter(([k]) => !['_meta', 'families', 'modifiers', 'subfamilies', 'hex'].includes(k)));
const vocabOf = (levels) => ({
  families: Object.keys(doc.families),
  groups: Object.fromEntries(Object.entries(doc.families).filter(([, v]) => v.group).map(([k, v]) => [k, { synonyms: v.synonyms, temporary: v.temporary === true, colour: v.colour }])),
  family_synonyms: Object.fromEntries(Object.entries(doc.families).map(([k, v]) => [k, v.synonyms])),
  modifiers: doc.modifiers,
  levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { synonyms: [], provisional: false, ...v }])),
  genres: [],
});
const tree = () => buildTree(vocabOf(entries));

test('every parent is equal: level is the shortest path depth, families are all the level 1 ancestors, order of parents is irrelevant', () => {
  const t = tree();
  const reversed = buildTree(vocabOf(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, { ...v, parents: [...v.parents].reverse() }]))));
  for (const [k, v] of Object.entries(entries)) {
    const n = t.byId.get(`s:${k}`);
    const m = reversed.byId.get(`s:${k}`);
    const want = Math.min(...v.parents.map((p) => (FAMILIES.includes(p) ? 2 : t.byId.get(`s:${p}`).level + 1)));
    assert.equal(n.level, want, k);
    assert.deepEqual([m.level, m.fams, [...m.parents].sort()], [n.level, n.fams, [...n.parents].sort()], k);
    assert.deepEqual(n.fams, FAMILIES.filter((f) => ancestorIds(t, n.id).has(`g:${f}`)), k);
    assert.equal(n.family, n.fams[0], k);
    assert.equal(n.parents.length, new Set(v.parents).size, k);
    for (const p of n.parents) assert.ok(t.byId.get(p).children.includes(n), `${k} is a child of ${p}`);
  }
});

test('house, deep house and the blends: level 2 through a family parent, level 3 through a genre parent', () => {
  const t = tree();
  const node = (k) => t.byId.get(`s:${k}`);
  const house = t.byId.get('g:house');
  assert.equal(house.level, 1, 'house is a level 1 form since 2026-10-20');
  assert.equal(node('deep house').level, 2);
  assert.equal(node('deep house').parent, 'g:house');
  assert.equal(node('deep house').family, 'house');
  assert.equal(node('hip house').level, 2);
  assert.deepEqual(node('hip house').fams, ['house', 'Hip Hop']);
  assert.ok(t.byId.get('g:Hip Hop').children.includes(node('hip house')) && house.children.includes(node('hip house')));
  assert.equal(depthIn(t, 's:hip house', 'g:house'), 2);
  assert.equal(depthIn(t, 's:hip house', 'g:Hip Hop'), 2);
  assert.equal(node('gospel').family, 'Others');
  assert.equal(node('jungle').parent, 's:breakbeat');
});

test('disco is in Funk / Soul only (it left Others on 2026-10-20) with no override; its children and post-disco follow by descent', () => {
  const t = tree();
  const node = (k) => t.byId.get(`s:${k}`);
  assert.deepEqual(node('disco').fams, ['Funk / Soul']);
  assert.ok(!t.byId.get('g:Others').children.includes(node('disco')) && t.byId.get('g:Funk / Soul').children.includes(node('disco')));
  for (const k of ['euro disco', 'nu-disco', 'hi-nrg', 'italo disco', 'space disco', 'post-disco']) {
    assert.equal(node(k).level, 3, k);
    assert.deepEqual(node(k).parents, ['s:disco'].concat(k === 'italo disco' ? [] : []), k);
    assert.deepEqual(node(k).fams, ['Funk / Soul'], k);
  }
  assert.ok(!('family' in entries.disco) && !Object.values(entries).some((v) => 'family' in v));
  assert.deepEqual(genreLines(t, ['euro disco']).map((l) => l.family), ['Funk / Soul']);
});

test('spacesynth is level 2 under synthwave (level 1) and italo disco, and has the families of both', () => {
  const t = tree();
  const n = t.byId.get('s:spacesynth');
  assert.equal(n.level, 2);
  assert.deepEqual(n.parents.sort(), ['g:synthwave', 's:italo disco']);
  assert.deepEqual(n.fams, ['synthwave', 'Funk / Soul']);
  assert.equal(n.status, 'approved');
  assert.ok(t.byId.get('g:synthwave').children.includes(n) && t.byId.get('s:italo disco').children.includes(n));
});

test('space disco is an approved extra, level 3 under disco, in Funk / Soul', () => {
  const t = tree();
  const n = t.byId.get('s:space disco');
  assert.equal(n.level, 3);
  assert.equal(n.parent, 's:disco');
  assert.equal(n.label, 'space disco');
  assert.equal(n.discogs, false);
  assert.equal(n.status, 'approved');
  assert.deepEqual(n.synonyms, ['space-disco']);
  assert.ok(t.byId.get('s:disco').children.includes(n));
});

test('psytrance sits under trance (level 1) and its children reach level 3; there is no depth cap', () => {
  const t = tree();
  const levels = [...t.byId.values()].map((n) => n.level);
  assert.equal(Math.max(...levels), 4);
  assert.equal(t.byId.get('s:psytrance').level, 2);
  assert.deepEqual(t.byId.get('s:psytrance').parents, ['g:trance']);
  assert.equal(t.byId.get('s:goa trance').level, 3);
  assert.equal(depthIn(t, 's:goa trance', 'g:trance'), 3);
  assert.deepEqual(genreLines(t, ['goa trance']), [{ family: 'trance', genres: ['trance', 'goa trance'] }]);
  const deep = buildTree({ families: ['Rock'], levels: { a: { parents: ['Rock'] }, b: { parents: ['a'] }, c: { parents: ['b'] }, d: { parents: ['c'] }, e: { parents: ['d'] } }, modifiers: {}, genres: [] });
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((k) => deep.byId.get(`s:${k}`).level), [2, 3, 4, 5, 6]);
});

test('eurodance has house, euro disco and Pop as equal parents and belongs to three families', () => {
  const t = tree();
  const n = t.byId.get('s:eurodance');
  assert.deepEqual(n.parents.sort(), ['g:Pop', 'g:house', 's:euro disco']);
  assert.equal(n.level, 2);
  assert.deepEqual(n.fams, ['house', 'Funk / Soul', 'Pop']);
  const off = buildTree(vocabOf(entries), { fusion: false });
  assert.deepEqual(off.byId.get('s:eurodance').parents.sort(), ['s:euro disco'], 'fusion off drops the family links: Pop, and house since it is a level 1 genre now');
  assert.equal(off.byId.get('s:eurodance').level, 4);
});

test('industrial is no longer a genre; its children kept their other parents', () => {
  const t = tree();
  assert.equal(t.byId.has('s:industrial'), false);
  assert.deepEqual(t.byId.get('s:ebm').parentNames, ['synthpop']);
  assert.deepEqual(t.byId.get('s:dark electro').parentNames, ['Others']);
  assert.deepEqual(t.byId.get('s:industrial rock').fams, ['Rock']);
});

test('family counts of the tree count a genre in every family it belongs to', () => {
  const f = treeFacts(vocabOf(entries)).familyCounts;
  assert.deepEqual(f.Others, doc._meta.counts.Others.total === undefined ? f.Others : { level2: doc._meta.counts.Others.level2, level3: doc._meta.counts.Others.level3, level4: doc._meta.counts.Others.level4 });
  for (const name of FAMILIES) assert.deepEqual(f[name], { level2: doc._meta.counts[name].level2, level3: doc._meta.counts[name].level3, level4: doc._meta.counts[name].level4 }, name);
});

test('Rock family counts match the current vocabulary metadata', () => {
  const t = tree();
  const mine = [...t.byId.values()].filter((n) => n.fams.includes('Rock') && n.level > 1);
  assert.equal(mine.filter((n) => n.level === 2).length, doc._meta.counts.Rock.level2);
  assert.equal(mine.filter((n) => n.level === 3).length, doc._meta.counts.Rock.level3);
  assert.equal(mine.filter((n) => n.level === 4).length, doc._meta.counts.Rock.level4);
  for (const k of ['mod', 'soft rock', 'stoner rock', 'pub rock', 'southern rock']) assert.equal(t.byId.get(`s:${k}`).parent, 'g:Rock', k);
  assert.equal(t.byId.get('s:krautrock').parent, 's:experimental rock');
  assert.equal(t.byId.get('s:hardcore punk').level, 3);
  assert.ok(['emo', 'grindcore', 'mathcore'].every((k) => t.byId.get('s:hardcore punk').children.some((c) => c.name === k)), 'hardcore punk is a parent of its extra-parent children too');
});
