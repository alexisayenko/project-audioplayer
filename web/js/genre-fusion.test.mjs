import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts, populatedFamilies } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { FUSION_VOCAB, FUSION_SONGS } from './genre-fusion-fixture.mjs';

const make = (fusion) => { const t = buildTree(FUSION_VOCAB, { fusion }); applyCounts(t, FUSION_SONGS); return t; };
const kids = (t, id) => t.byId.get(id).children.map((c) => c.name);

test('fusion off: a fusion genre sits only under its home family (the first family listed when it has no genre parent), flat colour, no second-family link', () => {
  const t = make(false);
  assert.deepEqual(kids(t, 'g:Blues'), ['blues rock']);
  assert.deepEqual(kids(t, 'g:Rock'), []);
  assert.deepEqual(t.byId.get('s:blues rock').fams, ['Blues']);
  assert.deepEqual(t.byId.get('s:blues rock').parents, ['g:Blues']);
  assert.equal(t.byId.get('g:Rock').all.size, 0);
  assert.equal(t.byId.get('g:Blues').all.size, 2);
  assert.deepEqual(populatedFamilies(t), ['Blues', 'Electronic', 'Funk / Soul']);
  const g = buildMapGraph(t);
  assert.ok(!g.links.some((l) => l.source === 'g:Rock' && l.target === 's:blues rock'));
  assert.equal(g.byId.get('s:blues rock').fis.length, 1);
});

test('fusion off keeps the parents of a genre that is not flagged fusion', () => {
  const t = make(false);
  assert.deepEqual(t.byId.get('s:disco').fams, ['Electronic', 'Funk / Soul']);
  assert.deepEqual(kids(t, 'g:Electronic').sort(), ['disco', 'house']);
});

test('fusion on: it also appears under the second family, split colour, counted in both families', () => {
  const t = make(true);
  assert.deepEqual(kids(t, 'g:Blues'), ['blues rock']);
  assert.deepEqual(kids(t, 'g:Rock').includes('blues rock'), true);
  assert.deepEqual(t.byId.get('s:blues rock').fams, ['Blues', 'Rock']);
  assert.equal(t.byId.get('g:Rock').all.size, 2);
  assert.equal(t.byId.get('g:Blues').all.size, 2);
  assert.deepEqual(populatedFamilies(t).sort(), ['Blues', 'Electronic', 'Funk / Soul', 'Rock']);
  const g = buildMapGraph(t);
  assert.ok(g.links.some((l) => l.source === 'g:Rock' && l.target === 's:blues rock'));
  assert.equal(g.byId.get('s:blues rock').fis.length, 2);
  assert.deepEqual(t.byId.get('s:hard blues rock').fams, ['Blues', 'Rock'], 'children inherit the family set');
});

test('the default keeps all parents (callers that do not know about the toggle see the full data)', () => {
  const t = buildTree(FUSION_VOCAB);
  assert.deepEqual(t.byId.get('s:blues rock').fams, ['Blues', 'Rock']);
  assert.equal(t.byId.get('s:blues rock').fusion, true);
  assert.equal(t.byId.get('s:disco').fusion, false);
});

test('fusion off keeps the genre parents of a fusion genre and drops only its second family, whatever the order of the parents', () => {
  const levels = { ...FUSION_VOCAB.levels, 'hip house': { parents: ['Rock', 'house', 'Blues'], discogs: true, fusion: true }, 'trip hop': { parents: ['Blues', 'Rock'], discogs: true, fusion: true } };
  for (const order of [(x) => x, (x) => [...x].reverse()]) {
    const lv = Object.fromEntries(Object.entries(levels).map(([k, v]) => [k, { ...v, parents: order(v.parents) }]));
    const off = buildTree({ ...FUSION_VOCAB, levels: lv }, { fusion: false });
    assert.deepEqual(off.byId.get('s:hip house').parents, ['s:house'], 'the genre parent stays, both family parents go');
    assert.equal(off.byId.get('s:hip house').level, 3);
    const on = buildTree({ ...FUSION_VOCAB, levels: lv }, { fusion: true });
    assert.equal(on.byId.get('s:hip house').parents.length, 3);
    assert.equal(on.byId.get('s:hip house').level, 2, 'with the family parents back its level is the shortest path');
    assert.deepEqual(on.byId.get('s:hip house').fams, ['Blues', 'Electronic', 'Rock']);
  }
});
