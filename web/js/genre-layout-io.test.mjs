import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { createCrossingLayout } from './genre-layout.js';
import { exportLayout, parseLayout, loadLayoutFile, LAYOUT_WIDTH } from './genre-layout-io.js';
import { VOCAB } from './genre-levels-fixture.mjs';
import { realVocab } from './genre-real-vocab.mjs';

const NOW = new Date('2026-10-19T12:00:00Z');

test('export normalises: bounding box centred on 0,0, width 1000, one decimal, genres and families apart', () => {
  const nodes = [{ id: 'g:Electronic', x: 100, y: 50 }, { id: 's:house', x: 300, y: 250 }, { id: 's:deep house', x: 500.123, y: 150 }];
  const out = exportLayout(nodes, { now: NOW });
  assert.equal(out.version, 1);
  assert.equal(out.generated_at, '2026-10-19T12:00:00.000Z');
  assert.deepEqual(out.families, { Electronic: [-500, -249.9] });
  assert.deepEqual(out.genres.house, [-0.2, 249.9], 'house is in the middle of the box horizontally, 100 below the centre line before scaling');
  const xs = [...Object.values(out.families), ...Object.values(out.genres)].map((p) => p[0]);
  assert.equal(Math.max(...xs) - Math.min(...xs), LAYOUT_WIDTH);
  assert.equal(Math.max(...xs), 500);
  for (const p of [...Object.values(out.families), ...Object.values(out.genres)]) for (const v of p) assert.equal(Math.round(v * 10) / 10, v);
  assert.deepEqual(exportLayout([], { now: NOW }).genres, {});
});

test('a layout survives export and import: same keys, positions back within rounding', () => {
  const g = buildMapGraph(buildTree(VOCAB));
  const l = createCrossingLayout(g, { seed: 1, budget: 500 });
  l.run();
  l.apply();
  const file = JSON.parse(JSON.stringify(exportLayout(g.nodes.map((n) => ({ id: n.id, x: n.hx, y: n.hy })), { now: NOW })));
  const saved = parseLayout(file);
  assert.equal(saved.size, g.nodes.length);
  for (const n of g.nodes) assert.ok(saved.has(n.id), n.id);
  assert.equal(saved.get('s:house').length, 2);
});

test('invalid layout files are rejected and a missing or broken file gives null', async () => {
  assert.equal(parseLayout(null), null);
  assert.equal(parseLayout({ version: 2, genres: { a: [1, 2] } }), null);
  assert.equal(parseLayout({ version: 1, genres: { a: [1] }, families: {} }), null);
  assert.equal(parseLayout({ version: 1, genres: { a: [1, 'x'], b: [3, 4] } }).size, 1);
  assert.equal(await loadLayoutFile(async () => ({ ok: false })), null);
  assert.equal(await loadLayoutFile(async () => { throw new Error('offline'); }), null);
  assert.equal(await loadLayoutFile(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })), null);
  assert.equal((await loadLayoutFile(async () => ({ ok: true, json: async () => ({ version: 1, genres: { house: [1, 2] } }) }))).size, 1);
});

test('seeding from a saved file keeps every saved position exactly and never moves it; unknown genres land next to their parent', () => {
  const g = buildMapGraph(buildTree(realVocab()));
  const saved = new Map();
  g.nodes.slice(0, Math.floor(g.nodes.length * 0.8)).forEach((n, i) => saved.set(n.id, [(i % 40) * 30 - 600, Math.floor(i / 40) * 40 - 300]));
  const missing = g.nodes.filter((n) => !saved.has(n.id));
  assert.ok(missing.length > 50);
  const l = createCrossingLayout(g, { seed: 1, saved, budget: 4000 });
  l.run();
  l.apply();
  for (const [id, p] of saved) {
    const n = g.byId.get(id);
    assert.deepEqual([n.hx, n.hy], p, `${id} stays where it was saved`);
  }
  const parentOf = new Map(g.links.filter((x) => x.kind === 'parent').map((x) => [x.target, x.source]));
  let near = 0;
  for (const n of missing) {
    assert.ok(Number.isFinite(n.hx) && Number.isFinite(n.hy));
    const p = g.byId.get(parentOf.get(n.id));
    if (p && saved.has(p.id) && Math.hypot(n.hx - p.hx, n.hy - p.hy) < 400) near++;
  }
  assert.ok(near > missing.length * 0.5, `${near} of ${missing.length} unknown genres near a saved parent`);
});

test('a fully saved layout needs no annealing and seeding is deterministic', () => {
  const g = buildMapGraph(buildTree(VOCAB));
  const saved = new Map(g.nodes.map((n, i) => [n.id, [i * 10, -i * 5]]));
  const l = createCrossingLayout(g, { seed: 1, saved });
  assert.equal(l.done, true);
  l.apply();
  assert.deepEqual(g.nodes.map((n) => [n.hx, n.hy]), g.nodes.map((n, i) => [i * 10, -i * 5]));
  const partial = new Map([...saved].slice(0, 5));
  const run = () => { const h = buildMapGraph(buildTree(VOCAB)); const x = createCrossingLayout(h, { seed: 3, saved: partial, budget: 800 }); x.run(); return Array.from(x.xs, (v) => v.toFixed(3)).join(','); };
  assert.equal(run(), run());
});
