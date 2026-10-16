import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLevels, buildTree, resolveNode, applyCounts, count, chain, libraryTags, searchMatches, visibleRows, allExpandable, treeKey, otherGenres, filterIds, statusIds, flavourCount, statusKey,
} from './genre-levels.js';
import { VOCAB, SONGS } from './genre-levels-fixture.mjs';

const make = () => { const t = buildTree(VOCAB); applyCounts(t, SONGS); return t; };

test('hasLevels needs a non-empty levels object', () => {
  assert.equal(hasLevels(VOCAB), true);
  assert.equal(hasLevels({ levels: {} }), false);
  assert.equal(hasLevels(null), false);
});

test('tree has three levels, children sorted, level 1 follows families order', () => {
  const t = buildTree(VOCAB);
  assert.deepEqual(t.roots.map((r) => r.name), ['Electronic', 'Rock']);
  assert.deepEqual(t.roots[0].children.map((c) => c.name), ['breakbeat', 'drum and bass', 'house']);
  assert.deepEqual(t.byId.get('s:house').children.map((c) => [c.name, c.level]), [['afro house', 3], ['deep house', 3]]);
  assert.equal(t.byId.get('s:house').level, 2);
  assert.deepEqual(chain(t, 's:deep house').map((n) => n.name), ['Electronic', 'house', 'deep house']);
});

test('counts roll up across three levels and also_under does not double count', () => {
  const t = make();
  assert.equal(count(t.byId.get('s:deep house')), 2);
  assert.equal(count(t.byId.get('s:afro house')), 1);
  assert.equal(count(t.byId.get('s:house')), 2);
  assert.equal(t.byId.get('s:house').own.size, 1);
  assert.equal(count(t.byId.get('s:jungle')), 1);
  assert.equal(count(t.byId.get('s:drum and bass')), 1);
  assert.equal(count(t.byId.get('s:breakbeat')), 0);
  assert.equal(count(t.byId.get('g:Electronic')), 4);
  assert.equal(t.byId.get('g:Electronic').own.size, 1);
  assert.equal(count(t.byId.get('g:Rock')), 1);
});

test('a song with several tags under one node counts once; unknown tags are ignored', () => {
  const t = make();
  assert.equal(t.byId.get('g:Electronic').all.has('s1'), true);
  assert.equal([...t.byId.values()].some((n) => n.all.has('s6')), false);
});

test('synonyms resolve to the canonical node, also with " music" and spelling variants', () => {
  const t = make();
  assert.equal(resolveNode('EDM', t).id, 'g:Electronic');
  assert.equal(resolveNode('Dance  Music', t).id, 'g:Electronic');
  assert.equal(resolveNode('dnb', t).id, 's:drum and bass');
  assert.equal(resolveNode('House music', t).id, 's:house');
  assert.equal(resolveNode('Deep-House', t).id, 's:deep house');
  assert.equal(resolveNode('nothing', t), null);
});

test('search matches names and synonyms and expands to the match', () => {
  const t = make();
  assert.deepEqual([...searchMatches(t, 'dnb')], [['s:drum and bass', 'dnb']]);
  const rows = visibleRows(t, { query: 'jung' });
  assert.deepEqual(rows.map((r) => r.node.name), ['Electronic', 'drum and bass', 'jungle']);
  assert.equal(rows[1].expanded, true);
  assert.equal(rows[2].matched, true);
  const syn = visibleRows(t, { query: 'sound' });
  assert.deepEqual(syn.map((r) => r.node.name), ['Electronic', 'house', 'deep house']);
  assert.equal(syn[2].via, 'deephouse sound');
  assert.deepEqual(visibleRows(t, { query: 'zzz' }), []);
});

test('collapsed by default, expand sets, only-with-songs hides empty nodes', () => {
  const t = make();
  assert.deepEqual(visibleRows(t).map((r) => r.node.name), ['Electronic', 'Rock']);
  const open = visibleRows(t, { expanded: new Set(['g:Electronic', 's:house']) });
  assert.deepEqual(open.map((r) => r.node.name), ['Electronic', 'breakbeat', 'drum and bass', 'house', 'afro house', 'deep house', 'Rock']);
  const some = visibleRows(t, { expanded: allExpandable(t), onlyWithSongs: true });
  assert.deepEqual(some.map((r) => r.node.name), ['Electronic', 'drum and bass', 'jungle', 'house', 'afro house', 'deep house', 'Rock', 'rock and roll']);
});

test('provisional and discogs flags are on the nodes', () => {
  const t = make();
  assert.equal(t.byId.get('s:rock and roll').provisional, true);
  assert.equal(t.byId.get('s:afro house').discogs, false);
  assert.equal(t.byId.get('s:house').discogs, true);
  assert.deepEqual(t.byId.get('s:jungle').alsoUnder, ['breakbeat']);
});

