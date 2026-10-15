import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthTiers, buildMesh, crossAlphaFor } from './viz-synth-mesh.js';
import { GRID_DEPTH, GRID_MAX_VERTICES, NOW_Z, makeTierPlan, resampleTier, crossAlpha } from './viz-terrain-math.js';

const total = (t) => t.reduce((s, x) => s + x.rows * x.cols, 0);

test('tiers cover the grid depth with growing spacing and respect the vertex budget', () => {
  for (const aspect of [0.6, 1.78, 3.2]) {
    for (const cell of [0.2, 0.6, 1.2]) {
      const t = synthTiers({ cell }, 2, aspect, NOW_Z);
      assert.ok(total(t) <= GRID_MAX_VERTICES, `${aspect}/${cell}: ${total(t)}`);
      assert.equal(t[0].z0, 0);
      assert.equal(t[t.length - 1].z1, GRID_DEPTH);
      for (let k = 1; k < t.length; k += 1) {
        assert.equal(t[k].z0, t[k - 1].z1);
        assert.ok(t[k].spacing > t[k - 1].spacing);
        assert.equal(t[k].cols % 2, 1);
      }
    }
  }
});

test('near spacing follows the cell size', () => {
  assert.ok(synthTiers({ cell: 0.3 }, 2, 1.78, NOW_Z)[0].spacing <= synthTiers({ cell: 0.9 }, 2, 1.78, NOW_Z)[0].spacing);
  assert.equal(synthTiers({ cell: 0.6 }, 2, 1.78, NOW_Z)[0].spacing, 0.6);
});

test('tiers feed makeTierPlan and resampleTier', () => {
  const lat = { rows: 41, cols: 65, dz: GRID_DEPTH / 40, hw: 40, data: new Float32Array(41 * 65).fill(2) };
  for (const tier of synthTiers({ cell: 0.6 }, 2, 1.78, NOW_Z)) {
    const plan = makeTierPlan(lat, tier, NOW_Z);
    const dst = new Float32Array(tier.rows * tier.cols);
    resampleTier(plan, lat.data, dst, 0.3, 0.2, 0, 4.5);
    assert.ok(dst.every((v) => Math.abs(v - 2) < 1e-4));
  }
});

function check(mesh, tier) {
  const n = tier.rows * tier.cols;
  assert.equal(mesh.xz.length, n * 2);
  for (const arr of [mesh.lines, mesh.tris]) for (const i of arr) assert.ok(i < n);
  assert.equal(mesh.lines.length, mesh.lineCount * 2);
  assert.equal(mesh.tris.length, mesh.triCount * 3);
}

test('square mesh has depth and cross edges and two triangles per cell', () => {
  const tier = synthTiers({ cell: 1.2 }, 2, 1.78, NOW_Z)[0];
  const m = buildMesh(tier, 'square');
  check(m, tier);
  const { rows, cols } = tier;
  assert.equal(m.lineCount, cols * (rows - 1) + rows * (cols - 1));
  assert.equal(m.triCount, 2 * (rows - 1) * (cols - 1));
  assert.ok(m.lines instanceof Uint16Array);
});

test('triangle mesh adds one alternating diagonal per cell', () => {
  const tier = synthTiers({ cell: 1.2 }, 2, 1.78, NOW_Z)[0];
  const sq = buildMesh(tier, 'square');
  const tr = buildMesh(tier, 'triangle');
  check(tr, tier);
  assert.equal(tr.lineCount, sq.lineCount + (tier.rows - 1) * (tier.cols - 1));
  assert.equal(tr.triCount, sq.triCount);
  const { cols } = tier;
  const diag = [];
  for (let k = 0; k < tr.lines.length; k += 2) {
    const d = Math.abs(tr.lines[k + 1] - tr.lines[k]);
    if (d === cols + 1 || d === cols - 1) diag.push(d);
  }
  assert.equal(diag.length, (tier.rows - 1) * (tier.cols - 1));
  assert.ok(diag.includes(cols + 1) && diag.includes(cols - 1));
});

test('vertices are centred in x and start at the tier row offset in z', () => {
  const tier = synthTiers({ cell: 0.6 }, 2, 1.78, NOW_Z)[0];
  const m = buildMesh(tier, 'square');
  assert.ok(Math.abs(m.xz[0] + tier.hw) < 1e-4);
  assert.ok(Math.abs(m.xz[(tier.cols - 1) * 2] - tier.hw) < 1e-4);
  assert.ok(Math.abs(m.xz[1] - tier.jz0 * tier.dz) < 1e-6);
  assert.equal(m.xz[((tier.cols - 1) / 2) * 2], 0);
});

test('crossAlphaFor is the Terrain cross alpha', () => {
  assert.equal(crossAlphaFor, crossAlpha);
});
