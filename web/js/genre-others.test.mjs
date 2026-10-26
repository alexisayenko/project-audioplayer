import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts, genreLines, resolveNode, libraryTags, visibleRows, populatedFamilies, count } from './genre-levels.js';
import { buildMapGraph, seedPositions } from './genre-map-graph.js';
import { layoutRadial, defaultRoot } from './genre-radial.js';
import { familyIndex, pieIndices, OTHER_COLOR, FAMILY_ORDER, SPARE_SLOTS, HIDDEN_FAMILY_NODES } from './genre-data.js';
import { shadeTable, MAX_SHADES } from './genre-shade.js';
import { buildIndex, resolveGenre, searchGenres, didYouMean, isGroupText } from './genre-vocab.js';
import { OTHERS_VOCAB, OTHERS_SONGS, promote } from './genre-others-fixture.mjs';
import { realVocab } from './genre-real-vocab.mjs';

const treeOf = (vocab = OTHERS_VOCAB, songs = OTHERS_SONGS) => { const t = buildTree(vocab); applyCounts(t, songs); return t; };

test('Others is a level 1 group node: flagged, temporary, never a genre, with the neutral colour slot and the vocabulary family order', () => {
  const t = treeOf();
  const g = t.byId.get('g:Others');
  assert.deepEqual([g.level, g.group, g.temporary, g.form], [1, true, true, undefined]);
  assert.equal(g.label, 'Others');
  assert.deepEqual(t.roots.map((r) => r.name), ['Blues', 'Others', 'Rock']);
  assert.deepEqual(FAMILY_ORDER.slice(0, 3), ['Blues', 'Others', 'Rock']);
  assert.equal(familyIndex('Others'), OTHER_COLOR, 'a group is drawn in the neutral colour, not in the legacy Electronic slot');
  assert.equal(familyIndex('Rock'), 1);
  assert.deepEqual(t.byId.get('s:house').fams, ['Others']);
  assert.deepEqual(pieIndices(t.byId.get('s:house').fams), [OTHER_COLOR]);
  assert.ok(!t.byId.has('s:electronic') && !t.byId.has('s:others'));
});

test('the radial default root is derived from the vocabulary, never a hardcoded family', () => {
  const t = treeOf();
  assert.equal(defaultRoot(t), 'Others', 'the family with the most songs');
  assert.equal(defaultRoot(treeOf(OTHERS_VOCAB, [{ id: 'r', tags: ['genre:rock and roll'] }])), 'Rock');
  const only = treeOf(OTHERS_VOCAB, [{ id: 'z', tags: ['genre:techno'] }]);
  assert.equal(defaultRoot(only), 'Others');
  assert.equal(layoutRadial(only).root, 'g:Others');
  assert.equal(defaultRoot(null), null);
  assert.deepEqual(HIDDEN_FAMILY_NODES, []);
  const l = layoutRadial(only, 'Others', { hidden: false });
  const root = l.byId.get('g:Others');
  assert.deepEqual([root.x, root.y, root.hue, root.node.group], [0, 0, OTHER_COLOR, true]);
  assert.ok(l.edges.some((e) => e.from === 'g:Others' && e.to === 's:techno'));
});

