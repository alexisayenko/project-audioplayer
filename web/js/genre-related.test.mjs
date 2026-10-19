import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { layoutRadial } from './genre-radial.js';
import { createSim } from './genre-sim.js';

const vocab = (withRelated) => ({
  families: ['Electronic', 'Rock'], genres: [], aliases: {}, family_synonyms: {}, flavours: {},
  levels: {
    synthwave: { parents: ['Electronic'], discogs: true },
    darksynth: { parents: ['synthwave'], discogs: true, ...(withRelated ? { related: ['industrial'] } : {}) },
    chillwave: { parents: ['Electronic'], discogs: true, ...(withRelated ? { related: ['downtempo'] } : {}) },
    downtempo: { parents: ['Electronic'], discogs: true },
    industrial: { parents: ['Rock'], discogs: true, ...(withRelated ? { related: ['Electronic', 'nonexistent'] } : {}) },
  },
});
const SONGS = [{ id: '1', tags: ['genre:darksynth'] }, { id: '2', tags: ['genre:chillwave'] }, { id: '3', tags: ['genre:downtempo'] }];
const tree = (r) => { const t = buildTree(vocab(r)); applyCounts(t, SONGS); return t; };

test('related has no effect on the tree, levels, families, counts or split colours', () => {
  const a = tree(false);
  const b = tree(true);
  for (const [id, n] of a.byId) {
    const m = b.byId.get(id);
    assert.deepEqual([m.level, m.parent, m.family, m.fams, m.all.size, m.own.size, m.children.map((c) => c.id)], [n.level, n.parent, n.family, n.fams, n.all.size, n.own.size, n.children.map((c) => c.id)], id);
  }
  assert.deepEqual(b.byId.get('s:darksynth').related, ['industrial']);
});

test('graph data carries related links as their own kind, deduplicated, resolved to genres and families only', () => {
  const g = buildMapGraph(tree(true));
  const assoc = g.links.filter((l) => l.kind === 'assoc').map((l) => `${l.source}>${l.target}`).sort();
  assert.deepEqual(assoc, ['s:chillwave>s:downtempo', 's:darksynth>s:industrial', 's:industrial>g:Electronic']);
  assert.equal(g.links.filter((l) => l.kind === 'parent').length, 5);
  assert.equal(buildMapGraph(tree(false)).links.some((l) => l.kind === 'assoc'), false);
});

test('related links pull far more weakly than parent links and do not change the degree of the tree', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, r: 5 }, { id: 'b', x: 200, y: 0, r: 5 }, { id: 'c', x: 0, y: 200, r: 5 }];
  const sim = createSim({ nodes, links: [{ source: 'a', target: 'b', kind: 'parent' }, { source: 'a', target: 'c', kind: 'assoc' }], breathing: false });
  const [parent, assoc] = sim.links;
  assert.ok(assoc.strength < parent.strength / 10);
  assert.ok(assoc.dist > parent.dist);
  const alone = createSim({ nodes: [{ id: 'a', x: 0, y: 0, r: 5 }, { id: 'b', x: 200, y: 0, r: 5 }], links: [{ source: 'a', target: 'b', kind: 'parent' }], breathing: false });
  assert.equal(alone.links[0].strength, parent.strength);
});

test('the radial adds dotted edges between shown nodes only when asked', () => {
  const plain = layoutRadial(tree(true), 'Electronic');
  assert.equal(plain.edges.some((e) => e.dotted), false);
  const on = layoutRadial(tree(true), 'Electronic', { related: true });
  const dotted = on.edges.filter((e) => e.dotted);
  assert.ok(dotted.length >= 1);
  for (const e of on.edges) assert.ok(on.byId.has(e.from) && on.byId.has(e.to));
  assert.equal(on.nodes.length, plain.nodes.length);
});
