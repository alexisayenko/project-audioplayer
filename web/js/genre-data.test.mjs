import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexGraph, flatGraph, descendantIds, filterTags, localCounts, searchNodes, outlineRows, pathKeys,
  loadExpanded, saveExpanded, nodeRadius, familyIndex, arrowHead, ARROW_MIN_K, ARROW_MAX_PX, ARROW_MIN_PX, FAMILIES, FAMILY_PALETTE_SIZE, isCategoryNode, familyOrder, FAMILY_ORDER,
} from './genre-data.js';

const node = (id, label, family, parents = [], count = 0, tags = [id]) => ({ id, label, qid: null, family, count, ownCount: 0, parents, tags });
const DATA = {
  ontology: true,
  nodes: [
    node('electronic', 'electronic music', 'Electronic', [], 5, []),
    node('pop', 'pop music', 'Pop', [], 3, []),
    node('synthpop', 'synthpop', 'Electronic', ['electronic', 'pop'], 3, []),
    node('dark-synth', 'dark synth', 'Electronic', ['synthpop'], 2),
    node('chillsynth', 'chillsynth', 'Electronic', ['synthpop'], 1),
    node('loose', 'loose one', 'Other', [], 1),
  ],
  edges: [],
};
const g = indexGraph(DATA);
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

test('indexGraph builds children and roots, dropping unknown parents', () => {
  const x = indexGraph({ nodes: [node('a', 'a', 'Other', ['ghost', 'a'])] });
  assert.deepEqual(x.byId.get('a').parents, []);
  assert.deepEqual(g.roots, ['electronic', 'pop', 'loose']);
  assert.deepEqual(g.children.get('synthpop'), ['dark-synth', 'chillsynth']);
});

test('descendantIds includes self and is cycle safe', () => {
  assert.deepEqual([...descendantIds(g, 'electronic')].sort(), ['chillsynth', 'dark-synth', 'electronic', 'synthpop']);
  const cyc = indexGraph({ nodes: [node('a', 'a', 'Other', ['b']), node('b', 'b', 'Other', ['a'])] });
  assert.deepEqual([...descendantIds(cyc, 'a')].sort(), ['a', 'b']);
});

test('filterTags unions the descendant genre tags', () => {
  assert.deepEqual(filterTags(g, 'synthpop').sort(), ['genre:chillsynth', 'genre:dark-synth']);
  assert.deepEqual(filterTags(g, 'chillsynth'), ['genre:chillsynth']);
});

test('localCounts rolls up distinct songs once', () => {
  const songs = [
    { id: 1, tags: ['genre:dark-synth', 'genre:chillsynth'] },
    { id: 2, tags: ['Genre:Dark-Synth'] },
    { id: 3, tags: ['country:x'] },
  ];
  const c = localCounts(g, songs);
  assert.deepEqual(c.get('dark-synth'), { count: 2, ownCount: 2 });
  assert.deepEqual(c.get('synthpop'), { count: 2, ownCount: 0 });
  assert.equal(c.get('electronic').count, 2);
  assert.equal(c.get('pop').count, 2);
  assert.equal(c.get('loose').count, 0);
});

test('searchNodes ranks exact, prefix, then substring', () => {
  assert.deepEqual(searchNodes(g, 'synth').map((n) => n.id), ['synthpop', 'dark-synth', 'chillsynth']);
  assert.deepEqual(searchNodes(g, 'SYNTHPOP').map((n) => n.id), ['synthpop']);
  assert.deepEqual(searchNodes(g, '  '), []);
  assert.equal(searchNodes(g, 'zzz').length, 0);
});

test('outline lists families, repeats multi-parent genres with an also-under marker', () => {
  assert.deepEqual(outlineRows(g, new Set()).map((r) => r.label), ['Electronic', 'Pop', 'Other']);
  const open = new Set(['f:Electronic', 'f:Electronic>electronic', 'f:Electronic>electronic>synthpop', 'f:Pop', 'f:Pop>pop']);
  const rows = outlineRows(g, open);
  const sp = rows.filter((r) => r.id === 'synthpop');
  assert.equal(sp.length, 2);
  assert.deepEqual(sp[0].alsoUnder, ['pop music']);
  assert.deepEqual(sp[1].alsoUnder, ['electronic music']);
  assert.equal(sp[0].depth, 2);
  assert.ok(rows.some((r) => r.id === 'dark-synth' && r.depth === 3));
  assert.ok(!rows.some((r) => r.id === 'dark-synth' && r.key.startsWith('f:Pop')));
});

test('pathKeys gives the outline key chain to a node', () => {
  assert.deepEqual(pathKeys(g, 'dark-synth'), [
    'f:Electronic', 'f:Electronic>electronic', 'f:Electronic>electronic>synthpop', 'f:Electronic>electronic>synthpop>dark-synth',
  ]);
  const rows = outlineRows(g, new Set(pathKeys(g, 'dark-synth')));
  assert.ok(rows.some((r) => r.id === 'dark-synth'));
});

