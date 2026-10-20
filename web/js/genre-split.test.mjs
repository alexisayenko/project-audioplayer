import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { layoutRadial, hueSet } from './genre-radial.js';
import { fillDisc, uniqueIndices, segmentsFor } from './genre-disc.js';
import { familyIndex, pieIndices, setLevelOneNames } from './genre-data.js';
import { realVocab } from './genre-real-vocab.mjs';

const VOCAB = {
  families: ['Electronic', 'Funk / Soul', 'Rock', 'Blues'], genres: [], aliases: {}, family_synonyms: {}, modifiers: {},
  levels: {
    disco: { parents: ['Funk / Soul', 'Electronic'], discogs: true },
    'disco dub': { parents: ['disco'], discogs: true },
    house: { parents: ['Electronic'], discogs: true },
    tri: { parents: ['Electronic', 'Rock', 'disco'], discogs: false },
    quad: { parents: ['Electronic', 'Rock', 'Funk / Soul', 'Blues'], discogs: true },
    'space disco': { parents: ['disco'], discogs: false },
  },
};
const tree = () => { const t = buildTree(VOCAB); applyCounts(t, [{ id: 'a', tags: ['genre:disco', 'genre:tri'] }]); return t; };
const fams = (t, id) => t.byId.get(id).fams;

test('a family set is every family the genre descends from, in the vocabulary family order, without a cap', () => {
  const t = tree();
  assert.deepEqual(fams(t, 'g:Rock'), ['Rock']);
  assert.deepEqual(fams(t, 's:house'), ['Electronic']);
  assert.deepEqual(fams(t, 's:disco'), ['Electronic', 'Funk / Soul']);
  assert.deepEqual(fams(t, 's:disco dub'), ['Electronic', 'Funk / Soul']);
  assert.deepEqual(fams(t, 's:tri'), ['Electronic', 'Funk / Soul', 'Rock']);
  assert.deepEqual(fams(t, 's:quad'), ['Electronic', 'Funk / Soul', 'Rock', 'Blues'], 'four families, no cap');
  assert.deepEqual(fams(t, 's:space disco'), ['Electronic', 'Funk / Soul'], 'no override: it descends from disco');
  assert.equal(t.byId.get('s:disco').family, 'Electronic');
});

test('parent order does not matter: the same parents in another order give the same families, level and children', () => {
  const swap = (levels) => Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { ...v, parents: [...v.parents].reverse() }]));
  const a = buildTree(VOCAB);
  const b = buildTree({ ...VOCAB, levels: swap(VOCAB.levels) });
  for (const [id, n] of a.byId) {
    const m = b.byId.get(id);
    assert.deepEqual([m.level, m.fams, m.children.map((c) => c.id), [...m.parents].sort()], [n.level, n.fams, n.children.map((c) => c.id), [...n.parents].sort()], id);
  }
});

test('graph nodes carry the distinct palette indices of their families in the fixed family order, single families stay flat', () => {
  const g = buildMapGraph(tree());
  assert.deepEqual(g.byId.get('s:disco').fis, [familyIndex('Electronic'), familyIndex('Funk / Soul')]);
  assert.equal(g.byId.get('s:disco').fi, familyIndex('Electronic'));
  assert.deepEqual(g.byId.get('s:house').fis, [0]);
  assert.deepEqual(g.byId.get('s:tri').fis, [0, 5, 1]);
  assert.deepEqual(g.byId.get('s:quad').fis, [0, 5, 1, 9], 'segments follow the vocabulary family order: Electronic, Funk / Soul, Rock, Blues');
  assert.deepEqual(g.byId.get('g:Rock').fis, [familyIndex('Rock')]);
  assert.deepEqual(uniqueIndices(['Other', 'Foo', 'Rock'], familyIndex), [15, 1]);
  setLevelOneNames(['Blues', 'Classical', 'Electronic', 'Funk / Soul', 'Hip Hop', 'Jazz', 'Pop', 'Reggae', 'Rock']);
  assert.deepEqual(pieIndices(['Rock', 'Blues', 'Electronic', 'Rock']), [9, 0, 1]);
  assert.deepEqual(pieIndices(['Foo', 'Rock']), [1, 15]);
  assert.deepEqual(pieIndices(undefined), []);
});

test('on the real vocabulary only multi-family genres are split and every set is a set of family colours', () => {
  const g = buildMapGraph(buildTree(realVocab()));
  const split = g.nodes.filter((n) => n.fis.length > 1);
  assert.ok(split.length > 0 && split.length < g.nodes.length / 2);
  assert.ok(g.nodes.every((n) => n.fis.length >= 1));
  assert.ok(split.some((n) => n.id === 's:hip house' && n.fis[0] === familyIndex('house') && n.fis[1] === familyIndex('Hip Hop')));
  assert.ok(!split.some((n) => n.id === 's:disco'), 'disco left Others (2026-10-20): Funk / Soul only');
  assert.ok(split.some((n) => n.id === 's:eurodance' && n.fis.length === 3));
});

