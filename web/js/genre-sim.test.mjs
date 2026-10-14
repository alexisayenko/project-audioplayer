import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, mulberry32 } from './genre-sim.js';

function make(n, seed, opts = {}) {
  const rng = mulberry32(99);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${String(i).padStart(3, '0')}`, r: 4 + rng() * 10 }));
  const links = [];
  for (let i = 1; i < n; i++) {
    links.push({ source: nodes[i].id, target: nodes[Math.floor(rng() * i)].id, kind: 'parent' });
    if (rng() < 0.2) links.push({ source: nodes[i].id, target: nodes[Math.floor(rng() * i)].id, kind: 'related' });
  }
  return createSim({ nodes, links, seed, ...opts });
}

const snap = (sim) => sim.nodes.map((n) => [n.x, n.y].map((v) => v.toFixed(6)).join(',')).join('|');

test('same seed gives the same layout, a different seed another', () => {
  const run = (seed) => { const s = make(60, seed); for (let i = 0; i < 150; i++) s.tick(); return snap(s); };
  assert.equal(run(7), run(7));
  assert.notEqual(run(7), run(8));
});

test('no NaN or runaway values with 400 nodes', () => {
  const s = make(400, 3);
  for (let i = 0; i < 300; i++) s.tick();
  for (const n of s.nodes) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.vx) && Number.isFinite(n.vy));
    assert.ok(Math.abs(n.x) < 5000 && Math.abs(n.y) < 5000);
  }
  assert.ok(Number.isFinite(s.energy()) && s.energy() < 1e5);
});

test('energy decays to a rest and the layout stays centred', () => {
  const s = make(120, 5, { breathing: false });
  for (let i = 0; i < 30; i++) s.tick();
  const early = s.energy();
  s.settle(600);
  assert.ok(s.energy() < early / 10);
  assert.equal(s.tick(), false);
  const cx = s.nodes.reduce((a, n) => a + n.x, 0) / s.nodes.length;
  const cy = s.nodes.reduce((a, n) => a + n.y, 0) / s.nodes.length;
  assert.ok(Math.hypot(cx, cy) < 60);
});

test('breathing keeps a small bounded motion alive', () => {
  const s = make(80, 2);
  s.settle(300);
  const before = snap(s);
  for (let i = 0; i < 200; i++) assert.equal(s.tick(), true);
  assert.notEqual(snap(s), before);
  assert.ok(s.energy() < 5);
  for (const n of s.nodes) assert.ok(Math.abs(n.x) < 2000);
});

test('linked nodes end up closer than the layout average; nodes do not overlap', () => {
  const s = make(50, 4, { breathing: false });
  s.settle(600);
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const linked = s.links.reduce((a, l) => a + d(l.s, l.t), 0) / s.links.length;
  let all = 0; let pairs = 0;
  for (let i = 0; i < s.nodes.length; i++) for (let j = i + 1; j < s.nodes.length; j++) { all += d(s.nodes[i], s.nodes[j]); pairs++; }
  assert.ok(linked < all / pairs);
  let worst = Infinity;
  for (let i = 0; i < s.nodes.length; i++) for (let j = i + 1; j < s.nodes.length; j++) worst = Math.min(worst, d(s.nodes[i], s.nodes[j]) - s.nodes[i].r - s.nodes[j].r);
  assert.ok(worst > -3);
});

test('a pinned node stays put and drags its neighbours', () => {
  const s = make(30, 6, { breathing: false });
  s.settle(300);
  const a = s.nodes[0];
  const leaf = s.links[0].s === a ? s.links[0].t : s.links[0].s;
  const gap0 = Math.hypot(a.x - leaf.x, a.y - leaf.y);
  a.fx = a.x + 400; a.fy = a.y;
  s.setAlphaTarget(0.3);
  for (let i = 0; i < 200; i++) s.tick();
  assert.equal(a.x, a.fx);
  assert.ok(Math.hypot(a.x - leaf.x, a.y - leaf.y) < gap0 + 250);
  a.fx = null; a.fy = null;
  s.setAlphaTarget(0);
  s.settle(500);
  assert.ok(Number.isFinite(a.x));
});

test('coincident nodes separate without NaN', () => {
  const nodes = [{ id: 'a', x: 0, y: 0, r: 5 }, { id: 'b', x: 0, y: 0, r: 5 }, { id: 'c', x: 0, y: 0, r: 5 }];
  const s = createSim({ nodes, links: [], seed: 1 });
  for (let i = 0; i < 100; i++) s.tick();
  assert.ok(nodes.every((n) => Number.isFinite(n.x)));
  assert.ok(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y) > 1);
});

test('empty graph ticks safely', () => {
  const s = createSim({ nodes: [], links: [] });
  assert.doesNotThrow(() => { for (let i = 0; i < 5; i++) s.tick(); });
});
