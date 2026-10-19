import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTree } from './genre-levels.js';
import { treeFacts } from './genre-tree-facts.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const doc = read('../../server/data/genre_levels.json');
const discogs = read('../../server/data/genre_discogs.json');
const HEAD = read('../../server/tests/fixtures/genre_parents_snapshot_web.json');

const SECOND_FAMILY_ADDED = ['acid jazz', 'blues rock', 'bossa nova', 'country rock', 'dub', 'electro', 'experimental', 'folk rock', 'funk metal', 'gospel', 'grime', 'hardcore', 'hip house', 'jazz funk', 'latin jazz', 'modern classical', 'new wave', 'noise', 'rhythm and blues', 'soul jazz', 'synthpop', 'trap', 'trip hop'];

const NINE = ['hardcore punk', 'experimental rock', 'extreme metal', 'noise rock', 'roots rock', 'neo-psychedelia', 'glam metal', 'college rock', 'death-doom'];

const BEFORE_RELATED = {
  minimal: ['Electronic', 'techno', 'house'], 'witch house': ['Electronic', 'industrial'], breakcore: ['breakbeat', 'hardcore'], chillwave: ['synthwave', 'downtempo'],
  vaporwave: ['synthwave', 'downtempo'], 'dark electro': ['industrial', 'electro'], 'dungeon synth': ['ambient', 'synthwave'], 'future bass': ['bass music', 'house'],
  jungle: ['drum and bass', 'breakbeat'], 'melodic techno': ['techno', 'trance'], microhouse: ['house', 'techno'], 'minimal techno': ['techno', 'house'],
  neurofunk: ['drum and bass', 'industrial'], darksynth: ['synthwave', 'industrial'], hardcore: ['Electronic', 'Rock'], noise: ['Electronic', 'Rock'], grime: ['Electronic', 'Hip Hop'],
  trap: ['Hip Hop', 'Electronic'], 'acid jazz': ['Jazz', 'Electronic'], 'new wave': ['Rock', 'Electronic'], 'modern classical': ['Classical', 'Electronic'], gospel: ['Funk / Soul', 'Folk, World, & Country'],
};

const entries = Object.fromEntries(Object.entries(doc).filter(([k]) => !['_meta', 'families', 'flavours', 'subfamilies'].includes(k)));
const vocabOf = (levels) => ({
  families: discogs.families,
  family_synonyms: Object.fromEntries(Object.entries(doc.families).map(([k, v]) => [k, v.synonyms])),
  flavours: doc.flavours,
  levels: Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { synonyms: [], provisional: false, ...v }])),
  genres: [],
});

test('the tree built from parents lists is identical to the snapshot taken from the old parent/also_under data (before the two edits of 2026-10-19, the 23 second families and the Rock tree of DR1)', () => {
  const levels = Object.fromEntries(Object.entries(structuredClone(entries)).map(([k, v]) => [k === 'sovietwave' ? 'soviet wave' : k, v]));
  const rockKeys = Object.keys(levels).filter((k) => !NINE.includes(k) && (levels[k].parents[0] === 'Rock' || levels[levels[k].parents[0]]?.parents[0] === 'Rock'));
  for (const k of rockKeys.filter((x) => !(x in BEFORE_RELATED))) {
    levels[k].parents = k === 'funk metal' ? ['Rock', 'Funk / Soul'] : ['Rock'];
    delete levels[k].related;
    if (k !== 'funk metal') delete levels[k].fusion;
    levels[k].provisional = true;
  }
  for (const [k, parents] of Object.entries(BEFORE_RELATED)) {
    levels[k].parents = parents;
    delete levels[k].related;
  }
  levels.spacesynth.parents = ['Electronic', 'italo disco'];
  delete levels['space disco'];
  delete levels.edm;
  for (const k of NINE) delete levels[k];
  for (const k of SECOND_FAMILY_ADDED) levels[k].parents = levels[k].parents.slice(0, -1);
  const restored = Object.fromEntries(Object.entries(levels).flatMap(([k, v]) => (k === 'eurodance' ? [['eurobeat', { parents: ['Electronic'], discogs: true }], [k, v]] : [[k, v]])));
  const now = JSON.parse(JSON.stringify(treeFacts(vocabOf(restored))));
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
  assert.deepEqual(node('gospel').alsoIn, []);
  assert.equal(node('gospel').family, 'Folk, World, & Country');
  assert.deepEqual(node('spacesynth').alsoUnder, ['italo disco']);
  assert.ok(!t.byId.get('s:italo disco').children.includes(node('spacesynth')), 'a cross-link is not a child');
  assert.equal(node('jungle').parent, 's:breakbeat');
  assert.deepEqual(node('jungle').alsoUnder, []);
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
  assert.equal(n.label, 'space disco');
  assert.equal(n.discogs, false);
  assert.equal(n.status, 'approved');
  assert.deepEqual(n.synonyms, ['space-disco']);
  assert.deepEqual(n.alsoIn, []);
  assert.deepEqual(n.alsoUnder, []);
  assert.ok(t.byId.get('s:disco').children.includes(n));
});

test('Electronic counts after the two edits and electronic rock (DR1: Rock blend with the Electronic family, 52 + 1 level 2)', () => {
  const f = treeFacts(vocabOf(entries)).familyCounts.Electronic;
  assert.deepEqual(f, { level2: 53, level3: 95 });
});

test('Rock after DR1: 42 level 2 and 69 level 3 genres, no level 4, the held genres stay under Rock', () => {
  const t = buildTree(vocabOf(entries));
  const mine = [...t.byId.values()].filter((n) => n.family === 'Rock' && n.level > 1);
  assert.equal(mine.filter((n) => n.level === 2).length, 42);
  assert.equal(mine.filter((n) => n.level === 3).length, 69);
  assert.ok([...t.byId.values()].every((n) => n.level <= 3));
  for (const k of ['mod', 'soft rock', 'stoner rock', 'pub rock', 'southern rock']) assert.equal(t.byId.get(`s:${k}`).parent, 'g:Rock', k);
  assert.equal(t.byId.get('s:krautrock').parent, 's:experimental rock');
  assert.equal(t.byId.get('s:hardcore punk').level, 3);
  assert.ok(t.byId.get('s:hardcore punk').children.length === 0);
});
