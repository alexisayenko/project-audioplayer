import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts, resolveNode, count } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { realVocab } from './genre-real-vocab.mjs';

const live = [
  { id: 'a', tags: ['genre:soviet wave', 'genre:synthwave', 'decade:20s'], genres: ['soviet wave', 'synthwave'] },
  { id: 'b', tags: ['genre:Soviet Wave'], genres: ['Soviet Wave'] },
  { id: 'c', genres: ['soviet wave', 'electronic'] },
  { id: 'd', tags: ['genre:sovietwave', 'genre:drum and bass', 'genre:r&b'] },
  { id: 'e', tags: ['genre:drum & bass', 'genre:Drum And Bass', 'genre:rnb'], genres: ['drum and bass'] },
];

test('library songs are counted from genre: tags and from bare genres, case, spacing and synonyms resolved, every level', () => {
  const t = buildTree(realVocab());
  applyCounts(t, live);
  const sov = t.byId.get('s:sovietwave');
  assert.deepEqual([...sov.own].sort(), ['a', 'b', 'c', 'd'], 'own count: exact tags, bare genres only, a synonym spelling');
  const synth = t.byId.get('g:synthwave');
  assert.equal(synth.own.size, 1);
  assert.ok(['a', 'b', 'c', 'd'].every((id) => synth.all.has(id)), 'the subtree count of the parent includes the child songs');
  assert.ok(count(synth) > synth.own.size);
  assert.equal(t.byId.get('g:drum and bass').own.size, 2);
  assert.equal(t.byId.get('s:r&b').own.has('d'), true);
  assert.equal(t.byId.get('g:synthwave').all.has('c'), true, 'the songs of a level 1 form are counted under the form');
  assert.equal(t.byId.get('g:Others').all.has('c'), false, 'synthwave and drum and bass left Others (2026-10-20)');
  assert.equal(resolveNode('Soviet  Wave', t).id, 's:sovietwave');
});

test('a song listing a genre twice (tag and bare) is counted once', () => {
  const t = buildTree(realVocab());
  applyCounts(t, [live[0]]);
  assert.equal(t.byId.get('s:sovietwave').own.size, 1);
  assert.equal(t.byId.get('g:synthwave').all.size, 1);
});

test('map nodes carry own and subtree counts and emphasis follows the own count', () => {
  const t = buildTree(realVocab());
  applyCounts(t, live);
  const g = buildMapGraph(t);
  assert.ok(g.byId.get('s:sovietwave').own >= 4 && g.byId.get('s:sovietwave').em === 2);
  assert.equal(g.byId.get('g:synthwave').em, 2);
});

test('genre labels are used as the vocabulary gives them: lowercase genres, capitalised families', () => {
  const t = buildTree(realVocab());
  const g = buildMapGraph(t);
  assert.equal(g.byId.get('g:Rock').label, 'Rock');
  assert.equal(g.byId.has('g:Others'), true);
  assert.equal(t.byId.get('g:Others').label, 'Others');
  assert.equal(g.byId.get('g:drum and bass').label, g.byId.get('g:drum and bass').node.display || 'drum and bass');
  const t2 = buildTree({ families: ['Electronic'], genres: [], aliases: {}, family_synonyms: {}, modifiers: {}, levels: { 'soviet wave': { parents: ['Electronic'], display: 'soviet wave' }, 'uk garage': { parents: ['Electronic'] } } });
  assert.equal(buildMapGraph(t2).byId.get('s:soviet wave').label, 'soviet wave');
  assert.equal(buildMapGraph(t2).byId.get('s:uk garage').label, 'uk garage');
});
