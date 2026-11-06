import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTerrain } from './viz-terrain-gl.js';
import { setStyle, TERRAIN_STYLES, resetStyleForTests } from './viz-terrain-style.js';
import { markRows } from './viz-terrain-math.js';

const SLOTS = 5;

function strictGL() {
  const consts = new Map();
  const bufs = new Map();
  const st = { arrayBuf: null, elemBuf: null, en: Array(SLOTS).fill(false), ptr: Array(SLOTS).fill(null) };
  const draws = [];
  const errors = [];
  const bytesOf = (d) => (typeof d === 'number' ? d : d.byteLength);
  const check = (kind, mode, first, count, elemBytes) => {
    const enabled = st.en.map((e, i) => (e ? i : -1)).filter((i) => i >= 0);
    if (!(count > 0)) errors.push(`${kind} with count ${count}`);
    for (const i of enabled) {
      const p = st.ptr[i];
      if (!p || !p.buf || !bufs.has(p.buf)) errors.push(`${kind}: attribute ${i} enabled with no live buffer`);
      else if (kind === 'drawArrays') {
        const per = p.stride || p.size * 4;
        if (bufs.get(p.buf) < (first + count - 1) * per + p.size * 4) errors.push(`${kind}: attribute ${i} buffer too small`);
      }
    }
    if (kind === 'drawElements' && (!st.elemBuf || !bufs.has(st.elemBuf) || bufs.get(st.elemBuf) < count * elemBytes)) errors.push('drawElements: no usable element buffer');
    draws.push({ kind, mode, count, enabled });
  };
  const impl = {
    createBuffer: () => ({ kind: 'Buffer' }),
    bindBuffer: (t, b) => { if (t === gl.ARRAY_BUFFER) st.arrayBuf = b; else st.elemBuf = b; },
    bufferData: (t, d) => { bufs.set(t === gl.ARRAY_BUFFER ? st.arrayBuf : st.elemBuf, bytesOf(d)); },
    deleteBuffer: (b) => {
      bufs.delete(b);
      if (st.arrayBuf === b) st.arrayBuf = null;
      if (st.elemBuf === b) st.elemBuf = null;
      st.ptr.forEach((p, i) => { if (p?.buf === b) st.ptr[i] = { ...p, buf: null }; });
    },
    enableVertexAttribArray: (i) => { st.en[i] = true; },
    disableVertexAttribArray: (i) => { st.en[i] = false; },
    vertexAttribPointer: (i, size, _type, _n, stride) => {
      if (!st.arrayBuf) errors.push('vertexAttribPointer with no buffer');
      st.ptr[i] = { buf: st.arrayBuf, size, stride };
    },
    drawArrays: (mode, first, count) => check('drawArrays', mode, first, count),
    drawElements: (mode, count, type) => check('drawElements', mode, 0, count, type === gl.UNSIGNED_INT ? 4 : 2),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE,
    getUniformLocation: (_p, name) => ({ name }),
  };
  const gl = new Proxy({}, {
    get(_t, name) {
      if (name === 'draws') return draws;
      if (name === 'errors') return errors;
      if (name === 'state') return st;
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!consts.has(name)) consts.set(name, consts.size + 1);
        return consts.get(name);
      }
      if (impl[name]) return impl[name];
      if (name.startsWith('create')) return () => ({ kind: name.slice(6) });
      return () => undefined;
    },
  });
  return gl;
}

function fakeCanvas() {
  const handlers = {};
  return { width: 300, height: 150, handlers, addEventListener(n, f) { handlers[n] = f; }, removeEventListener(n) { delete handlers[n]; }, getContext: () => null };
}

const BINS = 64;
const RPS = 16;

function timeline() {
  const total = RPS * 30;
  const data = new Uint8Array(total * BINS).map((_, i) => ((i * 37) % 200) + (i % (8 * BINS) < 6 ? 50 : 0));
  const tl = { bins: BINS, rps: RPS, total, done: 0, data };
  tl.parts = new Uint8Array(total * BINS * 3).map((_, i) => (i * 53) % 251);
  tl.partsDone = total;
  tl.pitch = new Uint8Array(total * 2).map((_, i) => (i * 29) % 251);
  tl.pitchDone = total;
  markRows(tl, 0, total);
  return tl;
}

const spectrum = (f) => Array.from({ length: BINS }, (_, i) => Math.min(1, ((f % 12 < 3 ? 1 : 0.35) * (1 - i / (BINS * 1.4)) * ((i * 7 + f) % 10)) / 10));

