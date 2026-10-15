import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { drawBars } from './viz-bars.js';
import { FALLBACK_COLORS } from './viz-color.js';

function trace(opts) {
  const log = [];
  const ctx = new Proxy({}, {
    get: (_, k) => (k === 'createLinearGradient' ? (...a) => { log.push(['grad', a]); return { addColorStop: (...s) => log.push(['stop', s]) }; } : (...a) => { log.push([k, a]); }),
    set: (_, k, v) => { log.push(['set', k, typeof v === 'object' ? 'obj' : v]); return true; },
  });
  const vals = Float32Array.from({ length: 120 }, (_, i) => ((i * 37) % 100) / 100);
  drawBars(ctx, 600, 300, vals, { colors: FALLBACK_COLORS, dpr: 1.5, ...opts });
  return log;
}

const hash = (log) => createHash('sha256').update(JSON.stringify(log)).digest('hex').slice(0, 16);

test('default and preset-like settings draw exactly the ops of the pre-LED renderer', () => {
  assert.equal(hash(trace({})), '77fd6c41b48c1f07');
  assert.equal(hash(trace({ widthFraction: 0.9, reflection: 0.8, glow: false, span: 1.1 })), '453ede7fe3898830');
  assert.equal(hash(trace({ alpha: 0.85, horizon: 0.5 })), 'bce9c34d3851e751');
});

const rects = (log) => log.filter(([k]) => k === 'rect');

test('LED sections cut each bar into stacked segments that follow the level', async () => {
  const { segmentPlan, litRows } = await import('./viz-bars.js');
  const plan = segmentPlan(100, 1, 10, 0.3);
  assert.equal(plan.rows, 10);
  assert.equal(plan.gapPx, 3);
  assert.equal(litRows(0, 1, plan), 0);
  assert.equal(litRows(35, 1, plan), 4);
  assert.equal(litRows(500, 1, plan), 10);
  assert.equal(segmentPlan(100, 1, 0, 0.3), null);
  const solid = rects(trace({}));
  const led = rects(trace({ segments: 12 }));
  assert.ok(led.length > solid.length);
  assert.ok(led.every(([, a]) => a[3] >= 1));
});

test('ice palette, vertical gradient, tips, band and backdrop each add ops, others stay off', () => {
  const base = trace({}).length;
  const vertical = trace({ direction: 'vertical' });
  assert.ok(vertical.some(([k, a]) => k === 'grad' && a[0] === 0 && a[2] === 0 && a[1] !== a[3]));
  assert.ok(trace({ band: 0.8 }).length > base);
  assert.ok(trace({ tips: true }).length > base);
  assert.equal(trace({ backdrop: 'ice', colors: { ...FALLBACK_COLORS, ice: undefined } }).length, base);
  assert.ok(trace({ backdrop: 'ice' }).length > base);
});

test('tips hold the peak and fall at the fading speed', async () => {
  const { stepTips, resetTips, barHeights } = await import('./viz-bars.js');
  resetTips();
  barHeights(new Float32Array([1, 1]), 100);
  assert.equal(stepTips(2, 0.5, 100, 0.1)[0], barHeights(new Float32Array([1]), 100)[0]);
  barHeights(new Float32Array([0, 0]), 100);
  const before = stepTips(2, 0.5, 100, 0.1)[0];
  const after = stepTips(2, 0.5, 100, 0.1)[0];
  assert.ok(after < before);
  assert.ok(Math.abs(before - after - 5) < 1e-3);
});

test('new LED effects are off by default and each adds ops when on', () => {
  const led = { segments: 12 };
  const base = trace(led);
  assert.equal(hash(trace({ ...led, peak: 0, afterimage: 0, shadeJitter: 0, baseGlow: 0, mirrorGap: 0, reflectionBlur: 0, tilt: 0, sectionHeight: 0 })), hash(base));
  for (const o of [{ peak: 1, afterimage: 0.5 }, { shadeJitter: 0.1 }, { baseGlow: 0.8 }, { reflectionBlur: 0.5 }, { tilt: 6 }, { mirrorGap: 6 }]) {
    assert.notEqual(hash(trace({ ...led, ...o })), hash(base), JSON.stringify(o));
  }
  assert.ok(trace({ backdrop: 'black' }).some(([k, a]) => k === 'fillRect' && a[2] === 600));
});