test('libraryTags lists the node and everything below it, not also_under parents', () => {
  const t = make();
  assert.deepEqual(libraryTags(t, 's:house').sort(), ['genre:afro house', 'genre:deep house', 'genre:house']);
  assert.deepEqual(libraryTags(t, 's:breakbeat'), ['genre:breakbeat']);
  assert.ok(libraryTags(t, 'g:Electronic').includes('genre:jungle'));
});

test('treeKey: arrows, home/end, expand/collapse, enter and space', () => {
  const t = make();
  const rows = visibleRows(t, { expanded: new Set(['g:Electronic']) });
  const ids = rows.map((r) => r.node.id);
  assert.deepEqual(treeKey(rows, 'g:Electronic', 'ArrowDown'), { type: 'focus', id: ids[1] });
  assert.equal(treeKey(rows, 'g:Electronic', 'ArrowUp'), null);
  assert.deepEqual(treeKey(rows, 'g:Electronic', 'ArrowRight'), { type: 'focus', id: ids[1] });
  assert.deepEqual(treeKey(rows, 'g:Electronic', 'ArrowLeft'), { type: 'collapse', id: 'g:Electronic', node: 'g:Electronic' });
  assert.deepEqual(treeKey(rows, 's:house', 'ArrowRight'), { type: 'expand', id: 's:house', node: 's:house' });
  assert.deepEqual(treeKey(rows, 's:house', 'ArrowLeft'), { type: 'focus', id: 'g:Electronic' });
  assert.deepEqual(treeKey(rows, 'g:Rock', 'Enter'), { type: 'activate', id: 'g:Rock', node: 'g:Rock', toggle: true });
  assert.deepEqual(treeKey(rows, 's:breakbeat', ' '), { type: 'activate', id: 's:breakbeat', node: 's:breakbeat', toggle: false });
  assert.deepEqual(treeKey(rows, 'g:Rock', 'Home'), { type: 'focus', id: 'g:Electronic' });
  assert.deepEqual(treeKey(rows, 'g:Electronic', 'End'), { type: 'focus', id: 'g:Rock' });
  assert.equal(treeKey(rows, 'g:Rock', 'x'), null);
  assert.deepEqual(treeKey(rows, 'gone', 'ArrowDown'), { type: 'focus', id: 'g:Electronic' });
  assert.equal(treeKey([], 'x', 'ArrowDown'), null);
});

test('status is read from levels, unknown or missing values mean unreviewed', () => {
  const t = make();
  assert.equal(t.byId.get('s:deep house').status, 'question');
  assert.equal(t.byId.get('s:afro house').status, 'approved');
  assert.equal(t.byId.get('s:house').status, null);
  assert.equal(statusKey(t.byId.get('s:house')), 'unreviewed');
  const odd = buildTree({ ...VOCAB, levels: { ...VOCAB.levels, house: { ...VOCAB.levels.house, status: 'maybe' } } });
  assert.equal(odd.byId.get('s:house').status, null);
});

test('status filter keeps matches and their ancestors, and expands to them', () => {
  const t = make();
  assert.equal(statusIds(t, 'all'), null);
  assert.deepEqual([...statusIds(t, 'approved')].sort(), ['g:Electronic', 's:afro house', 's:house']);
  const rows = visibleRows(t, { status: 'question' });
  assert.deepEqual(rows.map((r) => r.node.name), ['Electronic', 'house', 'deep house']);
  assert.equal(rows[1].expanded, true);
  const un = visibleRows(t, { status: 'unreviewed', expanded: allExpandable(t) }).map((r) => r.node.name);
  assert.ok(un.includes('house') && un.includes('jungle') && !un.includes('deep house') && !un.includes('afro house'));
});

test('flavours: unknown keys dropped, counts are distinct songs at styles that carry them', () => {
  const t = make();
  assert.deepEqual(t.byId.get('s:afro house').flavours, ['club', 'dark']);
  assert.deepEqual([...t.flavours.keys()], ['dark', 'club']);
  assert.equal(flavourCount(t, 'club'), 2);
  assert.equal(flavourCount(t, 'dark'), 2);
  assert.equal(flavourCount(t, 'nope'), 0);
  applyCounts(t, []);
  assert.equal(flavourCount(t, 'club'), 0);
});

test('flavour filter is any-of, lists matching styles, and combines with status and search', () => {
  const t = make();
  assert.equal(filterIds(t, { flavours: [] }), null);
  assert.deepEqual([...filterIds(t, { flavours: ['dark'] })].sort(), ['g:Electronic', 's:afro house', 's:drum and bass', 's:house', 's:jungle']);
  assert.deepEqual([...filterIds(t, { flavours: ['club', 'dark'] })].sort(), ['g:Electronic', 's:afro house', 's:deep house', 's:drum and bass', 's:house', 's:jungle']);
  assert.deepEqual([...filterIds(t, { flavours: ['club'], status: 'question' })].sort(), ['g:Electronic', 's:deep house', 's:house']);
  assert.deepEqual([...filterIds(t, { flavours: ['dark'], status: 'question' })], []);
  const rows = visibleRows(t, { flavours: new Set(['dark']) }).map((r) => r.node.name);
  assert.deepEqual(rows, ['Electronic', 'drum and bass', 'jungle', 'house', 'afro house']);
  const both = visibleRows(t, { flavours: ['dark'], query: 'jung' }).map((r) => r.node.name);
  assert.deepEqual(both, ['Electronic', 'drum and bass', 'jungle']);
  assert.deepEqual(visibleRows(t, { flavours: ['dark'], onlyWithSongs: true }).map((r) => r.node.name), ['Electronic', 'drum and bass', 'jungle', 'house', 'afro house']);
});

