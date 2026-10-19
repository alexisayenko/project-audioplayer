import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree, genreLines, ancestorIds, depthIn } from './genre-levels.js';
import { treeFacts } from './genre-tree-facts.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const doc = read('../../server/data/genre_levels.json');
const discogs = read('../../server/data/genre_discogs.json');

const entries = Object.fromEntries(Object.entries(doc).filter(([k]) => !['_meta', 'families', 'flavours', 'subfamilies'].includes(k)));
const vocabOf = (levels) => ({
  families: discogs.families,
  family_synonyms: Object.fromEntries(Object.entries(doc.families).map(([k, v]) => [k, v.synonyms])),
  flavours: doc.flavours,
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
    const want = Math.min(...v.parents.map((p) => (discogs.families.includes(p) ? 2 : t.byId.get(`s:${p}`).level + 1)));
    assert.equal(n.level, want, k);
    assert.deepEqual([m.level, m.fams, [...m.parents].sort()], [n.level, n.fams, [...n.parents].sort()], k);
    assert.deepEqual(n.fams, discogs.families.filter((f) => ancestorIds(t, n.id).has(`g:${f}`)), k);
    assert.equal(n.family, n.fams[0], k);
    assert.equal(n.parents.length, new Set(v.parents).size, k);
    for (const p of n.parents) assert.ok(t.byId.get(p).children.includes(n), `${k} is a child of ${p}`);
  }
});

test('house, deep house and the blends: level 2 through a family parent, level 3 through a genre parent', () => {
  const t = tree();
  const node = (k) => t.byId.get(`s:${k}`);
  assert.equal(node('house').level, 2);
  assert.equal(node('deep house').level, 3);
  assert.equal(node('deep house').parent, 's:house');
  assert.equal(node('deep house').family, 'Electronic');
  assert.equal(node('hip house').level, 2);
  assert.deepEqual(node('hip house').fams, ['Electronic', 'Hip Hop']);
  assert.ok(t.byId.get('g:Hip Hop').children.includes(node('hip house')) && node('house').children.includes(node('hip house')));
  assert.equal(depthIn(t, 's:hip house', 'g:Electronic'), 3);
  assert.equal(depthIn(t, 's:hip house', 'g:Hip Hop'), 2);
  assert.equal(node('gospel').family, 'Folk, World, & Country');
  assert.equal(node('jungle').parent, 's:breakbeat');
});

test('disco is in Funk / Soul and Electronic with no override; its children and post-disco follow by descent', () => {
  const t = tree();
  const node = (k) => t.byId.get(`s:${k}`);
  assert.deepEqual(node('disco').fams, ['Electronic', 'Funk / Soul']);
  assert.ok(t.byId.get('g:Electronic').children.includes(node('disco')) && t.byId.get('g:Funk / Soul').children.includes(node('disco')));
  for (const k of ['euro disco', 'nu-disco', 'hi-nrg', 'italo disco', 'space disco', 'post-disco']) {
    assert.equal(node(k).level, 3, k);
    assert.deepEqual(node(k).parents, ['s:disco'].concat(k === 'italo disco' ? [] : []), k);
    assert.deepEqual(node(k).fams, ['Electronic', 'Funk / Soul'], k);
  }
  assert.ok(!('family' in entries.disco) && !Object.values(entries).some((v) => 'family' in v));
  assert.deepEqual(genreLines(t, ['euro disco']).map((l) => l.family), ['Electronic', 'Funk / Soul']);
});

test('spacesynth is level 3 under synthwave and italo disco, and has the families of both', () => {
  const t = tree();
  const n = t.byId.get('s:spacesynth');
  assert.equal(n.level, 3);
  assert.deepEqual(n.parents.sort(), ['s:italo disco', 's:synthwave']);
  assert.deepEqual(n.fams, ['Electronic', 'Funk / Soul']);
  assert.equal(n.status, 'approved');
  assert.ok(t.byId.get('s:synthwave').children.includes(n) && t.byId.get('s:italo disco').children.includes(n));
});

