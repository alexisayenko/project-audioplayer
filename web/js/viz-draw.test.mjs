import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createViz } from './viz-canvas.js';
import { drawBars } from './viz-bars.js';
import { createGlow } from './viz-glow.js';
import { makeGovernor, barCount } from './viz-spectrum.js';
import { createBackdrop, spokeSegments } from './viz-backdrop.js';
import { FALLBACK_COLORS } from './viz-color.js';

const DRAW = new Set(['clearRect', 'drawImage', 'fill', 'fillRect', 'stroke', 'fillText', 'arc']);

function recorder() {
  const log = [];
  const stack = [];
  const state = { globalCompositeOperation: 'source-over', filter: 'none', seenFilters: [], fills: [] };
  const ctx = new Proxy(state, {
    get(t, k) {
      if (k === 'log') return log;
      if (k in t) return t[k];
      return (...a) => {
        if (k === 'save') stack.push(t.globalCompositeOperation);
        if (k === 'restore') t.globalCompositeOperation = stack.pop() ?? 'source-over';
        if (DRAW.has(k)) log.push({ k, op: t.globalCompositeOperation, fillStyle: t.fillStyle });
        if (k.startsWith('create')) return { addColorStop() {} };
        return undefined;
      };
    },
    set(t, k, v) { t[k] = v; if (k === 'filter') t.seenFilters.push(v); if (k === 'fillStyle') t.fills.push(v); return true; },
  });
  return ctx;
}

function rig() {
  const main = recorder();
  const canvas = { getContext: () => main, width: 0, height: 0 };
  const now = { t: 0 };
  let rafFn = null;
  const deps = {
    doc: { addEventListener() {}, removeEventListener() {} },
    getAnalyser: () => ({ frequencyBinCount: 4096, fftSize: 8192, minDecibels: -100, maxDecibels: -30, context: { sampleRate: 44100 }, getFloatFrequencyData: (a) => a.fill(-45) }),
    isPlaying: () => true,
    isVisible: () => true,
    reducedQuery: () => ({ matches: false, addEventListener() {} }),
    isCoarse: () => false,
    getColors: () => FALLBACK_COLORS,
    raf: (fn) => { rafFn = fn; return 1; },
    caf() {},
    now: () => now.t,
    dpr: () => 1,
    createOffscreen: () => ({ width: 0, height: 0, getContext: () => recorder() }),
  };
  const viz = createViz({ canvas, mode: 'full', deps });
  viz.resize(1900, 400);
  viz.setEnabled(true);
  const tick = () => { now.t += 34; const fn = rafFn; rafFn = null; fn(now.t); };
  return { viz, main, tick };
}

const names = (log) => log.map((e) => e.k).join(',').replace(/(fill,)+/g, 'fill*,');

test('one frame at quality level 0: clear, backdrop, upper bars, flipped lower bars, horizon, two glow composites, nothing else', () => {
  const { viz, main, tick } = rig();
  for (let i = 0; i < 70; i += 1) tick();
  assert.equal(viz.level, 0);
  main.log.length = 0;
  tick();
  assert.match(names(main.log), /^clearRect,drawImage,fill\*,fillRect,fillRect,fillRect,drawImage,drawImage$/);
  const imgs = main.log.filter((e) => e.k === 'drawImage');
  assert.equal(imgs[1].op, 'lighter');
  assert.equal(imgs[2].op, 'lighter');
  assert.equal(main.log.filter((e) => e.k === 'fill').length <= 16, true);
});

test('quality level 1 has backdrop plus one glow composite', () => {
  const { viz, main, tick } = rig();
  tick();
  assert.equal(viz.level, 1);
  main.log.length = 0;
  tick();
  assert.equal(main.log.filter((e) => e.k === 'drawImage').length, 2);
});

