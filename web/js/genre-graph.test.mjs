import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';
import { hitNode, isDragMove } from './genre-view.js';

installDom();
const frames = [];
globalThis.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
globalThis.cancelAnimationFrame = () => {};
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
const { createGraphView } = await import('./genre-graph.js');

const flushFrames = () => { const f = frames.splice(0); f.forEach((fn) => fn()); };

function makeCanvas() {
  const ls = new Map();
  const ctx = new Proxy({ measureText: () => ({ width: 10 }) }, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  return {
    style: {}, clientWidth: 800, clientHeight: 600, width: 0, height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    setPointerCapture() {},
    addEventListener(t, fn) { ls.set(t, fn); },
    emit(t, ev = {}) { ls.get(t)({ pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0, preventDefault() {}, ...ev }); },
  };
}

const GRAPH = {
  nodes: [
    { id: 'a', label: 'House', count: 3, family: 'Electronic' },
    { id: 'b', label: 'Trance', count: 2, family: 'Electronic' },
  ],
  edges: [{ source: 'b', target: 'a', kind: 'parent' }],
};

function setup() {
  const canvas = makeCanvas();
  const calls = { select: [], hover: [] };
  const view = createGraphView(canvas, { onSelect: (d) => calls.select.push(d && d.id), onHover: (h) => calls.hover.push(h) });
  view.setData(GRAPH);
  flushFrames();
  return { canvas, calls, view };
}


test('hitNode returns the topmost visible node within slack', () => {
  const nodes = [{ id: 1, x: 0, y: 0, r: 5 }, { id: 2, x: 2, y: 0, r: 5 }];
  assert.equal(hitNode(nodes, 1, 0, 0).id, 2);
  assert.equal(hitNode(nodes, 20, 0, 0), null);
  assert.equal(hitNode(nodes, 9, 0, 3).id, 2);
  assert.equal(hitNode(nodes, 1, 0, 0, (n) => n.id !== 2).id, 1);
});

test('isDragMove uses a 4px threshold', () => {
  assert.equal(isDragMove(3, 0), false);
  assert.equal(isDragMove(3, 3), true);
});

test('pointermove over the canvas never selects and is throttled to one hit-test per frame', () => {
  const { canvas, calls } = setup();
  for (let x = 0; x < 800; x += 5) canvas.emit('pointermove', { pointerId: 9, clientX: x, clientY: 300 });
  assert.equal(frames.length <= 2, true);
  flushFrames();
  assert.deepEqual(calls.select, []);
});

function findNode(canvas, calls) {
  for (let x = 0; x < 800; x += 6) {
    for (let y = 0; y < 600; y += 6) {
      canvas.emit('pointermove', { pointerId: 9, clientX: x, clientY: y });
      flushFrames();
      const h = calls.hover.at(-1);
      if (h) return { x, y, id: h.node.id };
    }
  }
  return null;
}

test('hover shows the tooltip only; click selects; click on empty canvas deselects', () => {
  const { canvas, calls } = setup();
  const p = findNode(canvas, calls);
  assert.ok(p);
  assert.deepEqual(calls.select, []);
  canvas.emit('pointerdown', { clientX: p.x, clientY: p.y });
  canvas.emit('pointerup', { clientX: p.x, clientY: p.y });
  assert.deepEqual(calls.select, [p.id]);
  canvas.emit('pointerdown', { clientX: 5, clientY: 5 });
  canvas.emit('pointerup', { clientX: 5, clientY: 5 });
  assert.deepEqual(calls.select, [p.id, null]);
});

test('dragging a node does not select it', () => {
  const { canvas, calls } = setup();
  const p = findNode(canvas, calls);
  canvas.emit('pointerdown', { clientX: p.x, clientY: p.y });
  canvas.emit('pointermove', { clientX: p.x + 30, clientY: p.y + 10 });
  canvas.emit('pointerup', { clientX: p.x + 30, clientY: p.y + 10 });
  assert.deepEqual(calls.select, []);
});

test('a press without movement selects and moves nothing', () => {
  const { canvas, calls } = setup();
  const p = findNode(canvas, calls);
  canvas.emit('pointerdown', { clientX: p.x, clientY: p.y });
  frames.splice(0);
  canvas.emit('pointerup', { clientX: p.x, clientY: p.y });
  assert.deepEqual(calls.select, [p.id]);
});