test('space disco is an approved extra, level 3 under disco, in Electronic and Funk / Soul', () => {
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

test('psytrance sits under trance and its children reach level 4; there is no depth cap', () => {
  const t = tree();
  const levels = [...t.byId.values()].map((n) => n.level);
  assert.equal(Math.max(...levels), 4);
  assert.equal(t.byId.get('s:psytrance').level, 3);
  assert.deepEqual(t.byId.get('s:psytrance').parents, ['s:trance']);
  assert.equal(t.byId.get('s:goa trance').level, 4);
  assert.equal(depthIn(t, 's:goa trance', 'g:Electronic'), 4);
  assert.deepEqual(genreLines(t, ['goa trance']), [{ family: 'Electronic', genres: ['Electronic', 'goa trance'] }]);
  const deep = buildTree({ families: ['Rock'], levels: { a: { parents: ['Rock'] }, b: { parents: ['a'] }, c: { parents: ['b'] }, d: { parents: ['c'] }, e: { parents: ['d'] } }, flavours: {}, genres: [] });
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((k) => deep.byId.get(`s:${k}`).level), [2, 3, 4, 5, 6]);
});

test('eurodance has house, euro disco and Pop as equal parents and belongs to three families', () => {
  const t = tree();
  const n = t.byId.get('s:eurodance');
  assert.deepEqual(n.parents.sort(), ['g:Pop', 's:euro disco', 's:house']);
  assert.equal(n.level, 2);
  assert.deepEqual(n.fams, ['Electronic', 'Funk / Soul', 'Pop']);
  const off = buildTree(vocabOf(entries), { fusion: false });
  assert.deepEqual(off.byId.get('s:eurodance').parents.sort(), ['s:euro disco', 's:house'], 'fusion off drops only the Pop family link');
  assert.equal(off.byId.get('s:eurodance').level, 3);
});

test('industrial is no longer a genre; its children kept their other parents', () => {
  const t = tree();
  assert.equal(t.byId.has('s:industrial'), false);
  assert.deepEqual(t.byId.get('s:ebm').parentNames, ['synthpop']);
  assert.deepEqual(t.byId.get('s:dark electro').parentNames, ['Electronic']);
  assert.deepEqual(t.byId.get('s:industrial rock').fams, ['Rock']);
});

test('family counts of the tree count a genre in every family it belongs to', () => {
  const f = treeFacts(vocabOf(entries)).familyCounts;
  assert.deepEqual(f.Electronic, doc._meta.counts.Electronic.total === undefined ? f.Electronic : { level2: doc._meta.counts.Electronic.level2, level3: doc._meta.counts.Electronic.level3, level4: doc._meta.counts.Electronic.level4 });
  for (const name of discogs.families) assert.deepEqual(f[name], { level2: doc._meta.counts[name].level2, level3: doc._meta.counts[name].level3, level4: doc._meta.counts[name].level4 }, name);
});

test('Rock: 51 level 2 and 72 level 3 member genres (a genre of two families counts in both), no level 4', () => {
  const t = tree();
  const mine = [...t.byId.values()].filter((n) => n.fams.includes('Rock') && n.level > 1);
  assert.equal(mine.filter((n) => n.level === 2).length, 51);
  assert.equal(mine.filter((n) => n.level === 3).length, 72);
  assert.ok(mine.every((n) => n.level <= 3));
  for (const k of ['mod', 'soft rock', 'stoner rock', 'pub rock', 'southern rock']) assert.equal(t.byId.get(`s:${k}`).parent, 'g:Rock', k);
  assert.equal(t.byId.get('s:krautrock').parent, 's:experimental rock');
  assert.equal(t.byId.get('s:hardcore punk').level, 3);
  assert.ok(['emo', 'grindcore', 'mathcore'].every((k) => t.byId.get('s:hardcore punk').children.some((c) => c.name === k)), 'hardcore punk is a parent of its extra-parent children too');
});
