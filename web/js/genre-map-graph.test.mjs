import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realVocab } from './genre-real-vocab.mjs';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph, seedPositions, visibleIds, libraryCount, genreCount, mapRadius, emphasis } from './genre-map-graph.js';
import { createHash } from './genre-spatial.js';
import { VOCAB, SONGS } from './genre-levels-fixture.mjs';


const fixture = () => { const t = buildTree(VOCAB); applyCounts(t, SONGS); return t; };
const linkKey = (l) => `${l.kind}:${l.source}>${l.target}`;

test('every vocabulary node except the hidden Electronic family circle is on the graph, with or without library songs', () => {
  const tree = fixture();
  const g = buildMapGraph(tree);
  assert.equal(g.nodes.length, tree.byId.size - 1);
  assert.deepEqual(new Set(g.nodes.map((n) => n.id)), new Set([...tree.byId.keys()].filter((id) => id !== 'g:Electronic')));
  assert.equal(g.byId.has('g:Electronic'), false);
  const breakbeat = g.byId.get('s:breakbeat');
  assert.deepEqual([breakbeat.own, breakbeat.all, breakbeat.em], [0, 1, 1], 'a genre counts under every parent, so its songs also count at the second parent');
  assert.deepEqual(g.byId.get('s:house').fis, [0]);
  assert.equal(g.byId.get('s:rock and roll').em, 2);
  assert.equal(g.byId.get('g:Rock').em, 1);
});

test('a genre has a line to each parent: one layout parent link, the others as cross-links; no line to the hidden family', () => {
  const g = buildMapGraph(fixture());
  const keys = new Set(g.links.map(linkKey));
  assert.equal(g.links.some((l) => l.source === 'g:Electronic' || l.target === 'g:Electronic'), false);
  assert.ok(keys.has('parent:s:house>s:deep house'));
  assert.ok(keys.has('parent:s:breakbeat>s:jungle'));
  assert.ok(keys.has('related:s:drum and bass>s:jungle'));
  assert.equal(g.links.filter((l) => l.target === 's:jungle').length, 2);
  assert.equal(g.links.filter((l) => l.target === 's:house').length, 0, 'a level 2 genre of the hidden family is a root of its own branch');
  for (const l of g.links) assert.ok(g.byId.has(l.source) && g.byId.has(l.target) && l.source !== l.target);
});

test('a genre in two families has a line to each visible family hub and a pie fill of both families', () => {
  const tree = buildTree({ ...VOCAB, levels: { ...VOCAB.levels, 'full tip': { parents: ['Electronic', 'Rock'], discogs: false }, 'hard tip': { parents: ['Rock', 'house'], discogs: false } } });
  const g = buildMapGraph(tree);
  const keys = new Set(g.links.map(linkKey));
  assert.ok(keys.has('parent:g:Rock>s:full tip'));
  assert.equal(g.links.filter((l) => l.target === 's:full tip').length, 1);
  assert.ok(keys.has('parent:s:house>s:hard tip') || keys.has('parent:g:Rock>s:hard tip'));
  assert.equal(g.links.filter((l) => l.target === 's:hard tip').length, 2);
  assert.deepEqual(g.byId.get('s:full tip').fis, [0, 1]);
  assert.deepEqual(g.byId.get('s:rock and roll').fis, [1]);
});

test('no duplicate links and none to missing nodes with the empty or missing tree', () => {
  const g = buildMapGraph(fixture());
  assert.equal(new Set(g.links.map(linkKey)).size, g.links.length);
  assert.deepEqual(buildMapGraph(null).nodes, []);
});

test('the real vocabulary draws every genre once with a line to each visible parent and a pie fill of all its families', () => {
  const vocab = realVocab();
  const tree = buildTree(vocab);
  applyCounts(tree, []);
  const g = buildMapGraph(tree);
  const genres = Object.keys(vocab.levels);
  assert.ok(genres.length > 500);
  assert.equal(g.nodes.length, genres.length + vocab.families.length - 1);
  assert.equal(genreCount(tree), genres.length);
  assert.equal(new Set(g.nodes.map((n) => n.id)).size, g.nodes.length);
  let lines = 0;
  for (const [k, v] of Object.entries(vocab.levels)) {
    const id = `s:${k}`;
    const shown = [...new Set(v.parents)].filter((p) => p !== 'Electronic').map((p) => (vocab.families.includes(p) ? `g:${p}` : `s:${p}`));
    const into = g.links.filter((l) => l.target === id && l.kind !== 'assoc');
    assert.deepEqual(into.map((l) => l.source).sort(), [...shown].sort(), k);
    assert.equal(into.filter((l) => l.kind === 'parent').length, shown.length ? 1 : 0, k);
    lines += shown.length;
    assert.equal(g.byId.get(id).fis.length, tree.byId.get(id).fams.length, k);
  }
  assert.equal(g.links.filter((l) => l.kind !== 'assoc').length, lines);
  assert.ok(g.byId.get('s:disco').fis.length === 2 && g.byId.get('s:euro disco').fis.length === 2);
  assert.equal(libraryCount(tree), 0);
});