test('section height fixes the pitch independent of the row count', async () => {
  const { segmentPlan, litRows, jitterLevel } = await import('./viz-bars.js');
  const plan = segmentPlan(100, 1, 0, 0.25, 20);
  assert.equal(plan.rows, 5);
  assert.equal(plan.pitch, 20);
  assert.equal(segmentPlan(100, 2, 0, 0.25, 20).rows, 5);
  assert.equal(segmentPlan(10, 1, 0, 0.25, 20), null);
  assert.equal(litRows(40, 1, plan), 2);
  assert.equal(segmentPlan(100, 1, 0, 0.3), null);
});

test('shade jitter is deterministic, bounded and varied', async () => {
  const { jitterLevel } = await import('./viz-bars.js');
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) for (let r = 0; r < 20; r += 1) {
    const a = jitterLevel(i, r);
    assert.equal(a, jitterLevel(i, r));
    assert.ok(a >= 0 && a < 5);
    seen.add(a);
  }
  assert.equal(seen.size, 5);
});

test('tilt rotates about the canvas centre', () => {
  const t = trace({ segments: 12, tilt: 6 }).find(([k]) => k === 'setTransform');
  assert.ok(t[1][1] < 0 && Math.abs(t[1][0] - Math.cos((6 * Math.PI) / 180)) < 1e-9);
});

const quiet = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });

function player(level) {
  const vals = new Float32Array(4);
  return {
    set: (v) => vals.fill(v),
    draw: (dt, opts = {}) => drawBars(quiet, 600, 300, vals, { colors: FALLBACK_COLORS, segments: 10, peak: 1, afterimage: 1, peakDt: dt, dpr: 1, ...opts }),
  };
}

test('peak marker follows up instantly, holds, then steps down', async () => {
  const B = await import('./viz-bars.js');
  B.resetPeak();
  const p = player();
  p.set(0.8);
  p.draw(1 / 60);
  const high = B.markerRow(0);
  assert.ok(high >= 4);
  p.set(0.2);
  for (let f = 0; f < 30; f += 1) p.draw(1 / 60);
  assert.equal(B.markerRow(0), high);
  for (let f = 0; f < 15; f += 1) p.draw(1 / 60);
  assert.ok(B.markerRow(0) < high);
  const mid = B.markerRow(0);
  p.draw(0.12);
  assert.equal(B.markerRow(0), mid - 1);
  for (let f = 0; f < 400; f += 1) p.draw(1 / 60);
  p.set(0.8);
  p.draw(1 / 60);
  assert.equal(B.markerRow(0), high);
});

test('afterimages fade with time since the marker left and stay detached from the body', async () => {
  const B = await import('./viz-bars.js');
  B.resetPeak();
  const p = player();
  p.set(0.8);
  p.draw(1 / 60);
  const row = B.markerRow(0);
  p.set(0.1);
  for (let f = 0; f < 36; f += 1) p.draw(1 / 60);
  assert.equal(B.markerRow(0), row);
  assert.ok(B.afterAge(0, row) < 0.1);
  for (let f = 0; f < 9; f += 1) p.draw(1 / 60);
  assert.ok(B.markerRow(0) < row);
  const left = B.afterAge(0, row);
  assert.ok(B.afterAlpha(left, 0.35) > 0.5);
  for (let f = 0; f < 60; f += 1) p.draw(1 / 60);
  assert.ok(B.afterAge(0, row) > left + 0.9);
  assert.ok(B.afterAlpha(B.afterAge(0, row), 0.35) < 0.1);
  assert.ok(B.afterAlpha(0.1, 0.35) > B.afterAlpha(0.5, 0.35));
});