const withLevels = (patch) => buildTree({ ...VOCAB, levels: Object.fromEntries(Object.entries(VOCAB.levels).map(([k, v]) => [k, { ...v, ...(patch[k] || {}) }])) });

test('approved shows only on styles not in Discogs; question is unaffected', () => {
  const t = withLevels({ house: { status: 'approved' }, 'afro house': { status: 'approved' }, 'deep house': { status: 'question' }, breakbeat: { status: 'approved', discogs: false } });
  assert.equal(t.byId.get('s:house').status, null);
  assert.equal(t.byId.get('s:afro house').status, 'approved');
  assert.equal(t.byId.get('s:deep house').status, 'question');
  assert.equal(t.byId.get('s:breakbeat').status, 'approved');
  assert.equal(statusKey(t.byId.get('s:house')), 'unreviewed');
  assert.deepEqual([...statusIds(t, 'approved')].sort(), ['g:Electronic', 's:afro house', 's:breakbeat', 's:house']);
});

test('display names replace keys in labels and search matches key, display and synonyms', () => {
  const t = withLevels({ 'drum and bass': { display: 'Drum & Bass' }, jungle: { display: '  ' } });
  const dnb = t.byId.get('s:drum and bass');
  assert.equal(dnb.label, 'Drum & Bass');
  assert.equal(dnb.name, 'drum and bass');
  assert.equal(t.byId.get('s:jungle').label, 'jungle');
  assert.equal(t.byId.get('s:house').label, 'house');
  assert.equal(resolveNode('Drum & Bass', t).id, 's:drum and bass');
  for (const q of ['drum and', 'Drum & B', 'dnb']) assert.ok(searchMatches(t, q).has('s:drum and bass'), q);
});

const disco = () => {
  const t = buildTree({
    ...VOCAB,
    levels: {
      ...VOCAB.levels,
      disco: { genre: 'Rock', parent: null, also_under: [], discogs: true, synonyms: [], provisional: true, also_in_genres: ['Electronic'] },
      'euro disco': { genre: 'Electronic', parent: 'disco', also_under: [], discogs: true, synonyms: [], provisional: false },
    },
  });
  applyCounts(t, [...SONGS, { id: 's7', tags: ['genre:euro disco'] }, { id: 's8', tags: ['genre:disco', 'genre:euro disco'] }, { id: 's9', tags: ['genre:disco'] }]);
  return t;
};

test('an umbrella that sits in two genres appears under both with its children', () => {
  const t = disco();
  assert.ok(t.byId.get('g:Electronic').children.some((c) => c.name === 'disco'));
  assert.ok(t.byId.get('g:Rock').children.some((c) => c.name === 'disco'));
  assert.equal(t.byId.get('s:disco').genre, 'Rock');
  assert.deepEqual(t.byId.get('s:disco').alsoIn, ['Electronic']);
  assert.deepEqual(t.byId.get('s:euro disco').parent, 's:disco');
  assert.deepEqual(otherGenres(t.byId.get('s:disco'), 'Electronic'), ['Rock']);
  assert.deepEqual(otherGenres(t.byId.get('s:disco'), 'Rock'), ['Electronic']);
  assert.deepEqual(otherGenres(t.byId.get('s:house'), 'Electronic'), []);
});

test('songs under a two-genre umbrella count once per genre root and once per node', () => {
  const t = disco();
  assert.equal(count(t.byId.get('s:disco')), 3);
  assert.equal(count(t.byId.get('s:euro disco')), 2);
  assert.equal(count(t.byId.get('g:Electronic')), 4 + 3);
  assert.equal(count(t.byId.get('g:Rock')), 1 + 3);
  const rows = visibleRows(t, { expanded: allExpandable(t) });
  assert.ok(rows.filter((r) => r.node.name === 'disco').length === 2);
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  const second = rows.filter((r) => r.node.name === 'euro disco');
  assert.equal(second.length, 2);
  assert.ok(second[0].key === 's:euro disco' && second[1].key === 'g:Rock|s:euro disco');
  const under = rows.find((r) => r.key === 'g:Rock|s:euro disco');
  assert.equal(under.parentKey, rows.filter((r) => r.node.name === 'disco')[1].key);
  assert.deepEqual(treeKey(rows, under.key, 'ArrowLeft'), { type: 'focus', id: under.parentKey });
});