test('genres under Others are grey in the graph and carry the neutral shade ladder of their subfamily', () => {
  const g = buildMapGraph(treeOf());
  assert.equal(g.byId.get('g:Others').fi, OTHER_COLOR);
  assert.deepEqual(g.byId.get('s:house').fis, [OTHER_COLOR]);
  assert.equal(g.subIdx, OTHER_COLOR, 'the subfamily shades are applied to the neutral slot');
  const ladder = shadeTable('#8a8f93');
  assert.equal(ladder.length, MAX_SHADES + 1);
  assert.ok(new Set(ladder.slice(1)).size > 5, 'the ladder keeps its steps on a neutral base');
  seedPositions(g);
  assert.ok(g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
});

test('a stored genre that is not in the vocabulary (electronic) never crashes: it is not counted anywhere and shows as typed on the line without a family', () => {
  const t = treeOf();
  assert.equal(resolveNode('electronic', t).id, 'g:Others', 'the name still finds the group for search');
  assert.equal(t.byId.get('g:Others').own.size, 0, 'a group is never counted as a song genre');
  assert.deepEqual([...t.byId.get('g:Others').all].sort(), ['a', 'c', 'd'], 'song b has only the unknown genre and is in no node; the others roll up from their real genres');
  assert.deepEqual(genreLines(t, ['electronic']), [{ family: null, genres: ['electronic'] }]);
  assert.deepEqual(genreLines(t, ['house', 'electronic']), [{ family: 'Others', genres: ['Others', 'house'] }, { family: null, genres: ['electronic'] }]);
  assert.deepEqual(genreLines(t, ['Others']), [{ family: null, genres: ['Others'] }]);
  assert.deepEqual(genreLines(null, ['electronic']), [{ family: null, genres: ['electronic'] }]);
});

test('the song card line of a genre under Others starts with the Others chip; each family keeps its own line', () => {
  const t = treeOf();
  assert.deepEqual(genreLines(t, ['deep house', 'techno', 'rock and roll']), [
    { family: 'Others', genres: ['Others', 'techno', 'deep house'] },
    { family: 'Rock', genres: ['Rock', 'rock and roll'] },
  ]);
});

test('counts: songs under Others roll up, the group has no songs of its own, and the library filter never gets genre:Others', () => {
  const t = treeOf();
  assert.equal(count(t.byId.get('g:Others')), 3);
  assert.deepEqual(populatedFamilies(t), ['Others', 'Rock']);
  const tags = libraryTags(t, 'g:Others');
  assert.ok(tags.includes('genre:house') && tags.includes('genre:deep house') && !tags.includes('genre:Others'));
  assert.deepEqual(libraryTags(t, 'g:Rock').sort(), ['genre:Rock', 'genre:rock and roll']);
});

test('the Outline lists Others as a row that can be found by its old names', () => {
  const t = treeOf();
  const rows = visibleRows(t, { expanded: new Set(['g:Others']) });
  assert.deepEqual(rows.map((r) => r.node.label).slice(0, 2), ['Blues', 'Others']);
  const hit = visibleRows(t, { query: 'electronica' });
  assert.ok(hit.some((r) => r.node.id === 'g:Others' && r.via === 'electronica'));
});

test('the picker index never offers or resolves a group, its synonyms or electronic', () => {
  const noise = {
    ...OTHERS_VOCAB,
    genres: [...OTHERS_VOCAB.genres, { name: 'Others', family: 'Others', level: 'family' }, { name: 'electronic', family: 'Others', level: 'genre' }],
    aliases: { ...OTHERS_VOCAB.aliases, electronica: 'house', electronic: 'house' },
  };
  const idx = buildIndex(noise);
  assert.ok(!idx.names.includes('Others') && !idx.names.includes('electronic'));
  for (const text of ['Others', 'others', 'electronic', 'Electronic music', 'electronica']) {
    assert.equal(resolveGenre(text, idx), null, text);
    assert.equal(isGroupText(text, idx), true, text);
  }
  assert.equal(resolveGenre('house', idx).name, 'house');
  assert.equal(resolveGenre('dance music', idx).name, 'edm');
  assert.equal(isGroupText('house', idx), false);
  assert.ok(!searchGenres('oth', idx).some((e) => e.name === 'Others'));
  assert.ok(searchGenres('electron', idx).every((e) => e.name !== 'electronic'));
  assert.ok(!didYouMean('Other', idx).includes('Others'));
  assert.equal(buildIndex({ ...OTHERS_VOCAB, genres: [{ name: 'x', assignable: false }, { name: 'y' }] }).names.join(), 'y');
});

test('any number of level 1 forms from the vocabulary render generically, with their display label and the colour of their group', () => {
  let vocab = promote(OTHERS_VOCAB, 'house', { display: 'House' });
  const extra = Array.from({ length: 22 }, (_, i) => `zz form ${i}`);
  vocab = {
    ...vocab,
    families: [...vocab.families, ...extra],
    forms: { ...vocab.forms, ...Object.fromEntries(extra.map((k) => [k, { level: 1, parents: [], discogs: true, synonyms: [], display: null, modifiers: [], form: true }])) },
  };
  const t = treeOf(vocab, [...OTHERS_SONGS, { id: 'f', tags: ['genre:zz form 3'] }]);
  const house = t.byId.get('g:house');
  assert.deepEqual([house.level, house.form, house.label, house.parents], [1, true, 'House', []]);
  assert.equal(t.byId.get('s:deep house').level, 2);
  assert.deepEqual(t.byId.get('s:deep house').fams, ['house']);
  assert.equal(familyIndex('house'), 0, 'a promoted genre inherits the legacy colour slot of its group');
  assert.equal(resolveNode('house', t).id, 'g:house');
  assert.equal(resolveNode('House', t).id, 'g:house');
  for (const k of extra) assert.ok(SPARE_SLOTS.includes(familyIndex(k)), `${k} falls back to a spare palette slot`);
  assert.equal(t.roots.length, 3 + 1 + 22);
  assert.ok(t.roots.every((r) => familyIndex(r.name) >= 0 && familyIndex(r.name) < 16));
  assert.deepEqual(genreLines(t, ['deep house', 'house']), [{ family: 'house', genres: ['House', 'deep house'] }]);
  assert.deepEqual(genreLines(t, ['zz form 3']), [{ family: 'zz form 3', genres: ['zz form 3'] }]);
  assert.equal(count(house), 2);
  const g = buildMapGraph(t);
  assert.equal(g.byId.get('g:house').level, 1);
  assert.ok(g.links.some((l) => l.source === 'g:house' && l.target === 's:deep house'));
  assert.equal(g.byId.get('s:deep house').fi, 0);
  const l = layoutRadial(t, 'house', { hidden: false });
  assert.ok(l.byId.get('g:house') && l.byId.has('s:deep house'));
  assert.deepEqual(libraryTags(t, 'g:house').sort(), ['genre:deep house', 'genre:house']);
  assert.deepEqual(visibleRows(t, {}).filter((r) => r.level === 1).map((r) => r.node.label).slice(0, 4), ['Blues', 'Others', 'House', 'Rock']);
});

test('a form with other parents keeps level 1, sits under each parent and has the families of all of them', () => {
  const vocab = promote(OTHERS_VOCAB, 'edm', { parents: ['house', 'Rock'], colour: 'Rock', display: 'EDM' });
  const t = treeOf(vocab, [{ id: 'e', tags: ['genre:edm'] }]);
  const edm = t.byId.get('g:edm');
  assert.deepEqual([edm.level, [...edm.parents].sort(), edm.fams], [1, ['g:Rock', 's:house'], ['Others', 'edm', 'Rock']]);
  assert.equal(familyIndex('edm'), 1, 'its own colour names Rock');
  assert.ok(t.byId.get('s:house').children.includes(edm) && t.byId.get('g:Rock').all.has('e') && t.byId.get('g:Others').all.has('e'));
});

test('the real vocabulary builds with Others as the only group and no electronic anywhere in the tree', () => {
  const t = buildTree(realVocab());
  assert.deepEqual(t.roots.filter((r) => r.group).map((r) => r.name), ['Others']);
  assert.equal(t.byId.has('s:electronic'), false);
  assert.equal(familyIndex('Others'), OTHER_COLOR);
  assert.equal(t.byId.get('g:house').fams[0], 'house', 'house is a level 1 form since 2026-10-20');
  assert.equal(t.byId.get('s:breakbeat').fams[0], 'Others');
  assert.equal(genreLines(t, ['breakbeat', 'ambient'])[0].family, 'Others');
  assert.equal(genreLines(t, ['breakbeat', 'ambient']).length, 1);
  assert.deepEqual(genreLines(t, ['house', 'trance']).map((l) => l.family), ['house', 'trance']);
});

test('the hex table colours forms from their own spare slot and families on their legacy slot; bad values are ignored', () => {
  const vocab = { ...promote(promote(OTHERS_VOCAB, 'house'), 'techno'), hex: { house: '#F7DF6A', Rock: '#112233', Blues: 'red' } };
  treeOf(vocab);
  assert.ok(SPARE_SLOTS.includes(familyIndex('house')), 'a form takes a spare slot');
  assert.equal(familyIndex('techno'), 0, 'a form without hex keeps its group slot');
  assert.equal(familyIndex('Rock'), 1, 'a family keeps its legacy slot');
});
