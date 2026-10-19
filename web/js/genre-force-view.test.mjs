import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { buildMapGraph } from './genre-map-graph.js';
import { VOCAB, SONGS } from './genre-levels-fixture.mjs';
import { realVocab } from './genre-real-vocab.mjs';

let frames = [];
let clock = 0;
let fills = [];
let texts = [];
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456', fontFamily: 'sans-serif' });
globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
globalThis.cancelAnimationFrame = () => { frames = []; };
const { createForceView } = await import('./genre-force-view.js');

function makeCanvas({ noContext = false } = {}) {
  const h = new Map();
  const state = {};
  const ctx = new Proxy(state, {
    get: (t, k) => {
      if (k === 'fill') return () => fills.push({ alpha: t.globalAlpha, style: t.fillStyle });
      if (k === 'fillText') return (s, x, y) => texts.push({ s, x, y });
      if (k === 'measureText') return () => ({ width: 30 });
      if (k in t) return t[k];
      return () => {};
    },
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return {
    clientWidth: 800, clientHeight: 600, width: 0, height: 0, style: {},
    getContext: () => (noContext ? null : ctx),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (t, fn) => h.set(t, fn),
    fire: (t, ev = {}) => h.get(t)?.({ type: t, pointerId: 1, pointerType: 'mouse', buttons: 1, preventDefault() {}, ...ev }),
  };
}

const run = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const batch = frames.splice(0);
    clock += 16;
    for (const fn of batch) fn(clock);
  }
};
const settle = (n = 1500) => { for (let i = 0; i < n && frames.length; i++) run(1); };

function fixtureGraph() {
  const tree = buildTree(VOCAB);
  applyCounts(tree, SONGS);
  return buildMapGraph(tree);
}

function setup({ graph = fixtureGraph(), reducedMotion = false, saved = null } = {}) {
  frames = []; fills = []; texts = [];
  const canvas = makeCanvas();
  const picked = [];
  const hovered = [];
  const view = createForceView(canvas, { onSelect: (id) => picked.push(id), onHover: (n, pt) => hovered.push(n ? { id: n.id, pt } : null), reducedMotion });
  view.setGraph(graph, { saved });
  view.resize();
  return { canvas, view, graph, picked, hovered };
}

const at = (view, id) => view.nodeScreen(id);
const click = (canvas, p, extra = {}) => {
  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y, ...extra });
  canvas.fire('pointerup', { clientX: p.x, clientY: p.y, buttons: 0, ...extra });
};

test('the simulation cools, the loop stops by itself and nothing is scheduled afterwards', () => {
  const { view } = setup();
  settle();
  const s = view.stats();
  assert.equal(s.awake, false);
  assert.ok(s.ticks > 50 && s.sleeps === 1);
  assert.equal(frames.length, 0);
  const frameCount = s.frames;
  run(5);
  assert.equal(view.stats().frames, frameCount);
});

test('a click on a circle selects it, a click on the background deselects', () => {
  const { canvas, view, picked } = setup();
  settle();
  click(canvas, at(view, 's:house'));
  assert.deepEqual(picked, ['s:house']);
  click(canvas, { x: 3, y: 3 });
  assert.deepEqual(picked, ['s:house', null]);
});

test('dragging a circle pins it under the pointer, pulls its neighbour, does not select and releases it', () => {
  const { canvas, view, picked, graph } = setup();
  settle();
  const p = at(view, 's:house');
  const kid = graph.byId.get('s:deep house');
  const kidBefore = { x: kid.x, y: kid.y };
  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y });
  canvas.fire('pointermove', { clientX: p.x + 3, clientY: p.y });
  assert.equal(graph.byId.get('s:house').fx, null, 'a move under the threshold does not drag');
  canvas.fire('pointermove', { clientX: p.x + 140, clientY: p.y + 60 });
  run(40);
  const now = at(view, 's:house');
  assert.ok(Math.abs(now.x - (p.x + 140)) < 1e-6 && Math.abs(now.y - (p.y + 60)) < 1e-6, 'pinned at the pointer');
  assert.equal(view.stats().awake, true);
  assert.ok(Math.hypot(kid.x - kidBefore.x, kid.y - kidBefore.y) > 5, 'the neighbour was pulled along');
  canvas.fire('pointerup', { clientX: p.x + 140, clientY: p.y + 60, buttons: 0 });
  assert.deepEqual(picked, []);
  assert.equal(graph.byId.get('s:house').fx, null);
  settle();
  assert.equal(view.stats().awake, false);
});