test('bar pass draws only gradients (no white tips) and at most 24 fills for 700 bars', () => {
  const ctx = recorder();
  drawBars(ctx, 1900, 400, new Float32Array(700).fill(0.6), { colors: FALLBACK_COLORS, horizon: 0.5, dpr: 1.5 });
  assert.ok(ctx.fills.every((f) => typeof f === 'object'), 'no solid-colour (white) fill style');
  const fills = ctx.log.filter((e) => e.k === 'fill' || e.k === 'fillRect');
  assert.ok(fills.length <= 24, `${fills.length} fills`);
  assert.ok(fills.length >= 8);
  assert.ok(ctx.log.every((e) => e.op === 'lighter'));
});

test('glow composites with lighter, clears and resets its layers each frame', () => {
  const offs = [];
  const glow = createGlow(() => { const c = recorder(); const off = { width: 0, height: 0, getContext: () => c }; offs.push(c); return off; });
  const ctx = recorder();
  const canvas = { width: 800, height: 200 };
  glow.apply(ctx, canvas, 800, 200, 'full');
  glow.apply(ctx, canvas, 800, 200, 'full');
  assert.equal(offs.length, 2);
  const comp = ctx.log.filter((e) => e.k === 'drawImage');
  assert.equal(comp.length, 4);
  assert.ok(comp.every((e) => e.op === 'lighter'));
  for (const o of offs) {
    assert.deepEqual(o.log.map((e) => e.k), ['clearRect', 'drawImage', 'clearRect', 'drawImage']);
    assert.equal(o.globalCompositeOperation, 'source-over');
  }
  assert.equal(glow.apply(ctx, canvas, 800, 200, 'none'), false);
});

test('backdrop renders its offscreen once per size and only draws one image per frame', () => {
  const off = recorder();
  const bd = createBackdrop(() => ({ width: 0, height: 0, getContext: () => off }));
  const ctx = recorder();
  for (let i = 0; i < 5; i += 1) bd.draw(ctx, 800, 400, FALLBACK_COLORS, 0.5);
  assert.equal(off.log.filter((e) => e.k === 'stroke').length, 1);
  assert.equal(ctx.log.filter((e) => e.k === 'drawImage').length, 5);
  bd.draw(ctx, 900, 400, FALLBACK_COLORS, 0);
  assert.equal(off.log.filter((e) => e.k === 'stroke').length, 2);
});

test('spoke segments are deterministic and sit around the radius', () => {
  const a = spokeSegments(100, 100, 50, 40);
  assert.deepEqual(a, spokeSegments(100, 100, 50, 40));
  assert.equal(a.length, 40);
  for (const [x0, y0, x1, y1] of a) assert.ok(Math.hypot(x0 - 100, y0 - 100) < 50 && Math.hypot(x1 - 100, y1 - 100) > 50);
});

test('bar count and pitch are constant across every governor level (density never changes)', () => {
  const r = rig();
  const seen = new Set();
  for (let level = 0; level < 4; level += 1) {
    const g = makeGovernor({ fps: 30, window: 1, startLevel: level });
    seen.add(barCount(1900, g.quality().scale));
  }
  assert.equal(seen.size, 1);
  assert.equal([...seen][0], barCount(1900));
  assert.ok(r.viz);
});

test('glow without ctx.filter support draws nothing (no sharp ghost copy of the bars)', () => {
  const glow = createGlow(() => ({ width: 0, height: 0, getContext: () => { const c = recorder(); delete c.filter; return new Proxy({}, { get: (_, k) => (k === 'log' ? c.log : (k in c && k !== 'filter' ? c[k] : (typeof c[k] === 'function' ? c[k] : undefined))), has: (_, k) => k !== 'filter' && k in c }); } }));
  const ctx = recorder();
  assert.equal(glow.apply(ctx, { width: 800, height: 200 }, 800, 200, 'full'), false);
  assert.equal(ctx.log.filter((e) => e.k === 'drawImage').length, 0);
});

test('halo glow is blurred, never an unblurred upscaled copy', () => {
  const offs = [];
  const glow = createGlow(() => ({ width: 0, height: 0, getContext: () => { const c = recorder(); offs.push(c); return c; } }));
  glow.apply(recorder(), { width: 800, height: 200 }, 800, 200, 'halo');
  assert.ok(offs[0].fills !== undefined);
  assert.ok(offs[0].seenFilters.some((f) => f !== 'none'));
});