test('peak timing is frame-rate independent and frozen when paused', async () => {
  const B = await import('./viz-bars.js');
  const run = (fps) => {
    B.resetPeak();
    const p = player();
    p.set(0.8);
    p.draw(1 / fps);
    p.set(0.1);
    for (let f = 0; f < fps * 1.2; f += 1) p.draw(1 / fps);
    return B.markerRow(0);
  };
  const r30 = run(30);
  assert.ok(Math.abs(run(60) - r30) <= 1);
  assert.ok(Math.abs(run(120) - r30) <= 1);
  B.resetPeak();
  const p = player();
  p.set(0.8);
  p.draw(1 / 60);
  p.set(0.1);
  const m = B.markerRow(0);
  for (let f = 0; f < 200; f += 1) p.draw(0);
  assert.equal(B.markerRow(0), m);
});

test('peak 0 and afterimage 0 keep the old rendering; state is reused', async () => {
  const B = await import('./viz-bars.js');
  B.resetPeak();
  const base = hash(trace({ segments: 12 }));
  assert.equal(hash(trace({ segments: 12, peak: 0, afterimage: 0, peakDt: 1 })), base);
  assert.equal(hash(trace({ segments: 0, peak: 1, afterimage: 1, peakDt: 1 })), hash(trace({})));
  const p = player();
  p.set(0.5);
  p.draw(1 / 60);
  const before = process.memoryUsage().heapUsed;
  for (let k = 0; k < 300; k += 1) p.draw(1 / 60);
  assert.ok(process.memoryUsage().heapUsed - before < 20e6);
});

const SECTOR = { segments: 0, sectionHeight: 20, sectorMode: 'trail', peak: 1, afterimage: 1 };

function sectorPlayer(over = {}) {
  const vals = new Float32Array(over.n ?? 4);
  const ops = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : (...a) => { ops.push([k, a]); }), set: () => true });
  return {
    vals,
    ops,
    set: (v) => vals.fill(v),
    draw: (dt, opts = {}) => { ops.length = 0; drawBars(ctx, 600, 300, vals, { colors: FALLBACK_COLORS, dpr: 1, peakDt: dt, minDwell: 0, ...SECTOR, ...opts }); },
  };
}

test('sector mode: entering a row counts once, staying does not', async () => {
  const B = await import('./viz-bars.js');
  B.resetSector();
  const p = sectorPlayer();
  p.set(0.3);
  p.draw(1 / 60, {});
  const r = B.currentSector(0);
  assert.ok(r >= 0);
  for (let f = 0; f < 20; f += 1) p.draw(1 / 60, {});
  assert.equal(B.visitCount(0, r), 1);
  p.set(0.7);
  p.draw(1 / 60, {});
  p.set(0.3);
  p.draw(1 / 60, {});
  assert.equal(B.visitCount(0, r), 2);
});

test('sliding window: counts are integers, rise by visits and fall exactly W seconds later, any fps', async () => {
  const B = await import('./viz-bars.js');
  const run = (fps) => {
    B.resetSector();
    const p = sectorPlayer();
    const r0 = (() => { p.set(0.3); p.draw(0.001); return B.currentSector(0); })();
    const trace = [];
    const frames = Math.round(fps * 5);
    for (let f = 0; f < frames; f += 1) {
      p.set(f % Math.round(fps / 2) === 0 && f % fps < fps / 2 ? 0.7 : 0.3);
      p.draw(1 / fps, { window: 2 });
      trace.push(B.visitCount(0, r0));
    }
    for (let f = 0; f < fps * 3; f += 1) { p.draw(1 / fps, { window: 2 }); trace.push(B.visitCount(0, r0)); }
    return { r0, trace, peak: Math.max(...trace), last: trace.at(-1) };
  };
  for (const fps of [30, 60, 120]) {
    const o = run(fps);
    assert.ok(o.trace.every(Number.isInteger));
    assert.ok(o.peak >= 1, `fps ${fps}`);
    assert.equal(o.last, 0);
  }
  B.resetSector();
  const p = sectorPlayer();
  p.set(0.3);
  p.draw(0.05, { minDwell: 60 });
  const r = B.currentSector(0);
  assert.equal(B.visitCount(0, r), 0);
  p.draw(0.05, { minDwell: 60 });
  assert.equal(B.visitCount(0, r), 1);
  for (let k = 0; k < 19; k += 1) p.draw(0.1, { window: 2 });
  assert.equal(B.visitCount(0, r), 1);
  p.draw(0.1, { window: 2 });
  assert.equal(B.visitCount(0, r), 0);
});