test('size grows with songs, hubs are larger, emphasis has three levels', () => {
  assert.ok(mapRadius(2, 0) < mapRadius(2, 4) && mapRadius(2, 4) < mapRadius(2, 40));
  assert.ok(mapRadius(2, 1000) <= 20 && mapRadius(1, 0) > mapRadius(2, 0));
  assert.deepEqual([emphasis(1, 3), emphasis(0, 3), emphasis(0, 0)], [2, 1, 0]);
});

test('library genres are counted from songs tagged exactly with them', () => {
  const tree = fixture();
  assert.equal(libraryCount(tree), 5);
  assert.equal(genreCount(tree), 7);
});

test('seed positions are deterministic, finite and put the families on a ring', () => {
  const make = () => seedPositions(buildMapGraph(buildTree(realVocab())), 7);
  const a = make();
  const b = make();
  assert.deepEqual(a.nodes.map((n) => [n.x, n.y]), b.nodes.map((n) => [n.x, n.y]));
  for (const n of a.nodes) assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y));
  const radii = a.nodes.filter((n) => n.level === 1).map((n) => Math.hypot(n.x, n.y));
  for (const r of radii) assert.ok(Math.abs(r - 240) < 1e-6);
});

test('visible ids: null without filters, a family keeps its own genres and cross-linked ones, the library keeps songs and ancestors', () => {
  const tree = buildTree({ ...VOCAB, levels: { ...VOCAB.levels, 'full tip': { parents: ['Electronic', 'Rock'], discogs: false } } });
  applyCounts(tree, SONGS);
  assert.equal(visibleIds(tree, {}), null);
  assert.equal(visibleIds(null, { family: 'Rock' }), null);
  const rock = visibleIds(tree, { family: 'Rock' });
  assert.deepEqual([...rock].sort(), ['g:Rock', 's:full tip', 's:rock and roll']);
  const elec = visibleIds(tree, { family: 'Electronic' });
  assert.ok(elec.has('s:jungle') && elec.has('s:breakbeat') && !elec.has('s:rock and roll'));
  const lib = visibleIds(tree, { libraryOnly: true });
  assert.ok(lib.has('s:house') && lib.has('g:Electronic') && lib.has('s:jungle'));
  assert.ok(!lib.has('s:breakbeat') || tree.byId.get('s:breakbeat').all.size > 0);
  assert.ok(!lib.has('s:full tip'));
  const both = visibleIds(tree, { family: 'Rock', libraryOnly: true });
  assert.deepEqual([...both].sort(), ['g:Rock', 's:rock and roll']);
  const q = visibleIds(tree, { status: 'question' });
  assert.ok(q.has('s:deep house') && q.has('g:Electronic') && !q.has('s:jungle'));
});

test('spatial hash: finds the node under a point, the top one among overlaps, honours slack and visibility', () => {
  const nodes = [
    { id: 'a', x: 0, y: 0, r: 10 }, { id: 'b', x: 5, y: 0, r: 10 }, { id: 'c', x: 500, y: -300, r: 4 },
    { id: 'd', x: -1000, y: 2000, r: 6 }, { id: 'e', x: 20, y: 0, r: 3 },
  ];
  const h = createHash(48);
  h.rebuild(nodes);
  assert.equal(h.hit(0, 0).id, 'b');
  assert.equal(h.hit(-8, 0).id, 'a');
  assert.equal(h.hit(500, -300).id, 'c');
  assert.equal(h.hit(-1000, 2000).id, 'd');
  assert.equal(h.hit(100, 100), null);
  assert.equal(h.hit(508, -300), null);
  assert.equal(h.hit(508, -300, 5).id, 'c');
  assert.equal(h.hit(20, 0).id, 'e');
  h.rebuild(nodes, (n) => n.id !== 'b' && n.id !== 'e');
  assert.equal(h.hit(0, 0).id, 'a');
  assert.equal(h.size(), 3);
  h.rebuild([]);
  assert.equal(h.hit(0, 0), null);
});

test('spatial hash agrees with a brute-force scan on 530 random nodes', () => {
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const nodes = Array.from({ length: 530 }, () => ({ x: (rnd() - 0.5) * 2000, y: (rnd() - 0.5) * 2000, r: 3 + rnd() * 14 }));
  const h = createHash(48);
  h.rebuild(nodes);
  for (let i = 0; i < 400; i++) {
    const x = (rnd() - 0.5) * 2000;
    const y = (rnd() - 0.5) * 2000;
    let best = null;
    nodes.forEach((n, idx) => { if ((n.x - x) ** 2 + (n.y - y) ** 2 <= (n.r + 2) ** 2) best = idx; });
    assert.equal(h.hit(x, y, 2), best === null ? null : nodes[best]);
  }
});