function frames(t, from, n, tl) {
  for (let f = from; f < from + n; f += 1) {
    const ms = 1000 + f * 33;
    t.draw(spectrum(f), ms, tl ? { timeline: tl, time: 6 + (f * 33) / 1000 } : null, 0.02);
  }
}

function assertClean(gl, what) {
  assert.deepEqual(gl.errors, [], what);
  assert.ok(gl.draws.length > 0, what);
}

for (const { id } of TERRAIN_STYLES) {
  for (const quality of [0, 1, 2]) {
    test(`no draw with an enabled but unbound attribute: ${id}, quality ${quality}`, () => {
      resetStyleForTests();
      setStyle(id);
      const gl = strictGL();
      const t = createTerrain(fakeCanvas(), { gl, quality });
      const tl = timeline();
      frames(t, 0, 20, null);
      frames(t, 20, 20, tl);
      t.setQuality((quality + 1) % 3);
      frames(t, 40, 5, tl);
      t.resize(400, 120, 2);
      frames(t, 45, 5, tl);
      t.resize(120, 400, 1);
      frames(t, 50, 5, null);
      t.dispose();
      assertClean(gl, `${id}/${quality}`);
      assert.deepEqual(gl.state.en, Array(SLOTS).fill(false), 'dispose leaves no array enabled');
    });
  }
}

test('each pass enables exactly the attributes its program reads', () => {
  resetStyleForTests();
  setStyle('melody');
  const gl = strictGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 2 });
  frames(t, 0, 10, timeline());
  const quads = gl.draws.filter((d) => d.kind === 'drawArrays' && d.count === 4);
  const stars = gl.draws.filter((d) => d.kind === 'drawArrays' && d.count === 150);
  const grid = gl.draws.filter((d) => d.kind === 'drawArrays' && d.count > 150);
  assert.ok(quads.length > 0 && stars.length > 0 && grid.length > 0);
  quads.forEach((d) => assert.deepEqual(d.enabled, [0]));
  stars.forEach((d) => assert.deepEqual(d.enabled, [0, 1]));
  grid.forEach((d) => assert.deepEqual(d.enabled, [0, 1, 3, 4]));
  t.dispose();
  assertClean(gl, 'passes');
});

test('regression: the background quad drawn right after the grid is rebuilt does not see deleted buffers', () => {
  resetStyleForTests();
  setStyle('relief');
  const gl = strictGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 1 });
  frames(t, 0, 3, null);
  t.setQuality(0);
  gl.draws.length = 0;
  t.draw(spectrum(3), 2000, null, 0);
  assert.equal(gl.draws[0].count, 4);
  assert.deepEqual(gl.draws[0].enabled, [0]);
  assert.deepEqual(gl.errors, []);
  t.dispose();
});

test('regression: freeing the grid disables every array so no enabled attribute points at a deleted buffer', () => {
  resetStyleForTests();
  setStyle('relief');
  const gl = strictGL();
  const t = createTerrain(fakeCanvas(), { gl, quality: 1 });
  frames(t, 0, 3, null);
  assert.ok(gl.state.en.some(Boolean));
  t.setQuality(2);
  assert.ok(gl.state.en.every((e) => !e));
  t.dispose();
});

test('context loss and restore draw cleanly with a fresh context state', () => {
  resetStyleForTests();
  setStyle('lava');
  const gl = strictGL();
  const canvas = fakeCanvas();
  const t = createTerrain(canvas, { gl, quality: 1 });
  frames(t, 0, 5, null);
  canvas.handlers.webglcontextlost({ preventDefault() {} });
  gl.state.en.fill(false);
  gl.state.ptr.fill(null);
  frames(t, 5, 2, null);
  canvas.handlers.webglcontextrestored();
  frames(t, 7, 5, null);
  t.dispose();
  assertClean(gl, 'restore');
});

test('a GL error is not a renderer failure: the draw path never reads getError', () => {
  resetStyleForTests();
  const gl = strictGL();
  let reads = 0;
  const wrapped = new Proxy(gl, { get(t, n) { if (n === 'getError') reads += 1; return Reflect.get(t, n); } });
  const errs = [];
  const t = createTerrain(fakeCanvas(), { gl: wrapped, quality: 1, onError: (e) => errs.push(e) });
  frames(t, 0, 5, null);
  t.dispose();
  assert.equal(reads, 0);
  assert.deepEqual(errs, []);
});
