import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViz, shouldRun } from './viz-canvas.js';

function fakeCtx() {
  const calls = [];
  const proxy = new Proxy({}, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k in t) return t[k];
      return (...a) => {
        calls.push(String(k));
        if (k === 'createLinearGradient' || k === 'createRadialGradient') return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  return proxy;
}

function setup(over = {}) {
  const ctx = fakeCtx();
  const canvas = { getContext: () => ctx, width: 0, height: 0, clientWidth: 0, clientHeight: 0 };
  const s = {
    playing: false, visible: true, reduced: false, analyser: null, rafs: 0, cafs: 0, pending: null, clock: 0, listeners: {},
  };
  const reducedMql = { get matches() { return s.reduced; }, addEventListener: (t, fn) => { s.listeners.reduced = fn; } };
  const doc = { addEventListener: (t, fn) => { s.listeners[t] = fn; }, removeEventListener() {} };
  const deps = {
    doc,
    getAnalyser: () => s.analyser,
    isPlaying: () => s.playing,
    isVisible: () => s.visible,
    reducedQuery: () => reducedMql,
    isCoarse: () => false,
    getColors: () => ({ a: [255, 0, 0], b: [0, 255, 0], accent: [0, 0, 255], scrim: [0, 0, 0], line: [255, 255, 255] }),
    raf: (fn) => { s.rafs += 1; s.pending = fn; return s.rafs; },
    caf: () => { s.cafs += 1; s.pending = null; },
    now: () => { s.clock += s.nowStep || 0; return s.clock; },
    dpr: () => 3,
    IntersectionObserver: over.IO,
    ResizeObserver: undefined,
    ...over.deps,
  };
  const viz = createViz({ canvas, mode: over.mode || 'full', deps });
  viz.resize(400, 200);
  const tick = (ms = 17) => { s.clock += ms; const fn = s.pending; s.pending = null; if (fn) fn(s.clock); };
  return { viz, s, ctx, canvas, tick };
}

const fakeAnalyser = (db = -40) => ({
  frequencyBinCount: 1024, fftSize: 2048, minDecibels: -100, maxDecibels: -30, context: { sampleRate: 48000 },
  getFloatFrequencyData: (a) => a.fill(db),
});

test('shouldRun needs every condition', () => {
  const all = { enabled: true, active: true, visible: true, onScreen: true, reduced: false };
  assert.equal(shouldRun(all), true);
  for (const k of ['enabled', 'active', 'visible', 'onScreen']) assert.equal(shouldRun({ ...all, [k]: false }), false, k);
  assert.equal(shouldRun({ ...all, reduced: true }), false);
});

test('canvas is sized with DPR capped at 2', () => {
  const { canvas } = setup();
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 400);
});

test('no rAF while disabled, even when playing', () => {
  const { viz, s } = setup();
  s.playing = true;
  viz.refresh();
  assert.equal(s.rafs, 0);
  assert.equal(viz.isRunning(), false);
});

test('loop starts when enabled and playing, and keeps scheduling', () => {
  const { viz, s, tick } = setup();
  s.playing = true;
  s.analyser = fakeAnalyser();
  viz.setEnabled(true);
  assert.equal(viz.isRunning(), true);
  tick();
  tick();
  assert.equal(viz.isRunning(), true);
  assert.ok(s.rafs >= 3);
});

test('paused: bars decay, then the loop stops and an idle frame is drawn', () => {
  const { viz, s, tick, ctx } = setup();
  s.playing = true;
  s.analyser = fakeAnalyser(-30);
  viz.setEnabled(true);
  for (let i = 0; i < 10; i += 1) tick();
  s.playing = false;
  let guard = 0;
  while (viz.isRunning() && guard < 400) { tick(); guard += 1; }
  assert.equal(viz.isRunning(), false, 'loop stopped');
  assert.ok(guard > 3 && guard < 400, `decayed over ${guard} frames`);
  assert.ok(ctx.calls.length > 0);
  const before = s.rafs;
  viz.refresh();
  assert.equal(s.rafs, before, 'no rAF while idle');
});

test('hidden tab stops the loop; visible again restarts it', () => {
  const { viz, s, tick } = setup();
  s.playing = true;
  viz.setEnabled(true);
  tick();
  s.visible = false;
  s.listeners.visibilitychange();
  assert.equal(viz.isRunning(), false);
  tick();
  s.visible = true;
  s.listeners.visibilitychange();
  assert.equal(viz.isRunning(), true);
});