test('flatGraph keeps only genre tags, one node each', () => {
  const f = flatGraph([{ tag: 'genre:Synthwave', count: 4 }, { tag: 'country:de', count: 2 }, { tag: 'genre:synthwave', count: 1 }, { tag: 'plain', count: 1 }]);
  assert.equal(f.nodes.length, 1);
  assert.deepEqual(f.nodes[0], { id: 'synthwave', label: 'Synthwave', qid: null, family: 'Other', count: 4, ownCount: 4, parents: [], tags: ['synthwave'] });
});

test('expanded state round-trips and survives broken storage', () => {
  const s = mem();
  assert.equal(saveExpanded(s, new Set(['f:Pop'])), true);
  assert.deepEqual([...loadExpanded(s)], ['f:Pop']);
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(loadExpanded(broken).size, 0);
  assert.equal(saveExpanded(broken, new Set()), false);
  assert.equal(loadExpanded({ getItem: () => 'not json' }).size, 0);
});

test('radius grows with sqrt(count) and is capped; unknown family is Other', () => {
  assert.ok(nodeRadius(4) > nodeRadius(1));
  assert.equal(nodeRadius(10000), 30);
  assert.equal(familyIndex('nope'), 15);
  assert.equal(familyIndex('Other'), 15);
});

const cat = (id, label, parents = [], count = 4, ownCount = 0) => ({ id, label, qid: null, family: 'Other', count, ownCount, parents, tags: ownCount ? [id] : [], });
const CATS = indexGraph({
  ontology: true,
  nodes: [
    cat('ethnic', 'ethnic music'),
    cat('diaspora', 'music of the African diaspora', ['ethnic']),
    cat('urban', 'urban contemporary', ['diaspora', 'popular'], 4, 1),
    cat('popular', 'popular music', [], 4),
    cat('hiphop', 'hip-hop', ['urban'], 3, 3),
    cat('world', 'world music', [], 2, 2),
    cat('wm2', 'World Music', [], 1),
  ],
  edges: [],
});

test('category umbrellas without own songs are skipped, children reattach, nothing is lost', () => {
  const open = new Set(['f:Other', 'f:Other>popular', 'f:Other>popular>urban']);
  const rows = outlineRows(CATS, open);
  assert.ok(!rows.some((r) => ['ethnic', 'diaspora', 'wm2'].includes(r.id)));
  const u = rows.find((r) => r.id === 'urban');
  assert.equal(u.depth, 2);
  assert.deepEqual(u.alsoUnder, []);
  assert.ok(rows.some((r) => r.id === 'hiphop' && r.depth === 3));
  assert.equal(CATS.nodes.length, 7);
  assert.ok(CATS.byId.has('diaspora') && CATS.edges.length === 0);
});

test('a category node with own songs stays, and a promoted child becomes a root', () => {
  assert.ok(outlineRows(CATS, new Set(['f:Other'])).some((r) => r.id === 'world'));
  const g = indexGraph({ nodes: [cat('x', 'by genre'), cat('y', 'child', ['x'], 1, 1), cat('z', 'zed', [], 2, 2)], edges: [] });
  assert.deepEqual(outlineRows(g, new Set(['f:Other'])).map((r) => r.id), [null, 'z', 'y']);
});

test('regional music and similar umbrellas are skipped, children reattach; own songs keep them', () => {
  const g = indexGraph({
    nodes: [cat('edm', 'electronic dance music', [], 3, 3), cat('reg', 'regional music', [], 5), cat('eurodance', 'Eurodance', ['reg', 'edm'], 2, 2), cat('dh', 'dancehall', ['reg'], 1, 1)],
    edges: [],
  });
  const rows = outlineRows(g, new Set(['f:Other', 'f:Other>edm']));
  assert.ok(!rows.some((r) => r.id === 'reg'));
  assert.equal(rows.find((r) => r.id === 'eurodance').depth, 2);
  assert.ok(rows.some((r) => r.id === 'dh' && r.depth === 1));
  for (const l of ['National music', 'folk music by country', 'traditional music', 'music genre by country', 'by country']) assert.ok(isCategoryNode({ label: l, ownCount: 0 }), l);
  assert.ok(!isCategoryNode({ label: 'regional music', ownCount: 2 }));
  assert.ok(!isCategoryNode({ label: 'folk music', ownCount: 0 }));
});