test('sliding window: dt 0 (paused) freezes expiry, dt is capped, window setting applies live', async () => {
  const B = await import('./viz-bars.js');
  B.resetSector();
  const p = sectorPlayer();
  p.set(0.3);
  p.draw(0.001);
  p.draw(0.001);
  const r = B.currentSector(0);
  assert.equal(B.visitCount(0, r), 1);
  for (let f = 0; f < 500; f += 1) p.draw(0, { window: 2 });
  assert.equal(B.visitCount(0, r), 1);
  p.draw(1000, { window: 2 });
  assert.equal(B.visitCount(0, r), 1);
  for (let k = 0; k < 20; k += 1) p.draw(0.1, { window: 2 });
  assert.equal(B.visitCount(0, r), 0);
});

test('sliding window: several visits expire one by one in order; ring overflow keeps counts consistent', async () => {
  const B = await import('./viz-bars.js');
  B.resetSector();
  const p = sectorPlayer({ n: 1 });
  const lo = 0.3;
  const hi = 0.7;
  let rLo = -1;
  for (let k = 0; k < 3; k += 1) {
    p.set(lo); p.draw(0.1, { window: 4.5 }); p.draw(0.1, { window: 4.5 });
    rLo = B.currentSector(0);
    p.set(hi); p.draw(0.1, { window: 4.5 }); p.draw(0.1, { window: 4.5 });
  }
  assert.equal(B.visitCount(0, rLo), 3);
  for (let k = 0; k < 40; k += 1) p.draw(0.1, { window: 4.5 });
  assert.equal(B.visitCount(0, rLo), 1);
  for (let k = 0; k < 120; k += 1) p.draw(0.1, { window: 4.5 });
  assert.equal(B.visitCount(0, rLo), 0);
  B.resetSector();
  const q = sectorPlayer({ n: 1 });
  for (let k = 0; k < 600; k += 1) { q.set(k % 2 ? 0.7 : 0.3); q.draw(0.1, { window: 60 }); q.draw(0.1, { window: 60 }); }
  const rows = [B.currentSector(0)];
  let sum = 0;
  for (let r = 0; r < 20; r += 1) sum += B.visitCount(0, r);
  assert.ok(sum <= B.SECTOR_EVENTS && sum > 0 && rows[0] >= 0);
  for (let k = 0; k < 700; k += 1) q.draw(0.1, { window: 60 });
  sum = 0;
  for (let r = 0; r < 20; r += 1) sum += B.visitCount(0, r);
  assert.equal(sum, 0);
});

test('trail level steps at 5/10/15 counts, trail colours climb the dim ladder at alpha >= 0.9', async () => {
  const B = await import('./viz-bars.js');
  assert.deepEqual([4.9, 5, 9.9, 10, 15, 100].map((c) => B.trailLevel(c, 5, 6)), [0, 1, 1, 2, 3, 6]);
  assert.ok(B.TRAIL_ALPHA >= 0.9);
  const path = B.trailPath(FALLBACK_COLORS.ice2);
  assert.equal(path.length, 8);
  assert.deepEqual(path.slice(0, 4), FALLBACK_COLORS.ice2.dim);
  assert.deepEqual(B.trailColor(path, 0, 6, 1), path[0]);
  const top = B.trailColor(path, 6, 6, 0.8);
  const hsv = (c) => {
    const mx = Math.max(...c);
    const d = mx - Math.min(...c);
    return { s: mx ? d / mx : 0, v: mx / 255 };
  };
  assert.ok(hsv(top).v <= 0.8 + 0.01 && hsv(top).v > 0.75);
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  for (let k = 1; k <= 6; k += 1) assert.ok(lum(B.trailColor(path, k, 6, 0.8)) > lum(B.trailColor(path, k - 1, 6, 0.8)));
  for (let k = 0; k <= 6; k += 1) assert.ok(lum(B.trailColor(path, k, 6, 0.8, 2)) <= lum(B.trailColor(path, k, 6, 0.8)));
  for (const cap of [0.3, 0.5, 0.8, 1]) {
    for (let k = 0; k <= 6; k += 1) {
      const c = B.trailColor(path, k, 6, cap);
      const o = hsv(c);
      assert.ok(o.v <= cap + 0.01);
      if (k >= 5 && cap >= 0.5) assert.ok(o.s >= 0.55, `level ${k} cap ${cap} s ${o.s}`);
      assert.ok(Math.max(...c) - Math.min(...c) > 0 && c[2] >= c[1] && c[1] >= c[0]);
    }
  }
  B.resetSector();
  const p = sectorPlayer();
  for (let k = 0; k < 40; k += 1) { p.set(k % 2 ? 0.7 : 0.3); p.draw(0.001, {}); }
  p.draw(0.001, {});
  const alphas = p.ops.filter(([k]) => k === 'fill').length;
  assert.ok(alphas > 0);
});