test('off-screen (IntersectionObserver) stops the loop', () => {
  let cb;
  class IO { constructor(fn) { cb = fn; } observe() {} disconnect() {} }
  const { viz, s } = setup({ IO });
  s.playing = true;
  viz.setEnabled(true);
  assert.equal(viz.isRunning(), true);
  cb([{ isIntersecting: false }]);
  assert.equal(viz.isRunning(), false);
  cb([{ isIntersecting: true }]);
  assert.equal(viz.isRunning(), true);
});

test('reduced motion: never loops, draws a static frame', () => {
  const { viz, s, ctx } = setup();
  s.reduced = true;
  s.playing = true;
  viz.setEnabled(true);
  assert.equal(viz.isRunning(), false);
  assert.equal(s.rafs, 0);
  assert.equal(viz.isReduced(), true);
  assert.ok(ctx.calls.includes('fillRect'), 'static idle frame drawn');
});

test('turning reduced motion on while running stops the loop', () => {
  const { viz, s } = setup();
  s.playing = true;
  viz.setEnabled(true);
  assert.equal(viz.isRunning(), true);
  s.reduced = true;
  s.listeners.reduced();
  assert.equal(viz.isRunning(), false);
});

test('disabling stops and clears', () => {
  const { viz, s, ctx } = setup();
  s.playing = true;
  viz.setEnabled(true);
  viz.setEnabled(false);
  assert.equal(viz.isRunning(), false);
  assert.ok(ctx.calls.includes('clearRect'));
});

test('without an analyser the playing fallback draws idle animation (no throw)', () => {
  const { viz, s, tick, ctx } = setup();
  s.playing = true;
  s.analyser = null;
  viz.setEnabled(true);
  tick();
  tick();
  assert.ok(ctx.calls.includes('fillRect'));
});

test('bars mode draws rects and no ring; ring mode draws the ring at the anchor and no bars', () => {
  const bars = setup({ mode: 'background', deps: { getAnchor: () => ({ x: 50, y: 60, r: 30 }) } });
  bars.s.playing = true;
  bars.s.analyser = fakeAnalyser();
  bars.viz.setEnabled(true);
  bars.tick();
  assert.ok(bars.ctx.calls.includes('rect'));
  assert.ok(!bars.ctx.calls.includes('arc'));
  const ring = setup({ mode: 'background', deps: { getAnchor: () => ({ x: 50, y: 60, r: 30 }) } });
  ring.viz.setVizMode('ring');
  ring.s.playing = true;
  ring.s.analyser = fakeAnalyser();
  ring.viz.setEnabled(true);
  ring.tick(40);
  assert.ok(ring.ctx.calls.includes('arc'));
  assert.ok(!ring.ctx.calls.includes('rect'));
  ring.viz.setMode('full');
  ring.tick(40);
  assert.equal(ring.viz.isRunning(), true);
});

function fakeTerrain(log) {
  return {
    draw: (spec, t) => log.push(['draw', spec.length > 0, t]),
    resize: (w, h, dpr) => log.push(['resize', w, h, dpr]),
    setQuality: (q) => log.push(['q', q]),
    dispose: () => log.push(['dispose']),
  };
}

function glSetup(over = {}) {
  const log = [];
  const glc = { style: {}, hidden: true, removed: false, remove() { this.removed = true; } };
  const made = { gl: 0, terrain: 0 };
  const o = setup({
    mode: over.mode || 'full',
    deps: {
      createGLCanvas: () => { made.gl += 1; return glc; },
      createTerrain: () => { made.terrain += 1; return over.nullTerrain ? null : fakeTerrain(log); },
    },
  });
  o.s.playing = true;
  o.s.analyser = fakeAnalyser();
  return { ...o, log, glc, made };
}

test('GL canvas and terrain are created lazily: never in bars or ring mode', () => {
  const g = glSetup();
  g.viz.setEnabled(true);
  g.tick(40);
  g.viz.setVizMode('ring');
  g.tick(40);
  assert.equal(g.made.gl, 0);
  assert.equal(g.made.terrain, 0);
  assert.equal(g.viz.effectiveMode(), 'ring');
});

