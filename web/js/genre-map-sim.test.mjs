import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from './genre-sim.js';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph, seedPositions } from './genre-map-graph.js';
import { realVocab } from './genre-real-vocab.mjs';

const OPTS = { charge: 30, linkDistance: 20, gravity: 0.08 };

function build(seed = 1) {
  const tree = buildTree(realVocab());
  applyCounts(tree, []);
  const g = seedPositions(buildMapGraph(tree), seed);
  const sim = createSim({ nodes: g.nodes, links: g.links, seed, breathing: false, ...OPTS });
  return { g, sim };
}

const finite = (nodes) => nodes.every((n) => [n.x, n.y, n.vx, n.vy].every(Number.isFinite));

test('the 530-node map simulates without NaN and stays within bounds', () => {
  const { g, sim } = build();
  assert.ok(g.nodes.length > 500 && g.links.length > 500);
  for (let i = 0; i < 300; i++) sim.tick();
  assert.ok(finite(g.nodes));
  const far = Math.max(...g.nodes.map((n) => Math.hypot(n.x, n.y)));
  assert.ok(far < 2500, `farthest node ${far}`);
});

test('kinetic energy decreases as the layout cools', () => {
  const { sim } = build();
  const e = [];
  for (let i = 0; i < 300; i++) { sim.tick(); if (i % 50 === 49) e.push(sim.energy()); }
  assert.ok(e[e.length - 1] < e[0] / 5, e.join(', '));
  assert.ok(e[e.length - 1] < e[2]);
});

test('the simulation sleeps when cooled and wakes on a reheat', () => {
  const { sim } = build();
  sim.settle(1000);
  assert.equal(sim.tick(), false);
  assert.ok(sim.alpha < 0.01);
  sim.reheat(0.5);
  assert.equal(sim.tick(), true);
  assert.ok(sim.energy() >= 0);
});

test('a pinned node stays exactly where it is held while the neighbourhood follows, and is released afterwards', () => {
  const { g, sim } = build();
  sim.settle(400);
  const hub = g.byId.get('g:Rock');
  const kid = g.links.find((l) => l.kind === 'parent' && l.source === hub.id);
  const child = g.byId.get(kid.target);
  const gap0 = Math.hypot(hub.x - child.x, hub.y - child.y);
  const target = { x: hub.x + 300, y: hub.y - 200 };
  hub.fx = target.x; hub.fy = target.y;
  sim.setAlphaTarget(0.3);
  for (let i = 0; i < 120; i++) { sim.tick(); assert.equal(hub.x, target.x); assert.equal(hub.y, target.y); }
  const startDist = Math.hypot(child.x - target.x, child.y - target.y);
  assert.ok(Math.hypot(hub.x - child.x, hub.y - child.y) < gap0 + 300);
  assert.ok(startDist < gap0 + 300 && startDist < 150, `the child followed the hub: ${startDist.toFixed(0)}`);
  hub.fx = null; hub.fy = null;
  sim.setAlphaTarget(0);
  sim.reheat(0.35);
  for (let i = 0; i < 300; i++) sim.tick();
  assert.ok(finite(g.nodes));
  assert.ok(Math.hypot(hub.x - target.x, hub.y - target.y) > 0, 'released nodes move again');
});

test('the same seed gives the same layout', () => {
  const run = () => { const { g, sim } = build(3); for (let i = 0; i < 80; i++) sim.tick(); return g.nodes.map((n) => `${n.x.toFixed(5)},${n.y.toFixed(5)}`).join('|'); };
  assert.equal(run(), run());
});

test('a subset of the nodes (a filtered map) simulates on its own', () => {
  const { g } = build();
  const keep = new Set(g.nodes.filter((n) => n.family === 'Electronic').map((n) => n.id));
  const nodes = g.nodes.filter((n) => keep.has(n.id));
  const links = g.links.filter((l) => keep.has(l.source) && keep.has(l.target));
  const sim = createSim({ nodes, links, seed: 1, breathing: false, ...OPTS });
  sim.alpha = 0.7;
  for (let i = 0; i < 200; i++) sim.tick();
  assert.ok(finite(nodes));
  assert.ok(nodes.length > 50 && nodes.length < g.nodes.length);
});

test('530 nodes tick fast enough for 60 frames per second in Node', () => {
  const { sim } = build();
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) sim.tick();
  const per = (performance.now() - t0) / 100;
  assert.ok(per < 12, `${per.toFixed(2)} ms per tick`);
});