test('sector mode draws no body, cap or afterimages and resets on count change', async () => {
  const B = await import('./viz-bars.js');
  B.resetSector();
  const p = sectorPlayer();
  p.set(0.6);
  p.draw(1 / 60);
  const rects = p.ops.filter(([k]) => k === 'rect');
  assert.equal(rects.length, 20);
  assert.ok(p.ops.some(([k]) => k === 'stroke'));
  const r = B.currentSector(0);
  p.set(0.2);
  p.draw(1 / 60);
  assert.ok(B.visitCount(0, r) > 0);
  const q = sectorPlayer({ n: 6 });
  q.set(0.2);
  q.draw(1 / 60);
  assert.equal(B.visitCount(0, r), 0);
  B.resetSector();
  p.draw(1 / 60);
  assert.equal(B.visitCount(0, r), 0);
});

test('sector mode off keeps the old renderer; no per-frame allocation, 600x48 stays fast', async () => {
  const B = await import('./viz-bars.js');
  assert.equal(hash(trace({ segments: 12, sectorMode: 'off' })), hash(trace({ segments: 12 })));
  B.resetSector();
  const p = sectorPlayer({ n: 600 });
  const opts = { sectionHeight: 6 };
  for (let f = 0; f < 5; f += 1) { p.vals.forEach((_, i, a) => { a[i] = ((i * 31 + f * 17) % 100) / 100; }); p.draw(1 / 60, opts); }
  const ref = B.sectorBuffers();
  const t0 = performance.now();
  for (let f = 0; f < 120; f += 1) { p.vals.forEach((_, i, a) => { a[i] = ((i * 31 + f * 17) % 100) / 100; }); p.draw(1 / 60, opts); }
  const per = (performance.now() - t0) / 120;
  assert.ok(per < 25, `${per} ms/frame`);
  const after = B.sectorBuffers();
  assert.ok(ref.every((a, i) => a === after[i]));
  assert.ok(B.visitCount(0, 0) >= 0);
});

test('minimum dwell: pass-through rows never count, threshold counts once, frame-rate independent', async () => {
  const B = await import('./viz-bars.js');
  const frames = (fps, n, dwell = 60) => {
    B.resetSector();
    const p = sectorPlayer();
    p.set(0.3);
    for (let f = 0; f < n; f += 1) p.draw(1 / fps, { minDwell: dwell });
    return B.visitCount(0, B.currentSector(0));
  };
  assert.equal(frames(60, 3), 0);
  assert.equal(frames(60, 4), 1);
  assert.equal(frames(60, 40), 1);
  assert.equal(frames(30, 1), 0);
  assert.equal(frames(30, 2), 1);
  assert.equal(frames(120, 7), 0);
  assert.equal(frames(120, 8), 1);
  assert.equal(frames(60, 1, 0), 1);
  B.resetSector();
  const p = sectorPlayer();
  const seen = [];
  for (const v of [0.1, 0.3, 0.5, 0.7]) { p.set(v); p.draw(1 / 60, { minDwell: 60 }); seen.push(B.currentSector(0)); }
  assert.equal(new Set(seen).size, 4);
  for (const r of seen) assert.equal(B.visitCount(0, r), 0);
  assert.ok(p.ops.some(([k]) => k === 'rect'));
  for (let f = 0; f < 3; f += 1) p.draw(1 / 60, { minDwell: 60 });
  assert.equal(B.visitCount(0, seen[3]), 1);
});

