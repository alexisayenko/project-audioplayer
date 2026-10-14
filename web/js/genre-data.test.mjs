import test from 'node:test';
import assert from 'node:assert/strict';
import {
  indexGraph, flatGraph, descendantIds, filterTags, localCounts, searchNodes, outlineRows, pathKeys,
  loadExpanded, saveExpanded, nodeRadius, familyIndex,
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
});
