import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasLevels, buildTree, resolveNode, applyCounts, count, populatedFamilies, genresWithSongs, chain, libraryTags, genreLines, searchMatches, visibleRows, allExpandable, treeKey, otherGenres, filterIds, statusIds, modifierCount, statusKey,
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

test('counts roll up across levels and a genre with two parents counts under both without double counting', () => {
  const t = make();
  assert.equal(count(t.byId.get('s:deep house')), 2);
  assert.equal(count(t.byId.get('s:afro house')), 1);
  assert.equal(count(t.byId.get('s:house')), 2);
  assert.equal(t.byId.get('s:house').own.size, 1);
  assert.equal(count(t.byId.get('s:jungle')), 1);
  assert.equal(count(t.byId.get('s:drum and bass')), 1);
  assert.equal(count(t.byId.get('s:breakbeat')), 1);
  assert.equal(t.byId.get('s:breakbeat').own.size, 0);
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
  assert.deepEqual(rows.map((r) => r.node.name), ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle']);
  assert.equal(rows[1].expanded, true);
  assert.equal(rows[2].matched, true);
  assert.equal(rows[4].matched, true);
  assert.deepEqual(rows.map((r) => r.level), [1, 2, 3, 2, 3]);
  assert.equal(rows[4].key, `${rows[3].key}|s:jungle`);
  assert.deepEqual([rows[2].parentId, rows[4].parentId], ['s:breakbeat', 's:drum and bass']);
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
  assert.equal(open[1].hasChildren, true);
  const some = visibleRows(t, { expanded: allExpandable(t), onlyWithSongs: true });
  assert.deepEqual(some.map((r) => r.node.name), ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle', 'house', 'afro house', 'deep house', 'Rock', 'rock and roll']);
});

test('populatedOnly search skips genres without library songs; populated rows keep their ancestors', () => {
  const t = make();
  assert.ok(searchMatches(t, 'breakbeat').has('s:breakbeat'));
  assert.deepEqual([...searchMatches(t, 'breakbeat', { populatedOnly: true }).keys()], ['s:breakbeat']);
  assert.deepEqual([...searchMatches(t, 'dnb', { populatedOnly: true }).keys()], ['s:drum and bass']);
  assert.deepEqual(visibleRows(t, { query: 'zzz', onlyWithSongs: true }).map((r) => r.node.name), []);
  assert.deepEqual(visibleRows(t, { query: 'jungle', onlyWithSongs: true }).map((r) => r.node.name), ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle']);
});

test('populatedFamilies lists families with songs, most songs first, ties by name', () => {
  const t = make();
  assert.deepEqual(populatedFamilies(t), ['Electronic', 'Rock']);
  applyCounts(t, [{ id: 'a', tags: ['genre:rock and roll'] }, { id: 'b', tags: ['genre:rock and roll'] }, { id: 'c', tags: ['genre:house'] }]);
  assert.deepEqual(populatedFamilies(t), ['Rock', 'Electronic']);
  applyCounts(t, [{ id: 'a', tags: ['genre:rock and roll'] }, { id: 'c', tags: ['genre:house'] }]);
  assert.deepEqual(populatedFamilies(t), ['Electronic', 'Rock']);
  applyCounts(t, [{ id: 'x', tags: ['mood:calm', 'genre:unknown thing'] }]);
  assert.deepEqual(populatedFamilies(t), []);
  assert.deepEqual(populatedFamilies(null), []);
});

test('genresWithSongs counts displayed nodes with songs of their own, not connectors', () => {
  assert.equal(genresWithSongs(null), 0);
  assert.equal(genresWithSongs({ nodes: [{ node: { own: new Set(['a']) } }, { node: { own: new Set() } }] }), 1);
});

test('provisional and discogs flags are on the nodes', () => {
  const t = make();
  assert.equal(t.byId.get('s:rock and roll').provisional, true);
  assert.equal(t.byId.get('s:afro house').discogs, false);
  assert.equal(t.byId.get('s:house').discogs, true);
  assert.deepEqual(t.byId.get('s:jungle').parentNames, ['drum and bass', 'breakbeat']);
  assert.deepEqual(t.byId.get('s:jungle').parents, ['s:drum and bass', 's:breakbeat']);
  assert.equal(t.byId.get('s:jungle').parent, 's:breakbeat');
});

test('libraryTags lists the node and everything below it, through every parent', () => {
  const t = make();
  assert.deepEqual(libraryTags(t, 's:house').sort(), ['genre:afro house', 'genre:deep house', 'genre:house']);
  assert.deepEqual(libraryTags(t, 's:breakbeat'), ['genre:breakbeat', 'genre:jungle']);
  assert.equal(libraryTags(t, 'g:Electronic').filter((x) => x === 'genre:jungle').length, 1);
  assert.ok(libraryTags(t, 'g:Electronic').includes('genre:jungle'));
  assert.ok(libraryTags(t, 'g:Electronic').includes('genre:Electronic'), 'the genre own tag is part of its filter, so songs tagged only with the genre are found');
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
  assert.deepEqual(treeKey(rows, 's:breakbeat', ' '), { type: 'activate', id: 's:breakbeat', node: 's:breakbeat', toggle: true });
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

test('modifiers: unknown keys dropped, counts are distinct songs at styles that carry them', () => {
  const t = make();
  assert.deepEqual(t.byId.get('s:afro house').modifiers, ['club', 'dark']);
  assert.deepEqual([...t.modifiers.keys()], ['dark', 'club']);
  assert.equal(modifierCount(t, 'club'), 2);
  assert.equal(modifierCount(t, 'dark'), 2);
  assert.equal(modifierCount(t, 'nope'), 0);
  applyCounts(t, []);
  assert.equal(modifierCount(t, 'club'), 0);
});
test('modifier kinds sound, mood and scene stay distinct and the deprecated flavours keys still load', () => {  const t = make();  assert.deepEqual([...t.modifiers.values()].map((m) => m.kind), ['mood', 'scene']);  const { modifiers, ...rest } = VOCAB;  const old = { ...rest, flavours: modifiers, levels: Object.fromEntries(Object.entries(VOCAB.levels).map(([k, v]) => [k, { ...v, flavours: v.modifiers, modifiers: undefined }])) };  const o = buildTree(old);  assert.deepEqual([...o.modifiers.keys()], ['dark', 'club']);  assert.deepEqual(o.byId.get('s:afro house').modifiers, ['club', 'dark']);});

test('modifier filter is any-of, lists matching styles, and combines with status and search', () => {
  const t = make();
  assert.equal(filterIds(t, { modifiers: [] }), null);
  assert.deepEqual([...filterIds(t, { modifiers: ['dark'] })].sort(), ['g:Electronic', 's:afro house', 's:breakbeat', 's:drum and bass', 's:house', 's:jungle']);
  assert.deepEqual([...filterIds(t, { modifiers: ['club', 'dark'] })].sort(), ['g:Electronic', 's:afro house', 's:breakbeat', 's:deep house', 's:drum and bass', 's:house', 's:jungle']);
  assert.deepEqual([...filterIds(t, { modifiers: ['club'], status: 'question' })].sort(), ['g:Electronic', 's:deep house', 's:house']);
  assert.deepEqual([...filterIds(t, { modifiers: ['dark'], status: 'question' })], []);
  const rows = visibleRows(t, { modifiers: new Set(['dark']) }).map((r) => r.node.name);
  assert.deepEqual(rows, ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle', 'house', 'afro house']);
  const both = visibleRows(t, { modifiers: ['dark'], query: 'jung' }).map((r) => r.node.name);
  assert.deepEqual(both, ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle']);
  assert.deepEqual(visibleRows(t, { modifiers: ['dark'], onlyWithSongs: true }).map((r) => r.node.name), ['Electronic', 'breakbeat', 'jungle', 'drum and bass', 'jungle', 'house', 'afro house']);
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
      disco: { parents: ['Rock', 'Electronic'], discogs: true, synonyms: [], provisional: true },
      'euro disco': { parents: ['disco'], discogs: true, synonyms: [], provisional: false },
    },
  });
  applyCounts(t, [...SONGS, { id: 's7', tags: ['genre:euro disco'] }, { id: 's8', tags: ['genre:disco', 'genre:euro disco'] }, { id: 's9', tags: ['genre:disco'] }]);
  return t;
};

test('an umbrella that sits in two genres appears under both with its children', () => {
  const t = disco();
  assert.ok(t.byId.get('g:Electronic').children.some((c) => c.name === 'disco'));
  assert.ok(t.byId.get('g:Rock').children.some((c) => c.name === 'disco'));
  assert.deepEqual(t.byId.get('s:disco').fams, ['Electronic', 'Rock']);
  assert.deepEqual(t.byId.get('s:euro disco').fams, ['Electronic', 'Rock']);
  assert.equal(t.byId.get('s:disco').family, 'Electronic');
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
  const discoRows = rows.filter((r) => r.node.name === 'disco');
  assert.ok(second[0].key === 's:euro disco' && second[1].key === `${discoRows[1].key}|s:euro disco`);
  const under = rows.find((r) => r.key === `${discoRows[1].key}|s:euro disco`);
  assert.equal(under.parentKey, rows.filter((r) => r.node.name === 'disco')[1].key);
  assert.deepEqual(treeKey(rows, under.key, 'ArrowLeft'), { type: 'focus', id: under.parentKey });
});

test('genreLines infers the level 1 family even when only a deeper genre is tagged', () => {
  assert.deepEqual(genreLines(make(), ['deep house']), [{ family: 'Electronic', genres: ['Electronic', 'deep house'] }]);
});

test('genreLines puts each family on its own line in family order, tagged level 1 and synonyms not repeated', () => {
  assert.deepEqual(genreLines(make(), ['rock and roll', 'house', 'edm', 'Electronic']), [
    { family: 'Electronic', genres: ['Electronic', 'house'] },
    { family: 'Rock', genres: ['Rock', 'rock and roll'] },
  ]);
});

test('genreLines orders a family by level, then alphabetically', () => {
  assert.deepEqual(genreLines(make(), ['jungle', 'deep house', 'house', 'afro house', 'breakbeat'])[0].genres, ['Electronic', 'breakbeat', 'house', 'afro house', 'deep house', 'jungle']);
});

test('genreLines lists a genre under two families on both lines, with its children', () => {
  const t = disco();
  const lines = genreLines(t, ['euro disco', 'disco']);
  assert.deepEqual(lines, [
    { family: 'Electronic', genres: ['Electronic', 'disco', 'euro disco'] },
    { family: 'Rock', genres: ['Rock', 'disco', 'euro disco'] },
  ]);
});

test('genreLines sends unknown genres to a final line without a family and copes with empty input', () => {
  assert.deepEqual(genreLines(make(), ['zzz thing', 'house', 'aaa thing']), [
    { family: 'Electronic', genres: ['Electronic', 'house'] },
    { family: null, genres: ['aaa thing', 'zzz thing'] },
  ]);
  assert.deepEqual(genreLines(make(), []), []);
  assert.deepEqual(genreLines(make(), undefined), []);
  assert.deepEqual(genreLines(null, ['trap', 'house']), [{ family: null, genres: ['house', 'trap'] }]);
});

const MULTI = {
  families: ['Electronic', 'Funk / Soul', 'Pop', 'Rock'], genres: [], aliases: {}, family_synonyms: {}, modifiers: {},
  levels: {
    house: { parents: ['Electronic'], discogs: true },
    'deep house': { parents: ['house'], discogs: true },
    disco: { parents: ['Funk / Soul', 'Electronic'], discogs: true },
    'euro disco': { parents: ['disco'], discogs: true },
    eurodance: { parents: ['house', 'euro disco', 'Pop'], discogs: true },
    'hands up': { parents: ['eurodance'], discogs: true },
    'new wave': { parents: ['Rock'], discogs: true },
    synthpop: { parents: ['Electronic', 'Pop', 'new wave'], discogs: true },
    ebm: { parents: ['synthpop'], discogs: true },
  },
};
const multi = (songs) => { const t = buildTree(MULTI); applyCounts(t, songs.map((tags, i) => ({ id: `m${i}`, tags }))); return t; };

test('a song counts in every family its genre belongs to, once per node, and a family chip lists each of them', () => {
  const t = multi([['genre:euro disco'], ['genre:synthpop'], ['genre:deep house']]);
  assert.deepEqual(t.byId.get('s:euro disco').fams, ['Electronic', 'Funk / Soul']);
  assert.equal(count(t.byId.get('g:Electronic')), 3);
  assert.equal(count(t.byId.get('g:Funk / Soul')), 1);
  assert.equal(count(t.byId.get('g:Pop')), 1);
  assert.equal(count(t.byId.get('g:Rock')), 1);
  assert.deepEqual(populatedFamilies(t), ['Electronic', 'Funk / Soul', 'Pop', 'Rock']);
  assert.equal(count(t.byId.get('s:disco')), 1);
  assert.equal(count(t.byId.get('s:new wave')), 1);
  assert.equal(count(t.byId.get('s:house')), 1);
});

test('a genre of three families counts in all three and in every ancestor, a song with several such genres counts once', () => {
  const t = multi([['genre:hands up', 'genre:eurodance']]);
  for (const id of ['g:Electronic', 'g:Funk / Soul', 'g:Pop', 's:eurodance', 's:house', 's:euro disco', 's:disco']) assert.equal(count(t.byId.get(id)), 1, id);
  assert.equal(count(t.byId.get('g:Rock')), 0);
  assert.equal(t.byId.get('s:hands up').level, 3);
  assert.equal(t.byId.get('s:eurodance').level, 2, 'level 2 through the Pop family parent, the shortest path');
  assert.equal(t.byId.get('s:ebm').level, 3);
});

test('the outline lists a genre under each of its parents with its own depth along that path; a deep chain has no cap', () => {
  const t = multi([['genre:hands up']]);
  const rows = visibleRows(t, { expanded: allExpandable(t) });
  const euro = rows.filter((r) => r.node.name === 'eurodance');
  assert.deepEqual(euro.map((r) => [r.parentId, r.level]).sort(), [['g:Pop', 2], ['s:euro disco', 4], ['s:euro disco', 4], ['s:house', 3]].sort());
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
  const hands = rows.filter((r) => r.node.name === 'hands up');
  assert.equal(hands.length, 4, 'once under each of the four eurodance rows');
  assert.ok(hands.every((r) => r.hasChildren === false));
  const deep = buildTree({ families: ['Rock'], levels: { a: { parents: ['Rock'] }, b: { parents: ['a'] }, c: { parents: ['b'] }, d: { parents: ['c'] }, e: { parents: ['d'] } }, modifiers: {}, genres: [] });
  applyCounts(deep, [{ id: '1', tags: ['genre:e'] }]);
  assert.deepEqual(visibleRows(deep, { expanded: allExpandable(deep) }).map((r) => [r.node.name, r.level]), [['Rock', 1], ['a', 2], ['b', 3], ['c', 4], ['d', 5], ['e', 6]]);
  assert.deepEqual(genreLines(deep, ['e']), [{ family: 'Rock', genres: ['Rock', 'e'] }]);
});

test('genreLines puts a multi-family genre on each family line with its depth along that family', () => {
  const t = multi([]);
  assert.deepEqual(genreLines(t, ['eurodance']), [
    { family: 'Electronic', genres: ['Electronic', 'eurodance'] },
    { family: 'Funk / Soul', genres: ['Funk / Soul', 'eurodance'] },
    { family: 'Pop', genres: ['Pop', 'eurodance'] },
  ]);
  const lines = genreLines(t, ['hands up', 'house', 'euro disco', 'disco']);
  assert.deepEqual(lines.find((l) => l.family === 'Electronic').genres, ['Electronic', 'disco', 'house', 'euro disco', 'hands up']);
  assert.deepEqual(lines.find((l) => l.family === 'Funk / Soul').genres, ['Funk / Soul', 'disco', 'euro disco', 'hands up']);
});