test('glow: extra additive halos per frame behind the sector, scaled by size, off in lite and when 0', async () => {
  const B = await import('./viz-bars.js');
  const fills = (ops) => ops.filter(([k]) => k === 'fill').length;
  const run = (over) => {
    B.resetSector();
    const p = sectorPlayer();
    p.set(0.5);
    p.draw(1 / 60, { sectorGlow: 0, ...over });
    p.draw(1 / 60, { sectorGlow: 0, ...over });
    return p.ops;
  };
  const off = run({});
  const on = run({ sectorGlow: 0.8 });
  assert.equal(fills(on) - fills(off), 6);
  assert.equal(fills(run({ sectorGlow: 0.8, lite: true })), fills(off));
  const rectW = (ops) => ops.filter(([k]) => k === 'rect').map(([, a]) => a[2]);
  assert.ok(Math.max(...rectW(run({ sectorGlow: 1, sectorGlowSize: 2 }))) > Math.max(...rectW(run({ sectorGlow: 1, sectorGlowSize: 1 }))));
  assert.deepEqual([0, 1, 2].map((j) => Math.round(B.glowExpand(j, 100, 1, 1))), [8, 16, 28]);
  assert.equal(B.glowExpand(0, 10, 1, 1), 2);
  assert.equal(B.glowExpand(0, 10, 2, 1), 4);
  assert.ok(Math.abs(B.glowExpand(2, 100, 1, 0.5) - 14) < 1e-9);
});

test('glow does not change other modes: sector off output is unchanged with glow set', () => {
  assert.equal(hash(trace({ segments: 12, sectorGlow: 1 })), hash(trace({ segments: 12 })));
});

test('trail floor: every trail level is visible against the ice2 background (dE2000 >= 10, reflection >= 6)', async () => {
  const B = await import('./viz-bars.js');
  const { deltaE2000 } = await import('./viz-deltae.js');
  const { bg } = FALLBACK_COLORS.ice2;
  const path = B.trailPath(FALLBACK_COLORS.ice2);
  const over = (c, a) => c.map((v, i) => Math.min(255, Math.round(bg[i] + v * a)));
  for (const maxLevel of [3, 6, 12]) {
    for (let k = 0; k <= maxLevel; k += 1) {
      const c = B.trailColor(path, k, maxLevel, 0.8);
      const r = B.trailColor(path, k, maxLevel, 0.8, B.TRAIL_REFLECT_SHIFT);
      assert.ok(deltaE2000(bg, over(c, B.TRAIL_ALPHA)) >= 10, `level ${k}/${maxLevel}`);
      assert.ok(deltaE2000(bg, over(r, B.TRAIL_ALPHA * 0.5)) >= 6, `reflection ${k}/${maxLevel}`);
    }
  }
});

test('sector rows span the full-scale bar height: a 0..1 sweep visits every row, count and height modes', async () => {
  const B = await import('./viz-bars.js');
  for (const o of [{ segments: 21, sectionHeight: 0, rows: 21 }, { segments: 0, sectionHeight: 20, rows: 7 }]) {
    B.resetSector();
    const p = sectorPlayer({ n: 1 });
    const seen = new Set();
    for (let k = 0; k <= 400; k += 1) {
      p.set(k / 400);
      p.draw(1 / 30, { segments: o.segments, sectionHeight: o.sectionHeight, maxHeightPx: 140, minDwell: 0 });
      seen.add(B.currentSector(0));
    }
    for (let r = 0; r < o.rows; r += 1) assert.ok(seen.has(r), `row ${r} of ${o.rows}`);
    assert.ok(!seen.has(o.rows), 'no row beyond the stack');
  }
});

test('segmentPlan: section height wins over the count; rows = floor(height / section height)', async () => {
  const { segmentPlan } = await import('./viz-bars.js');
  assert.equal(segmentPlan(140, 1, 21, 0.2, 0).rows, 21);
  assert.equal(segmentPlan(140, 1, 21, 0.2, 35).rows, 4);
  assert.equal(segmentPlan(140, 1, 0, 0.2, 0), null);
});