test('radial hues keep the umbrella hue for single families and split a multi-family genre into its family colours', () => {
  const t = tree();
  const layout = layoutRadial(t, 'Electronic', { hidden: false });
  const disco = layout.byId.get('s:disco');
  assert.deepEqual(disco.hues, [familyIndex('Electronic'), familyIndex('Funk / Soul')], 'a split genre uses family colours only, never an umbrella hue');
  assert.deepEqual(layout.byId.get('g:Electronic').hues, [0]);
  assert.deepEqual(hueSet(3, { fams: ['Rock', 'Electronic'] }), [0, 1]);
  assert.deepEqual(hueSet(3, { fams: ['Electronic'] }), [3], 'a single family keeps the umbrella hue');
  assert.deepEqual(hueSet(3, {}), [3]);
  assert.equal(hueSet(3, { fams: ['Blues', 'Classical', 'Electronic', 'Reggae', 'Rock'] }).length, 5);
});

test('segmentsFor gives one full circle for a single colour and equal contiguous segments, starting at the top, for several', () => {
  assert.deepEqual(segmentsFor([4]), [{ idx: 4, a0: 0, a1: 2 * Math.PI }]);
  assert.equal(segmentsFor([]).length, 1);
  const three = segmentsFor([9, 0, 5]);
  assert.equal(three.length, 3);
  assert.deepEqual(three.map((x) => x.idx), [9, 0, 5]);
  assert.equal(three[0].a0, -Math.PI / 2);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(three[i].a1 - three[i].a0 - (2 * Math.PI) / 3) < 1e-12);
  for (let i = 1; i < 3; i++) assert.equal(three[i].a0, three[i - 1].a1);
  assert.ok(Math.abs(three[2].a1 - (-Math.PI / 2 + 2 * Math.PI)) < 1e-12);
  const eleven = segmentsFor([...Array(11).keys()]);
  assert.ok(Math.abs(eleven.reduce((s, x) => s + x.a1 - x.a0, 0) - 2 * Math.PI) < 1e-9);
  assert.equal(segmentsFor([0, 1], 0)[0].a0, 0);
});

test('fillDisc paints a flat disc once and a split disc as fixed wedges, then leaves the full circle path for the outline', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (t, k) => (...a) => calls.push([k, ...a]), set: (t, k, v) => { calls.push(['set', k, v]); return true; } });
  fillDisc(ctx, 0, 0, 5, ['#a', '#b', '#c'], [1], '#f');
  assert.equal(calls.filter((c) => c[0] === 'fill').length, 1);
  assert.deepEqual(calls.find((c) => c[0] === 'set'), ['set', 'fillStyle', '#b']);
  calls.length = 0;
  fillDisc(ctx, 0, 0, 5, ['#a', '#b', '#c'], [0, 2], '#f');
  const arcs = calls.filter((c) => c[0] === 'arc');
  assert.equal(calls.filter((c) => c[0] === 'fill').length, 2);
  assert.deepEqual(calls.filter((c) => c[0] === 'set').map((c) => c[2]), ['#a', '#c']);
  assert.equal(arcs[0][4], -Math.PI / 2);
  assert.ok(Math.abs(arcs[0][5] - Math.PI / 2) < 1e-9, 'half circle, vertical split line');
  assert.deepEqual(arcs.at(-1).slice(4), [0, 2 * Math.PI]);
  calls.length = 0;
  fillDisc(ctx, 0, 0, 5, [], [9], '#f');
  assert.deepEqual(calls.find((c) => c[0] === 'set'), ['set', 'fillStyle', '#f']);
});

test('regression: every genre of the vocabulary is coloured by exactly the families it descends from, in the fixed family order, from the family palette', () => {
  const vocab = realVocab();
  const tree = buildTree(vocab);
  const g = buildMapGraph(tree);
  const palette = new Set(vocab.families.map((f) => familyIndex(f)));
  const famOf = (k, seen = new Set()) => {
    if (vocab.families.includes(k)) return [k];
    if (seen.has(k) || !vocab.levels[k]) return [];
    seen.add(k);
    return vocab.levels[k].parents.flatMap((p) => famOf(p, new Set(seen)));
  };
  let multi = 0;
  for (const k of Object.keys(vocab.levels)) {
    const want = pieIndices(famOf(k));
    const node = g.byId.get(`s:${k}`);
    assert.deepEqual(node.fis, want, k);
    for (const i of node.fis) assert.ok(palette.has(i), `${k}: colour ${i} is not a family colour`);
    if (want.length > 1) multi++;
  }
  assert.ok(multi > 20);
  assert.deepEqual(g.byId.get('s:disco').fis, [5]);
  assert.deepEqual(g.byId.get('s:euro disco').fis, [5]);
  const t2 = buildTree(vocab);
  applyCounts(t2, [{ id: 'x', tags: ['genre:disco'] }]);
  const layout = layoutRadial(t2, 'Funk / Soul', { hidden: false });
  assert.equal(layout.byId.get('s:disco').hues.length, 1, 'one family (Funk / Soul) since disco left Others: no grey slice');
  assert.ok(!layout.byId.get('s:disco').hues.includes(15));
});
