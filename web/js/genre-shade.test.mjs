import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shadeColor, shadeTable, parseColor, toOklch, SHADE_OFFSETS } from './genre-shade.js';
import { fillDisc } from './genre-disc.js';
import { buildTree, applyCounts, cleanSubfamilies, subfamilyOrder } from './genre-levels.js';
import { buildMapGraph, visibleIds } from './genre-map-graph.js';
import { layoutRadial } from './genre-radial.js';

const BASE = '#1a8aa6';
const SUBS = [
  { name: 'House & techno', family: 'Electronic', order: 1 }, { name: 'Breaks & bass', family: 'Electronic', order: 2 },
  { name: 'Synth & wave', family: 'Electronic', order: 3 },
];
const vocab = (subfamilies = SUBS) => ({
  families: ['Electronic', 'Rock'], genres: [], aliases: {}, family_synonyms: {}, flavours: {}, subfamilies,
  levels: {
    house: { parents: ['Electronic'], subfamily: 'House & techno' },
    jungle: { parents: ['Electronic'], subfamily: 'Breaks & bass' },
    synthwave: { parents: ['Electronic'], subfamily: 'Synth & wave' },
    plain: { parents: ['Electronic'] },
    punk: { parents: ['Rock'] },
    'electro punk': { parents: ['Rock', 'Electronic'], subfamily: 'Synth & wave' },
  },
});

test('parseColor reads hex and rgb text and rejects the rest', () => {
  assert.deepEqual(parseColor('#1a8aa6'), [26, 138, 166]);
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('rgb(26, 138, 166)'), [26, 138, 166]);
  assert.deepEqual(parseColor('rgb(26 138 166 / 0.5)'), [26, 138, 166]);
  for (const bad of ['', 'teal', 'var(--x)', null, undefined, '#12']) assert.equal(parseColor(bad), null);
});

