import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realVocab } from './genre-real-vocab.mjs';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph, seedPositions, visibleIds, libraryCount, genreCount, mapRadius, emphasis } from './genre-map-graph.js';
import { createHash } from './genre-spatial.js';
import { VOCAB, SONGS } from './genre-levels-fixture.mjs';


const fixture = () => { const t = buildTree(VOCAB); applyCounts(t, SONGS); return t; };
const linkKey = (l) => `${l.kind}:${l.source}>${l.target}`;

test('every vocabulary node is on the graph, with or without library songs', () => {
  const tree = fixture();
  const g = buildMapGraph(tree);
  assert.equal(g.nodes.length, tree.byId.size);
  assert.deepEqual(new Set(g.nodes.map((n) => n.id)), new Set(tree.byId.keys()));
  const breakbeat = g.byId.get('s:breakbeat');
  assert.deepEqual([breakbeat.own, breakbeat.all, breakbeat.em], [0, 0, 0], 'a cross-link adds no songs (GEN-053)');
  assert.equal(g.byId.get('s:rock and roll').em, 2);
  assert.equal(g.byId.get('g:Rock').em, 1);
});

test('parent links follow the primary parent and extra parents become cross-links', () => {
  const g = buildMapGraph(fixture());
  const keys = new Set(g.links.map(linkKey));
  assert.ok(keys.has('parent:g:Electronic>s:house'));
  assert.ok(keys.has('parent:s:house>s:deep house'));
  assert.ok(keys.has('parent:s:drum and bass>s:jungle'));
  assert.ok(keys.has('related:s:breakbeat>s:jungle'));
  assert.equal(g.links.filter((l) => l.target === 's:jungle').length, 2);
  for (const l of g.links) assert.ok(g.byId.has(l.source) && g.byId.has(l.target) && l.source !== l.target);
});

test('a family cross-link (parents[1] is a family) is a related link from that family hub', () => {
  const tree = buildTree({ ...VOCAB, levels: { ...VOCAB.levels, 'full tip': { parents: ['Electronic', 'Rock'], discogs: false } } });
  const keys = new Set(buildMapGraph(tree).links.map(linkKey));
  assert.ok(keys.has('parent:g:Electronic>s:full tip'));
  assert.ok(keys.has('related:g:Rock>s:full tip'));
});

test('no duplicate links and none to missing nodes with the empty or missing tree', () => {
  const g = buildMapGraph(fixture());
  assert.equal(new Set(g.links.map(linkKey)).size, g.links.length);
  assert.deepEqual(buildMapGraph(null).nodes, []);
});

test('the real vocabulary draws every genre once with parents[0] as the parent link and parents[1..] as cross-links', () => {
  const vocab = realVocab();
  const tree = buildTree(vocab);
  applyCounts(tree, []);
  const g = buildMapGraph(tree);
  const genres = Object.keys(vocab.levels);
  assert.ok(genres.length > 500);
  assert.equal(g.nodes.length, genres.length + vocab.families.length);
  assert.equal(genreCount(tree), genres.length);
  assert.equal(new Set(g.nodes.map((n) => n.id)).size, g.nodes.length);
  const parents = new Map(g.links.filter((l) => l.kind === 'parent').map((l) => [l.target, l.source]));
  const cross = g.links.filter((l) => l.kind === 'related');
  let extra = 0;
  for (const [k, v] of Object.entries(vocab.levels)) {
    const id = `s:${k}`;
    const first = v.parents[0];
    assert.equal(parents.get(id), vocab.families.includes(first) ? `g:${first}` : `s:${first}`, k);
    extra += v.parents.length - 1;
  }
  assert.equal(cross.length, extra);
  assert.ok(extra > 0);
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
