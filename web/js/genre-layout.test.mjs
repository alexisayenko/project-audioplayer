import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim } from './genre-sim.js';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph, seedPositions } from './genre-map-graph.js';
import { createTreeLayout } from './genre-tree-layout.js';
import { createCrossingLayout } from './genre-layout.js';
import { countCrossings, countCrossingsXY, segmentsCross } from './genre-crossing.js';
import { realVocab } from './genre-real-vocab.mjs';

const graphOf = (fusion) => { const t = buildTree(realVocab(), { fusion }); applyCounts(t, []); return buildMapGraph(t); };

function forceBaseline(fusion) {
  const g = seedPositions(graphOf(fusion), 1);
  createSim({ nodes: g.nodes, links: g.links, seed: 1, breathing: false, charge: 30, linkDistance: 20, gravity: 0.08 }).settle(300);
  return countCrossings(g.nodes, g.links);
}

test('segment intersection: proper crossings only, shared endpoints and parallels do not count', () => {
  assert.equal(segmentsCross(0, 0, 10, 10, 0, 10, 10, 0), true);
  assert.equal(segmentsCross(0, 0, 10, 0, 0, 5, 10, 5), false);
  assert.equal(segmentsCross(0, 0, 10, 10, 10, 10, 20, 0), false);
  assert.equal(segmentsCross(0, 0, 4, 0, 5, -1, 5, 1), false);
  const xs = Float64Array.from([0, 10, 0, 10, 20]);
  const ys = Float64Array.from([0, 10, 10, 0, 0]);
  assert.equal(countCrossingsXY(xs, ys, [[0, 1], [2, 3], [3, 4]]), 1, 'one X, the third segment only shares an endpoint');
  assert.equal(countCrossingsXY(new Float64Array(0), new Float64Array(0), []), 0);
});

test('the crossing counter ignores related (association) links and agrees with a brute-force count', () => {
  const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 10, y: 10 }, { id: 'c', x: 0, y: 10 }, { id: 'd', x: 10, y: 0 }];
  assert.equal(countCrossings(nodes, [{ source: 'a', target: 'b', kind: 'parent' }, { source: 'c', target: 'd', kind: 'related' }]), 1);
  assert.equal(countCrossings(nodes, [{ source: 'a', target: 'b', kind: 'parent' }, { source: 'c', target: 'd', kind: 'assoc' }]), 0);
  const g = graphOf(false);
  const t = createTreeLayout(g, { seed: 1 });
  const { xs, ys } = t.positions();
  let brute = 0;
  const s = t.segs;
  for (let i = 0; i < s.length; i++) {
    for (let j = i + 1; j < s.length; j++) {
      const [a, b] = s[i]; const [c, d] = s[j];
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsCross(xs[a], ys[a], xs[b], ys[b], xs[c], ys[c], xs[d], ys[d])) brute++;
    }
  }
  assert.equal(countCrossingsXY(xs, ys, s), brute);
});

for (const fusion of [true, false]) {
  test(`fusion ${fusion ? 'on' : 'off'}: the radial tree seed has zero crossings among the primary parent links and annealing improves the full vocabulary`, () => {
    const g = graphOf(fusion);
    const tree = createTreeLayout(g, { seed: 1 });
    assert.equal(tree.treeCrossings(), 0, 'parent links of the sector layout never cross');
    const base = forceBaseline(fusion);
    const layout = createCrossingLayout(g, { seed: 1 });
    const seeded = layout.crossings;
    layout.run();
    const after = layout.crossings;
    layout.apply();
    const recount = countCrossings(g.nodes.map((n) => ({ id: n.id, x: n.hx, y: n.hy })), g.links);
    assert.equal(recount, after, 'the tracked count equals a fresh count');
    console.log(`crossings fusion ${fusion}: force baseline ${base}, sector seed ${seeded}, after annealing ${after} (${Math.round(100 * (1 - after / base))}% fewer)`);
    assert.ok(after <= base * 0.75, `${after} of baseline ${base}`);
    assert.ok(after < seeded);
    for (const n of g.nodes) assert.ok(Number.isFinite(n.hx) && Number.isFinite(n.hy));
  });
}

test('the layout is deterministic for a seed and differs for another', () => {
  const run = (seed) => { const g = graphOf(false); const l = createCrossingLayout(g, { seed, budget: 3000 }); l.run(); return Array.from(l.xs, (x) => x.toFixed(3)).join(',') + '|' + l.crossings; };
  assert.equal(run(1), run(1));
  assert.notEqual(run(1), run(2));
});

test('the layout steps are time-sliced and bounded: a slice respects its budget, the whole run is bounded', () => {
  const g = graphOf(true);
  const t0 = performance.now();
  const layout = createCrossingLayout(g, { seed: 1 });
  const setup = performance.now() - t0;
  assert.ok(setup < 800, `sector seed took ${setup.toFixed(0)} ms`);
  const t1 = performance.now();
  layout.step(4);
  const slice = performance.now() - t1;
  assert.ok(slice < 40, `one 4 ms slice took ${slice.toFixed(1)} ms`);
  assert.equal(layout.done, false);
  const t2 = performance.now();
  layout.run();
  const total = performance.now() - t2;
  assert.equal(layout.done, true);
  assert.ok(total < 15000, `the full run took ${total.toFixed(0)} ms`);
  assert.equal(layout.step(4), false, 'nothing left to do');
});