test('dragging the background pans without selecting; the wheel zooms around the pointer; pinch zooms', () => {
  const { canvas, view, picked } = setup();
  settle();
  const p = at(view, 's:house');
  canvas.fire('pointerdown', { clientX: 2, clientY: 2 });
  canvas.fire('pointermove', { clientX: 82, clientY: 52 });
  canvas.fire('pointerup', { clientX: 82, clientY: 52, buttons: 0 });
  run(2);
  const moved = at(view, 's:house');
  assert.ok(Math.abs(moved.x - p.x - 80) < 1e-6 && Math.abs(moved.y - p.y - 50) < 1e-6);
  assert.deepEqual(picked, []);
  const before = at(view, 's:house');
  const wheel = canvas.fire('wheel', { clientX: before.x, clientY: before.y, deltaY: -300, deltaMode: 0 });
  void wheel;
  run(2);
  const after = at(view, 's:house');
  assert.ok(after.r > before.r, 'zoomed in');
  assert.ok(Math.abs(after.x - before.x) < 1e-6 && Math.abs(after.y - before.y) < 1e-6, 'the point under the pointer stays');
  canvas.fire('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 300, clientY: 300 });
  canvas.fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 400, clientY: 300 });
  canvas.fire('pointermove', { pointerId: 2, pointerType: 'touch', clientX: 500, clientY: 300 });
  run(2);
  assert.ok(at(view, 's:house').r > after.r, 'pinch spread zooms in');
  canvas.fire('pointerup', { pointerId: 2, pointerType: 'touch', buttons: 0 });
  canvas.fire('pointerup', { pointerId: 1, pointerType: 'touch', buttons: 0 });
});

test('hover only reports the node and point and never selects or dims; a click selects and dims the others; leave clears the hover', () => {
  const { canvas, view, hovered, picked } = setup();
  settle();
  const p = at(view, 's:house');
  fills = []; run(1); view.zoomBy(1); run(1);
  const plain = Math.min(...fills.map((f) => f.alpha));
  canvas.fire('pointermove', { clientX: p.x, clientY: p.y, buttons: 0 });
  run(2);
  assert.equal(hovered.at(-1).id, 's:house');
  assert.deepEqual(hovered.at(-1).pt, { x: p.x, y: p.y });
  assert.deepEqual(picked, [], 'hover does not select');
  fills = []; view.zoomBy(1); run(1);
  assert.equal(Math.min(...fills.map((f) => f.alpha)), plain, 'hover does not dim the rest');
  click(canvas, p);
  assert.deepEqual(picked, ['s:house']);
  view.select('s:house');
  fills = []; view.zoomBy(1); run(1);
  assert.ok(Math.min(...fills.map((f) => f.alpha)) < plain / 3, 'a selection dims the others');
  canvas.fire('pointerleave', {});
  assert.equal(hovered.at(-1), null);
  assert.deepEqual(picked, ['s:house']);
});

test('library genres are drawn stronger than genres without songs, hubs always fully', () => {
  const { view } = setup();
  settle();
  fills = []; view.zoomBy(1); run(1);
  const alphas = new Set(fills.map((f) => Math.round(f.alpha * 100)));
  assert.deepEqual([...alphas].sort((a, b) => a - b), [34, 72, 100]);
});