test('terrain mode draws only on the GL canvas, hides the 2D one, sizes the GL canvas by height scale in the background', () => {
  const g = glSetup({ mode: 'background' });
  g.viz.setHeightScale(1 / 3);
  g.viz.setVizMode('terrain');
  g.viz.setEnabled(true);
  g.tick(40);
  assert.equal(g.made.gl, 1);
  assert.equal(g.canvas.hidden, true);
  assert.equal(g.glc.hidden, false);
  assert.ok(g.log.some((e) => e[0] === 'draw' && e[1] === true));
  assert.ok(g.log.some((e) => e[0] === 'q'));
  assert.ok(!g.ctx.calls.includes('rect'));
  assert.ok(!g.ctx.calls.includes('arc'));
  assert.equal(g.viz.effectiveMode(), 'terrain');
  assert.ok(g.glc.style.height.includes('0.333'));
  const resize = g.log.find((e) => e[0] === 'resize');
  assert.ok(Math.abs(resize[2] - 200 / 3) < 1);
});

test('full-screen terrain fills the whole canvas whatever the height scale', () => {
  const g = glSetup();
  g.viz.setHeightScale(1 / 6);
  g.viz.setVizMode('terrain');
  g.viz.setEnabled(true);
  g.tick(40);
  assert.equal(g.glc.style.height, '100%');
  assert.equal(g.glc.style.top, '0%');
  const resize = g.log.filter((e) => e[0] === 'resize').pop();
  assert.equal(resize[2], 200);
  g.viz.setHeightScale(1 / 3);
  assert.equal(g.glc.style.height, '100%');
});

test('switching away from terrain disposes the renderer and removes the GL canvas; only one renderer is active', () => {
  const g = glSetup();
  g.viz.setVizMode('terrain');
  g.viz.setEnabled(true);
  g.tick(40);
  g.log.length = 0;
  g.viz.setVizMode('bars');
  assert.deepEqual(g.log.filter((e) => e[0] === 'dispose').length, 1);
  assert.equal(g.glc.removed, true);
  g.tick(40);
  assert.ok(!g.log.some((e) => e[0] === 'draw'));
  assert.equal(g.canvas.hidden, false);
  assert.ok(g.ctx.calls.includes('rect'));
  g.viz.setVizMode('terrain');
  g.tick(40);
  assert.equal(g.made.gl, 2);
  assert.equal(g.made.terrain, 2);
});

test('terrain failing to start falls back to the mirrored spectrum', () => {
  const g = glSetup({ nullTerrain: true });
  g.viz.setVizMode('terrain');
  g.viz.setEnabled(true);
  g.tick(40);
  assert.equal(g.viz.effectiveMode(), 'bars');
  assert.equal(g.canvas.hidden, false);
  assert.ok(g.ctx.calls.includes('rect'));
});

test('destroy disposes the terrain', () => {
  const g = glSetup();
  g.viz.setVizMode('terrain');
  g.viz.setEnabled(true);
  g.tick(40);
  g.log.length = 0;
  g.viz.destroy();
  assert.equal(g.log.filter((e) => e[0] === 'dispose').length, 1);
  assert.equal(g.glc.removed, true);
});

test('governor starts at level 1 and rises to 0 after 60 fast frames; slow frames lower it', () => {
  const fast = setup();
  fast.s.playing = true;
  fast.s.analyser = fakeAnalyser();
  fast.viz.setEnabled(true);
  assert.equal(fast.viz.level, 1);
  for (let i = 0; i < 70; i += 1) fast.tick(40);
  assert.equal(fast.viz.level, 0);
  const slow = setup();
  slow.s.playing = true;
  slow.s.analyser = fakeAnalyser();
  slow.s.nowStep = 20;
  slow.viz.setEnabled(true);
  for (let i = 0; i < 40; i += 1) slow.tick(40);
  assert.ok(slow.viz.level >= 2);
});

test('frame rate is capped at 30 fps', () => {
  const { viz, s, tick, ctx } = setup();
  s.playing = true;
  s.analyser = fakeAnalyser();
  viz.setEnabled(true);
  const start = ctx.calls.filter((c) => c === 'clearRect').length;
  for (let i = 0; i < 30; i += 1) tick(10);
  const drawn = ctx.calls.filter((c) => c === 'clearRect').length - start;
  assert.ok(drawn >= 8 && drawn <= 11, `drew ${drawn} frames in 300 ms`);
});

test('destroy stops the loop', () => {
  const { viz, s } = setup();
  s.playing = true;
  viz.setEnabled(true);
  viz.destroy();
  assert.equal(viz.isRunning(), false);
});
