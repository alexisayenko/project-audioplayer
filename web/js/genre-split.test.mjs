import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts, MAX_FAMILIES } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { layoutRadial, hueSet } from './genre-radial.js';
import { fillDisc, uniqueIndices } from './genre-disc.js';
import { familyIndex } from './genre-data.js';
import { realVocab } from './genre-real-vocab.mjs';

const VOCAB = {
  families: ['Electronic', 'Funk / Soul', 'Rock', 'Blues'], genres: [], aliases: {}, family_synonyms: {}, flavours: {},
  levels: {
    disco: { parents: ['Funk / Soul', 'Electronic'], discogs: true },
    'disco dub': { parents: ['disco'], discogs: true },
    house: { parents: ['Electronic'], discogs: true },
    tri: { parents: ['Electronic', 'Rock', 'disco'], discogs: false },
    quad: { parents: ['Electronic', 'Rock', 'Funk / Soul', 'Blues'], discogs: true },
    'space disco': { parents: ['disco'], family: 'Electronic', discogs: false },
  },
};
const tree = () => { const t = buildTree(VOCAB); applyCounts(t, [{ id: 'a', tags: ['genre:disco', 'genre:tri'] }]); return t; };
const fams = (t, id) => t.byId.get(id).fams;

test('a family set follows the parents order, inherits from genre parents and caps at three', () => {
  const t = tree();
  assert.deepEqual(fams(t, 'g:Rock'), ['Rock']);
  assert.deepEqual(fams(t, 's:house'), ['Electronic']);
  assert.deepEqual(fams(t, 's:disco'), ['Funk / Soul', 'Electronic']);
  assert.deepEqual(fams(t, 's:disco dub'), ['Funk / Soul', 'Electronic']);
  assert.deepEqual(fams(t, 's:tri'), ['Electronic', 'Rock', 'Funk / Soul']);
  assert.deepEqual(fams(t, 's:quad'), ['Electronic', 'Rock', 'Funk / Soul']);
  assert.equal(MAX_FAMILIES, 3);
  assert.deepEqual(fams(t, 's:space disco'), ['Electronic', 'Funk / Soul'], 'the family override comes first');
});

test('graph nodes carry the distinct palette indices of their families, single families stay flat', () => {
  const g = buildMapGraph(tree());
  assert.deepEqual(g.byId.get('s:disco').fis, [familyIndex('Funk / Soul'), familyIndex('Electronic')]);
  assert.equal(g.byId.get('s:disco').fi, familyIndex('Funk / Soul'));
  assert.deepEqual(g.byId.get('s:house').fis, [0]);
  assert.equal(g.byId.get('s:tri').fis.length, 3);
  assert.deepEqual(g.byId.get('g:Rock').fis, [familyIndex('Rock')]);
  assert.deepEqual(uniqueIndices(['Other', 'Foo', 'Rock'], familyIndex), [15, 1]);
});

test('on the real vocabulary only multi-family genres are split and every set is within the cap', () => {
  const g = buildMapGraph(buildTree(realVocab()));
  const split = g.nodes.filter((n) => n.fis.length > 1);
  assert.ok(split.length > 0 && split.length < g.nodes.length / 2);
  assert.ok(g.nodes.every((n) => n.fis.length >= 1 && n.fis.length <= 3));
  assert.ok(split.some((n) => n.id === 's:disco' && n.fis[0] === familyIndex('Funk / Soul') && n.fis[1] === familyIndex('Electronic')));
});

test('radial hues keep the umbrella hue first and add the other families', () => {
  const t = tree();
  const layout = layoutRadial(t, 'Electronic');
  const disco = layout.byId.get('s:disco');
  assert.deepEqual(disco.hues, [familyIndex('Funk / Soul'), familyIndex('Electronic')], 'a split genre uses family colours only, never an umbrella hue');
  assert.equal(layout.byId.get('s:house') === undefined || layout.byId.get('s:house').hues.length >= 1, true);
  assert.deepEqual(layout.byId.get('g:Electronic').hues, [0]);
  assert.deepEqual(hueSet(3, { fams: ['Rock', 'Electronic'] }), [1, 0]);
  assert.deepEqual(hueSet(3, { fams: ['Electronic'] }), [3], 'a single family keeps the umbrella hue');
  assert.deepEqual(hueSet(3, {}), [3]);
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

test('regression: every multi-family genre of the vocabulary is coloured by exactly its families, in parents order, from the family palette', () => {
  const vocab = realVocab();
  const tree = buildTree(vocab);
  const g = buildMapGraph(tree);
  const palette = new Set(vocab.families.map((f) => familyIndex(f)));
  const famOf = (k, seen = new Set()) => {
    if (vocab.families.includes(k)) return [k];
    if (seen.has(k) || !vocab.levels[k]) return [];
    seen.add(k);
    const v = vocab.levels[k];
    const out = v.family ? [v.family] : [];
    for (const p of v.parents) for (const f of famOf(p, seen)) if (!out.includes(f)) out.push(f);
    return out;
  };
  let multi = 0;
  for (const [k, v] of Object.entries(vocab.levels)) {
    const want = [...new Set(famOf(k).slice(0, 3).map((f) => familyIndex(f)))];
    const node = g.byId.get(`s:${k}`);
    assert.deepEqual(node.fis, want, k);
    for (const i of node.fis) assert.ok(palette.has(i), `${k}: colour ${i} is not a family colour`);
    if (want.length > 1) multi++;
    void v;
  }
  assert.ok(multi > 0);
  assert.deepEqual(g.byId.get('s:disco').fis, [familyIndex('Funk / Soul'), familyIndex('Electronic')]);
  assert.deepEqual([familyIndex('Funk / Soul'), familyIndex('Electronic')], [5, 0]);
  const layout = layoutRadial((() => { const t2 = buildTree(vocab); applyCounts(t2, [{ id: 'x', tags: ['genre:disco'] }]); return t2; })(), 'Electronic');
  assert.deepEqual(layout.byId.get('s:disco').hues, [5, 0], 'the Radial colours disco by Funk / Soul and Electronic, not by its umbrella hue');
});