test('a filter fades hidden circles out, drops them from hit tests and the simulation, and fades them back in', () => {
  const { canvas, view, graph, picked } = setup();
  settle();
  const rock = new Set(['g:Rock', 's:rock and roll']);
  view.zoomBy(0.4);
  view.zoomBy(0.4);
  run(1);
  view.setVisible(rock);
  const p = at(view, 's:house');
  fills = []; run(1);
  assert.ok(fills.some((f) => f.alpha > 0 && f.alpha < 1));
  settle();
  fills = []; view.zoomBy(1); run(1);
  assert.equal(fills.length, 2);
  click(canvas, at(view, 's:house'));
  assert.ok(!picked.includes('s:house'), 'a hidden circle cannot be hit');
  view.setVisible(null);
  settle();
  fills = []; view.zoomBy(1); run(1);
  assert.ok(fills.length >= graph.nodes.length, 'every circle is back (plus the question badge)');
  assert.ok(Number.isFinite(graph.byId.get('s:house').x));
});

test('entering circles start next to a visible neighbour instead of flying in from afar', () => {
  const { view, graph } = setup();
  settle();
  view.setVisible(new Set(['g:Electronic', 's:house']));
  settle();
  const dnb = graph.byId.get('s:deep house');
  dnb.x = 5000; dnb.y = 5000;
  view.setVisible(new Set(['g:Electronic', 's:house', 's:deep house']));
  const house = graph.byId.get('s:house');
  assert.ok(Math.hypot(dnb.x - house.x, dnb.y - house.y) < 60);
});

test('double click zooms to the circle and its neighbours and centres it', () => {
  const { canvas, view } = setup();
  settle();
  const p = at(view, 's:deep house');
  const k0 = view.stats().k;
  canvas.fire('dblclick', { clientX: p.x, clientY: p.y });
  run(40);
  assert.ok(view.stats().k > k0 * 0.9);
  const c = at(view, 's:deep house');
  assert.ok(Math.abs(c.x - 400) < 250 && Math.abs(c.y - 300) < 250);
});

test('focusNode centres on a circle in the free area and respects the panel inset', () => {
  const { view } = setup();
  settle();
  view.setFocusInset({ r: 360, b: 0 });
  view.focusNode('s:house');
  run(40);
  const c = at(view, 's:house');
  assert.ok(Math.abs(c.x - (16 + (800 - 16 - 360) / 2)) < 1);
  assert.ok(Math.abs(c.y - (16 + (600 - 32) / 2)) < 1);
});

test('reduced motion: a static layout, no ticks, no loop, dragging moves only the dragged circle', () => {
  const { canvas, view, graph } = setup({ reducedMotion: true });
  run(3);
  const s = view.stats();
  assert.equal(s.ticks, 0);
  assert.equal(frames.length, 0);
  const p = at(view, 's:house');
  const kid = graph.byId.get('s:deep house');
  const kidBefore = { x: kid.x, y: kid.y };
  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y });
  canvas.fire('pointermove', { clientX: p.x + 90, clientY: p.y });
  run(5);
  assert.ok(Math.abs(at(view, 's:house').x - (p.x + 90)) < 1e-6);
  assert.deepEqual({ x: kid.x, y: kid.y }, kidBefore);
  canvas.fire('pointerup', { clientX: p.x + 90, clientY: p.y, buttons: 0 });
  run(5);
  assert.equal(view.stats().ticks, 0);
  assert.equal(frames.length, 0);
});

test('with the real vocabulary the labels that do not fit are hidden, never overlap, and the loop stays cheap', () => {
  const tree = buildTree(realVocab());
  applyCounts(tree, []);
  const graph = buildMapGraph(tree);
  const { view } = setup({ graph });
  settle(600);
  texts = []; view.zoomBy(1); run(1);
  assert.ok(texts.length > 5 && texts.length < graph.nodes.length / 2, `${texts.length} labels`);
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      const hit = Math.abs(a.x - b.x) < 30 && Math.abs(a.y - b.y) < 14;
      assert.equal(hit, false, `${a.s} overlaps ${b.s}`);
    }
  }
  assert.equal(view.stats().nodes, graph.nodes.length);
  assert.ok(view.stats().links > 500);
  view.zoomBy(4); run(1);
  assert.ok(Number.isFinite(view.stats().k));
});

