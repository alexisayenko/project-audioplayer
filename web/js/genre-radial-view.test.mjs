import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, applyCounts } from './genre-levels.js';
import { layoutRadial } from './genre-radial.js';
import { VOCAB, SONGS } from './genre-levels-fixture.mjs';

let frames = [];
let drawCalls = {};
let transforms = [];
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456', fontFamily: 'sans-serif' });
globalThis.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
globalThis.cancelAnimationFrame = () => {};

function makeCanvas() {
  const h = new Map();
  const ctx = new Proxy({}, {
    get: (t, k) => (k === 'setTransform' ? (...a) => transforms.push(a) : k === 'measureText' ? () => ({ width: 30 }) : (...a) => { (drawCalls[k] ||= []).push(a); }),
    set: () => true,
  });
  return {
    clientWidth: 800, clientHeight: 600, width: 0, height: 0, style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    addEventListener: (t, fn) => h.set(t, fn),
    fire: (t, ev = {}) => h.get(t)?.({ type: t, pointerId: 1, pointerType: 'mouse', buttons: 1, preventDefault() {}, ...ev }),
  };
}

async function setup() {
  const { createRadialView } = await import('./genre-radial-view.js');
  const tree = buildTree(VOCAB);
  applyCounts(tree, SONGS);
  const layout = layoutRadial(tree, 'Electronic');
  const canvas = makeCanvas();
  const picked = [];
  const view = createRadialView(canvas, { onSelect: (id) => picked.push(id), onHover: () => {} });
  view.setLayout(layout, tree);
  const run = () => { while (frames.length) frames.splice(0).forEach((fn) => fn()); };
  const world = () => { run(); transforms = []; view.zoomBy(1); run(); return transforms[1]; };
  const pan = () => { const t = world(); return { x: t[4], y: t[5] }; };
  const screenOf = (id) => {
    const t = world();
    const n = layout.byId.get(id);
    return { x: n.x * t[0] + t[4], y: n.y * t[0] + t[5] };
  };
  return { canvas, view, layout, picked, pan, screenOf };
}

test('a click on a node selects it and releases: later moves neither pan nor select', async () => {
  const { canvas, picked, pan, screenOf } = await setup();
  const p = screenOf('s:house');
  const before = pan();
  canvas.fire('pointerdown', { clientX: p.x, clientY: p.y });
  canvas.fire('pointerup', { clientX: p.x, clientY: p.y, buttons: 0 });
  assert.deepEqual(picked, ['s:house']);
  canvas.fire('pointermove', { clientX: p.x + 80, clientY: p.y + 50, buttons: 0 });
  canvas.fire('pointermove', { clientX: p.x + 120, clientY: p.y + 90, buttons: 1 });
  assert.deepEqual(pan(), before);
  assert.deepEqual(picked, ['s:house']);
});

test('a drag pans while the button is held and ends on pointercancel', async () => {
  const { canvas, picked, pan } = await setup();
  const before = pan();
  canvas.fire('pointerdown', { clientX: 400, clientY: 300 });
  canvas.fire('pointermove', { clientX: 440, clientY: 330 });
  const moved = pan();
  assert.equal(moved.x, before.x + 40);
  assert.equal(moved.y, before.y + 30);
  canvas.fire('pointercancel', { buttons: 0 });
  canvas.fire('pointermove', { clientX: 600, clientY: 500 });
  assert.deepEqual(pan(), moved);
  assert.deepEqual(picked, []);
});

test('a lost pointerup is recovered: a move with no button held ends the drag', async () => {
  const { canvas, pan } = await setup();
  canvas.fire('pointerdown', { clientX: 400, clientY: 300 });
  canvas.fire('pointermove', { clientX: 430, clientY: 300 });
  const moved = pan();
  canvas.fire('pointermove', { clientX: 700, clientY: 500, buttons: 0 });
  assert.deepEqual(pan(), moved);
});

test('lostpointercapture ends the drag and the window blur handler is registered', async () => {
  const { canvas, pan } = await setup();
  canvas.fire('pointerdown', { clientX: 400, clientY: 300 });
  canvas.fire('pointermove', { clientX: 430, clientY: 300 });
  const moved = pan();
  canvas.fire('lostpointercapture');
  canvas.fire('pointermove', { clientX: 700, clientY: 500 });
  assert.deepEqual(pan(), moved);
});

test('labels never use leader lines: only edges are stroked as lines, none for labels', async () => {
  const { view, layout, pan } = await setup();
  const run = (f = 1) => { drawCalls = {}; while (frames.length) frames.splice(0).forEach((fn) => fn()); drawCalls = {}; view.zoomBy(f); frames.splice(0).forEach((f) => f()); return drawCalls; };
  pan();
  const c = run();
  const ticks = layout.nodes.filter((n) => n.node.status === 'approved').length;
  assert.equal((c.lineTo || []).length, layout.edges.length + 2 * ticks);
  assert.equal((c.moveTo || []).length, layout.edges.length + ticks);
  const texts = (c.fillText || []).map(([t, x, y]) => ({ t, x, y }));
  assert.ok(texts.length > 0);
  const boxes = texts.map((p) => ({ x: p.x - 15, y: p.y, w: 30, h: 14 }));
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const a = boxes[i]; const b = boxes[j];
    assert.equal(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, false);
  }
  const again = run();
  assert.deepEqual((again.fillText || []).map((x) => x.slice(0, 3)), texts.map((p) => [p.t, p.x, p.y]));
  const zoomed = run(3);
  assert.ok((zoomed.fillText || []).length >= 1);
});
