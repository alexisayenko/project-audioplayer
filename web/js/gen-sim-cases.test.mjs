import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSim, mulberry32 } from './genre-sim.js';

const cases = JSON.parse(fs.readFileSync(new URL('../../server/tests/fixtures/gen_sim_cases.json', import.meta.url), 'utf8'));

test('mulberry32 matches the shared sequence', () => {
  const rng = mulberry32(cases.rng.seed);
  for (const want of cases.rng.values) assert.equal(rng(), want);
});

test('the simulation settles to the shared positions', () => {
  for (const run of cases.settled) {
    const nodes = cases.nodes.map((n) => ({ ...n }));
    const links = cases.links.map((l) => ({ source: l.source, target: l.target, kind: l.related ? 'related' : 'parent' }));
    const sim = createSim({ nodes, links, seed: cases.seed, breathing: false });
    sim.settle(run.ticks);
    assert.deepEqual(nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })), run.positions, `after ${run.ticks} ticks`);
  }
});