test('a new graph keeps the positions of circles it already had and keeps the selection', () => {
  const { view, graph } = setup();
  settle();
  view.select('s:house');
  const before = { x: graph.byId.get('s:house').x, y: graph.byId.get('s:house').y };
  const next = fixtureGraph();
  view.setGraph(next);
  assert.deepEqual({ x: next.byId.get('s:house').x, y: next.byId.get('s:house').y }, before);
});

test('destroy stops the loop and a canvas without a 2d context gives an inert view', () => {
  const { view } = setup();
  view.destroy();
  run(3);
  assert.equal(frames.length, 0);
  const inert = createForceView(makeCanvas({ noContext: true }));
  assert.doesNotThrow(() => { inert.setGraph({ nodes: [], links: [] }); inert.setVisible(null); inert.select('x'); inert.destroy(); });
});

const homes = (view) => new Map(view.exportPositions().map((p) => [p.id, p]));

test('the layout runs in time slices after the first frame, the circles settle on their rest positions and the loop then sleeps', () => {
  const { view, graph } = setup();
  assert.equal(view.stats().layoutDone, false, 'the crossing layout has not finished before the first frame');
  settle();
  const s = view.stats();
  assert.equal(s.layoutDone, true);
  assert.equal(s.awake, false);
  for (const n of graph.nodes) assert.ok(Math.hypot(n.x - n.hx, n.y - n.hy) < 3, `${n.id} rests on its home`);
});

test('dropping a dragged circle makes the drop its rest position; Reset layout brings back the automatic layout', () => {
  const { canvas, view } = setup();
  settle();
  const before = homes(view).get('s:house');
  const p = at(view, 's:house');
  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y });
  canvas.fire('pointermove', { clientX: p.x + 120, clientY: p.y + 40 });
  run(10);
  canvas.fire('pointerup', { clientX: p.x + 120, clientY: p.y + 40, buttons: 0 });
  settle();
  const moved = homes(view).get('s:house');
  assert.ok(Math.hypot(moved.x - before.x, moved.y - before.y) > 50, 'the drop is kept');
  const now = at(view, 's:house');
  assert.ok(Math.hypot(now.x - (p.x + 120), now.y - (p.y + 40)) < 40, 'the circle stays where it was dropped');
  view.resetLayout();
  settle();
  const reset = homes(view).get('s:house');
  assert.ok(Math.hypot(reset.x - before.x, reset.y - before.y) < 1e-6, 'the automatic layout is deterministic');
});

test('a saved layout seeds every circle in it; unknown circles are placed by the automatic layout; Use saved layout returns to it', () => {
  const graph = fixtureGraph();
  const saved = new Map(graph.nodes.filter((n) => n.id !== 's:afro house').map((n, i) => [n.id, [i * 70 - 200, (i % 3) * 60]]));
  const { view } = setup({ graph, saved });
  settle();
  const h = homes(view);
  for (const [id, pos] of saved) assert.deepEqual([h.get(id).x, h.get(id).y], pos);
  const house = h.get('s:house');
  const afro = h.get('s:afro house');
  assert.ok(Number.isFinite(afro.x) && Math.hypot(afro.x - house.x, afro.y - house.y) < 200, 'the unknown genre sits near its parent');
  view.resetLayout();
  settle();
  assert.notDeepEqual([homes(view).get('s:house').x, homes(view).get('s:house').y], saved.get('s:house'));
  view.useSavedLayout();
  settle();
  assert.deepEqual([homes(view).get('s:house').x, homes(view).get('s:house').y], saved.get('s:house'));
});

test('with reduced motion the layout is complete at once and nothing animates', () => {
  const { view, graph } = setup({ reducedMotion: true });
  assert.equal(view.stats().layoutDone, true);
  for (const n of graph.nodes) assert.ok(Math.hypot(n.x - n.hx, n.y - n.hy) < 4, `${n.id} rests near its layout position`);
  run(3);
  assert.equal(view.stats().ticks, 0);
});