test('shades of a family colour: deterministic, valid, one per order up to ten', () => {
  const t = shadeTable(BASE);
  assert.equal(t.length, 11);
  assert.deepEqual(t, shadeTable(BASE));
  const shades = t.slice(1);
  for (const c of shades) assert.match(c, /^#[0-9a-f]{6}$/);
  assert.equal(new Set(shades).size, 10, 'ten distinct colours');
  const base = parseColor(BASE);
  const first = parseColor(shades[0]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(first[i] - base[i]) <= 2, 'subfamily 1 is the family colour');
  for (const [order, off] of Object.entries(SHADE_OFFSETS)) assert.ok(Number.isFinite(off.dH) && Number.isFinite(off.dL), order);
});

test('shades stay inside sRGB for every family colour of the palette, light and dark', () => {
  const palette = ['#1a8aa6', '#c8372d', '#d0549a', '#7a4fc2', '#a87400', '#d2601a', '#3558c4', '#2f8f3f', '#4fc3e0', '#ff6b5e', '#f27fbd', '#a98aff'];
  for (const base of palette) {
    for (let order = 1; order <= 10; order++) {
      const c = shadeColor(base, order);
      assert.match(c, /^#[0-9a-f]{6}$/, `${base} ${order}`);
    }
  }
});

test('the shade falls back to nothing (the plain family colour is used) when the colour cannot be parsed or the order is unknown', () => {
  assert.equal(shadeColor('not a colour', 2), null);
  assert.equal(shadeColor(BASE, 99), null);
  assert.equal(shadeColor(BASE, 0), null);
  assert.deepEqual(shadeTable(''), new Array(11).fill(null));
  assert.equal(shadeColor(BASE, 11), null);
});

test('fillDisc paints the shade for the shaded family only, wedge by wedge', () => {
  const sets = [];
  const ctx = new Proxy({}, { get: () => () => {}, set: (t, k, v) => { if (k === 'fillStyle') sets.push(v); return true; } });
  fillDisc(ctx, 0, 0, 5, ['#e0', '#a1', '#a2'], [0], '#f', 0, '#shade');
  assert.deepEqual(sets, ['#shade']);
  sets.length = 0;
  fillDisc(ctx, 0, 0, 5, ['#e0', '#a1', '#a2'], [1, 0], '#f', 0, '#shade');
  assert.deepEqual(sets, ['#a1', '#shade'], 'only the Electronic wedge takes the shade');
  sets.length = 0;
  fillDisc(ctx, 0, 0, 5, ['#e0', '#a1'], [0], '#f', 0, null);
  assert.deepEqual(sets, ['#e0'], 'no shade means the family colour');
  sets.length = 0;
  fillDisc(ctx, 0, 0, 5, ['#e0', '#a1'], [1], '#f', 0, '#shade');
  assert.deepEqual(sets, ['#a1']);
});

test('subfamilies are read from the payload: sorted, cleaned, attached to genres, order lookup', () => {
  assert.deepEqual(cleanSubfamilies([{ name: 'b', family: 'Electronic', order: 2 }, { name: 'a', family: 'Electronic', order: 1 }, { name: '', family: 'x' }, null, { name: 'c' }]).map((s) => s.name), ['a', 'b']);
  assert.deepEqual(cleanSubfamilies(undefined), []);
  const t = buildTree(vocab());
  assert.deepEqual(t.subfamilies.map((s) => s.name), ['House & techno', 'Breaks & bass', 'Synth & wave']);
  assert.equal(t.byId.get('s:jungle').subfamily, 'Breaks & bass');
  assert.equal(t.byId.get('s:plain').subfamily, null);
  assert.equal(t.byId.get('g:Electronic').subfamily, null, 'family hubs keep the base colour');
  assert.equal(subfamilyOrder(t, 'Synth & wave'), 3);
  assert.equal(subfamilyOrder(t, 'nope'), 0);
});

test('graph and radial nodes carry the shade order; hubs and plain genres carry none; the shaded family index is exposed', () => {
  const t = buildTree(vocab());
  applyCounts(t, [{ id: '1', tags: ['genre:house', 'genre:jungle', 'genre:electro punk'] }]);
  const g = buildMapGraph(t);
  assert.equal(g.subIdx, 0);
  assert.deepEqual([g.byId.get('s:house').subOrder, g.byId.get('s:jungle').subOrder, g.byId.get('s:plain').subOrder, g.byId.get('g:Rock').subOrder], [1, 2, 0, 0]);
  assert.equal(g.byId.has('g:Electronic'), false, 'the Electronic circle is not drawn');
  assert.equal(g.byId.get('s:electro punk').subOrder, 3, 'a multi-family genre keeps its subfamily for the Electronic wedge');
  const l = layoutRadial(t, 'Electronic', { hidden: false });
  assert.equal(l.subIdx, 0);
  assert.equal(l.byId.get('s:jungle').subOrder, 2);
  assert.equal(l.byId.get('g:Electronic').subOrder, 0);
  assert.equal(buildMapGraph(buildTree(vocab([]))).subIdx, -1);
});

test('the subfamily filter hides the other Electronic genres, keeps hubs and genres of other families, and an empty choice shows all', () => {
  const t = buildTree(vocab());
  assert.equal(visibleIds(t, { subfamilies: new Set() }), null);
  const only = visibleIds(t, { subfamilies: new Set(['Breaks & bass']) });
  assert.ok(only.has('s:jungle') && only.has('g:Electronic') && only.has('g:Rock') && only.has('s:punk'));
  assert.ok(!only.has('s:house') && !only.has('s:synthwave') && !only.has('s:plain'));
  assert.ok(!only.has('s:electro punk'), 'it is an Electronic genre too, in another subfamily');
  const two = visibleIds(t, { subfamilies: new Set(['Breaks & bass', 'Synth & wave']) });
  assert.ok(two.has('s:synthwave') && two.has('s:electro punk') && !two.has('s:house'));
});

test('any number of subfamilies up to ten gets shades that stay pairwise distinguishable (OKLab distance) on light and dark family colours', () => {
  const lab = (hex) => { const o = toOklch(parseColor(hex)); return [o.L, o.C * Math.cos((o.h * Math.PI) / 180), o.C * Math.sin((o.h * Math.PI) / 180)]; };
  for (const base of ['#1a8aa6', '#4fc3e0', '#c8372d', '#7a4fc2', '#2f8f3f']) {
    const table = shadeTable(base).slice(1).map(lab);
    for (const n of [2, 6, 8, 10]) {
      let min = Infinity;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(table[i][0] - table[j][0], table[i][1] - table[j][1], table[i][2] - table[j][2]));
      assert.ok(min >= 0.1, `${base} with ${n} shades: closest pair ${min.toFixed(3)}`);
    }
  }
});
