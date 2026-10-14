import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitTransform, recenterOnResize, placeLabels, toggleHidden, presentFamilies, diffGraph, mixColor,
  shouldPoll, loadOutlineOpen, saveOutlineOpen, outlineDefaultOpen,
} from './genre-view.js';

test('fitTransform centres the bounds and respects maxK', () => {
  const t = fitTransform({ x0: -100, y0: -50, x1: 100, y1: 50 }, 800, 600, { pad: 0 });
  assert.equal(t.k, 2.2);
  assert.ok(Math.abs(t.x - 400) < 1e-9 && Math.abs(t.y - 300) < 1e-9);
  const big = fitTransform({ x0: 0, y0: 0, x1: 2000, y1: 1000 }, 1000, 1000, { pad: 0 });
  assert.equal(big.k, 0.5);
  assert.ok(Math.abs(big.x) < 1e-9 && Math.abs(big.y - 250) < 1e-9);
});

test('fitTransform centres in the area left by insets', () => {
  const t = fitTransform({ x0: 0, y0: 0, x1: 100, y1: 100 }, 1000, 600, { pad: 0, insets: { r: 400 }, maxK: 1 });
  assert.equal(t.k, 1);
  assert.equal(t.x + 50, 300);
});

test('recenterOnResize keeps the centre fixed', () => {
  const tf = { k: 2, x: 10, y: 20 };
  const next = recenterOnResize(tf, 800, 600, 1000, 700);
  assert.deepEqual(next, { k: 2, x: 110, y: 70 });
  assert.equal((1000 / 2 - next.x) / next.k, (800 / 2 - tf.x) / tf.k);
});

test('placeLabels skips overlapping labels in priority order', () => {
  const c = (id, x, y, force) => ({ id, x, y, w: 60, h: 14, force });
  const shown = placeLabels([c('a', 100, 100), c('b', 120, 105), c('c', 300, 100), c('d', 100, 140)]);
  assert.deepEqual([...shown].sort(), ['a', 'c', 'd']);
});

test('placeLabels places forced labels first and rejects others against them', () => {
  const c = (id, x, y, force) => ({ id, x, y, w: 60, h: 14, force });
  const shown = placeLabels([c('big', 100, 100), c('hover', 110, 100, true), c('near', 120, 102, true)]);
  assert.ok(shown.has('hover') && shown.has('near') && !shown.has('big'));
});

test('placeLabels shows more labels when candidates spread apart (zoom in)', () => {
  const at = (s) => [0, 1, 2, 3, 4].map((i) => ({ id: `n${i}`, x: i * 20 * s, y: 50, w: 60, h: 14 }));
  assert.ok(placeLabels(at(1)).size < placeLabels(at(4)).size);
  assert.equal(placeLabels(at(4)).size, 5);
});

test('legend filtering toggles families without mutating', () => {
  const h0 = new Set();
  const h1 = toggleHidden(h0, 'Rock');
  assert.equal(h0.size, 0);
  assert.ok(h1.has('Rock') && !h1.has('Pop'));
  assert.ok(!toggleHidden(h1, 'Rock').has('Rock'));
  const fams = presentFamilies([{ family: 'Pop' }, { family: 'Other' }, { family: 'Electronic' }, { family: 'Pop' }]);
  assert.deepEqual(fams.map((f) => [f.family, f.count]), [['Electronic', 1], ['Pop', 2], ['Other', 1]]);
});

test('diffGraph tells a recolour from a topology change', () => {
  const a = { nodes: [{ id: 'x', family: 'Other' }, { id: 'y', family: 'Other' }], edges: [{ source: 'x', target: 'y', kind: 'parent' }] };
  const b = { nodes: [{ id: 'x', family: 'Electronic' }, { id: 'y', family: 'Other' }], edges: [{ source: 'x', target: 'y', kind: 'parent' }] };
  assert.deepEqual(diffGraph(a, b), { sameTopology: true, changed: ['x'] });
  const c = { nodes: [...b.nodes, { id: 'z', family: 'Other' }], edges: b.edges };
  assert.equal(diffGraph(a, c).sameTopology, false);
  const d = { nodes: b.nodes, edges: [{ source: 'y', target: 'x', kind: 'parent' }] };
  assert.equal(diffGraph(a, d).sameTopology, false);
  assert.equal(diffGraph(null, a).sameTopology, false);
});

test('mixColor blends hex colours and passes others through', () => {
  assert.equal(mixColor('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixColor('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixColor('#000000', '#ffffff', 0.5), 'rgb(128,128,128)');
  assert.equal(mixColor('red', '#ffffff', 0.5), '#ffffff');
});

test('shouldPoll stops when done or after the limit', () => {
  assert.ok(shouldPoll(true, 0));
  assert.ok(!shouldPoll(false, 0));
  assert.ok(!shouldPoll(true, 24));
});

test('outline panel state: default by width, stored value wins, failing storage tolerated', () => {
  assert.ok(outlineDefaultOpen(1200) && !outlineDefaultOpen(1000));
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(loadOutlineOpen(st, 1400), true);
  assert.equal(saveOutlineOpen(st, false), true);
  assert.equal(loadOutlineOpen(st, 1400), false);
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(loadOutlineOpen(bad, 500), false);
  assert.equal(saveOutlineOpen(bad, true), false);
});
