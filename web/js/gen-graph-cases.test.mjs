import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { indexGraph, descendantIds, filterTags, localCounts, searchNodes, outlineRows, pathKeys, ancestorsOf, nodeRadius, isCategoryNode } from './genre-data.js';

const cases = JSON.parse(fs.readFileSync(new URL('../../server/tests/fixtures/gen_graph_cases.json', import.meta.url), 'utf8'));

const kindOf = (r) => (r.kind === 'family' ? 'family' : r.kind === 'genre' ? 'style' : 'node');

const rowOut = (r) => ({
  key: r.key, id: r.id, depth: r.depth, label: r.label, count: r.count, hasChildren: r.hasChildren, expanded: r.expanded,
  alsoUnder: r.alsoUnder, kind: kindOf(r), size: r.size ?? 0, unit: r.unit ?? 'root',
});

test('nodeRadius matches the shared cases', () => {
  for (const c of cases.radius) assert.equal(nodeRadius(c.count), c.r, String(c.count));
});

for (const [name, data] of Object.entries(cases.graphs)) {
  const want = cases.expected[name];
  const g = indexGraph(data);
  const ids = data.nodes.map((x) => x.id);

  test(`${name} graph: descendants, filter tags and categories match the shared cases`, () => {
    assert.deepEqual(ids.map((id) => ({ id, ids: [...descendantIds(g, id)].sort() })), want.descendants);
    assert.deepEqual(ids.map((id) => ({ id, tags: [...filterTags(g, id)].sort() })), want.filterTags);
    assert.deepEqual(ids.map((id) => ({ id, category: isCategoryNode(g.byId.get(id)) })), want.categories);
  });

  test(`${name} graph: local counts match the shared cases`, () => {
    const got = localCounts(g, cases.songs);
    assert.deepEqual(Object.fromEntries(ids.map((id) => [id, got.get(id)])), want.localCounts);
  });

  test(`${name} graph: search matches the shared cases`, () => {
    assert.deepEqual(want.search.map((c) => ({ ...c, ids: searchNodes(g, c.query, c.limit).map((x) => x.id) })), want.search);
  });

  test(`${name} graph: outline rows match the shared cases`, () => {
    for (const o of want.outline) assert.deepEqual(outlineRows(g, new Set(o.expanded)).map(rowOut), o.rows);
  });

  test(`${name} graph: path keys and ancestors match the shared cases`, () => {
    assert.deepEqual(ids.map((id) => ({ id, keys: pathKeys(g, id) })), want.pathKeys);
    assert.deepEqual(ids.map((id) => ({ id, depth: Object.fromEntries([...ancestorsOf(id, g.edges)].sort()) })), want.ancestors);
  });
}