test('acoustic, vocal and instrumental music umbrellas are skipped; electronic music is not; also-under lists only the other parents', () => {
  for (const l of ['acoustic music', 'Vocal music', 'instrumental music']) assert.ok(isCategoryNode({ label: l, ownCount: 0 }), l);
  assert.ok(!isCategoryNode({ label: 'electronic music', ownCount: 0 }));
  const g = indexGraph({ nodes: [cat('a', 'alpha', [], 3, 3), cat('b', 'beta', [], 2, 2), cat('c', 'child', ['a', 'b'], 1, 1), cat('d', 'deep', ['c'], 1, 1)], edges: [] });
  const rows = outlineRows(g, new Set(['f:Other', 'f:Other>a', 'f:Other>b', 'f:Other>a>c', 'f:Other>b>c']));
  assert.deepEqual(rows.filter((r) => r.id === 'c').map((r) => r.alsoUnder), [['beta'], ['alpha']]);
});

test('multi-parent also-under notes list effective parents after the skip', () => {
  const g = indexGraph({ nodes: [cat('m', 'music of Asia'), cat('a', 'alpha', [], 2, 2), cat('c', 'child', ['m', 'a'], 1, 1)], edges: [] });
  const rows = outlineRows(g, new Set(['f:Other', 'f:Other>a']));
  assert.deepEqual(rows.filter((r) => r.id === 'c').map((r) => r.alsoUnder), [[]]);
  assert.deepEqual(pathKeys(g, 'm'), []);
  assert.deepEqual(pathKeys(CATS, 'urban'), ['f:Other', 'f:Other>popular', 'f:Other>popular>urban']);
});

test('ancestorsOf: chain, diamond, cycle, root, orphan, cap, related ignored', async () => {
  const { ancestorsOf } = await import('./genre-data.js');
  const e = (source, target, kind = 'parent') => ({ source, target, kind });
  assert.deepEqual([...ancestorsOf('a', [e('a', 'b'), e('b', 'c')])], [['b', 1], ['c', 2]]);
  const diamond = [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd')];
  assert.deepEqual([...ancestorsOf('a', diamond)].sort(), [['b', 1], ['c', 1], ['d', 2]]);
  assert.deepEqual([...ancestorsOf('a', [e('a', 'b'), e('b', 'c'), e('c', 'a')])].sort(), [['b', 1], ['c', 2]]);
  assert.equal(ancestorsOf('b', [e('a', 'b')]).size, 0);
  assert.equal(ancestorsOf('x', []).size, 0);
  assert.equal(ancestorsOf('a', [e('a', 'b', 'related')]).size, 0);
  const long = Array.from({ length: 20 }, (_, i) => e(`n${i}`, `n${i + 1}`));
  assert.equal(ancestorsOf('n0', long).size, 12);
  assert.equal(ancestorsOf('n0', long, 3).size, 3);
});

test('families are ordered as the Discogs genres with Other last, colours keep their own index', () => {
  assert.equal(FAMILY_ORDER.length, 12);
  assert.ok(familyOrder('Blues') < familyOrder('Electronic') && familyOrder('Rock') < familyOrder('Other'));
  assert.equal(familyOrder('nope'), 11);
  assert.equal(familyIndex('Electronic'), 0);
  assert.deepEqual(FAMILIES.slice(0, 11).map(familyIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(familyIndex('Other'), 15);
  assert.equal(FAMILY_PALETTE_SIZE, 16);
});

test('arrowHead: tip on the child circle edge, points parent to child, size clamped in screen px', () => {
  const a = arrowHead(0, 0, 5, 100, 0, 10, 1);
  assert.ok(Math.abs(a.tx - 90) < 1e-9 && Math.abs(a.ty) < 1e-9 && a.angle === 0);
  assert.ok(a.ax < a.tx && a.bx < a.tx && Math.abs(a.ay + a.by) < 1e-9 && a.ay !== a.by);
  assert.equal(a.size * 1, 7);
  const big = arrowHead(0, 0, 5, 0, 1000, 10, 4);
  assert.ok(Math.abs(big.size * 4 - ARROW_MAX_PX) < 1e-9 && Math.abs(big.ty - 990) < 1e-9);
  const small = arrowHead(0, 0, 5, 0, 1000, 10, 0.4);
  assert.ok(Math.abs(small.size * 0.4 - ARROW_MIN_PX) < 1e-9);
  assert.ok(Math.abs(arrowHead(0, 0, 1, -30, 40, 2, 1).angle - Math.atan2(40, -30)) < 1e-9);
});

test('arrowHead: skipped for short edges, coincident circles and low zoom', () => {
  assert.equal(arrowHead(0, 0, 5, 20, 0, 10, 1), null);
  assert.ok(arrowHead(0, 0, 5, 23, 0, 10, 1));
  assert.equal(arrowHead(3, 3, 0, 3, 3, 0, 1), null);
  assert.equal(arrowHead(0, 0, 5, 500, 0, 10, ARROW_MIN_K - 0.01), null);
  assert.ok(arrowHead(0, 0, 5, 500, 0, 10, ARROW_MIN_K));
});
