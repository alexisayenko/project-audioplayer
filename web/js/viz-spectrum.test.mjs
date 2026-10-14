import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dbToUnit, barEdges, resampleBars, barsDb, unitBars, makeReference, bassEnergy, smoothBars, updatePeaks, idleBars, makePulse, makePacer, makeGovernor,
  targetFps, capDpr, pickSpokes, maxOf, barCount, barHeight, edgeAlpha, shapeBars, barNoise, noiseStep,
} from './viz-spectrum.js';
import { mirror } from './viz-bars.js';
import { spokeAngles, pulseRadius, ringRadius } from './viz-ring.js';
import { parseColor, rgba, mixColor, barStops, lighten, sampleGradient, FALLBACK_COLORS } from './viz-color.js';
import { barGeometry } from './viz-bars.js';

const SR = 48000;
const FFT = 2048;
const OPTS = { sampleRate: SR, fftSize: FFT, minDb: -100, maxDb: -30 };
const bins = (fill) => new Float32Array(FFT / 2).fill(fill);

test('dbToUnit maps min..max to 0..1 and survives bad input', () => {
  assert.equal(dbToUnit(-100, -100, -30), 0);
  assert.equal(dbToUnit(-30, -100, -30), 1);
  assert.equal(dbToUnit(-65, -100, -30), 0.5);
  assert.equal(dbToUnit(-200, -100, -30), 0);
  assert.equal(dbToUnit(10, -100, -30), 1);
  for (const bad of [-Infinity, Infinity, NaN, undefined, null]) assert.equal(dbToUnit(bad), 0);
  assert.equal(dbToUnit(-50, -30, -30), 0);
});

test('barEdges are log spaced from 20 Hz to 16 kHz and increasing', () => {
  const e = barEdges(128, SR, FFT);
  assert.equal(e.length, 129);
  assert.ok(Math.abs(e[0] - 20) < 1e-3);
  assert.ok(Math.abs(e[128] - 16000) < 1);
  for (let i = 1; i < e.length; i += 1) assert.ok(e[i] > e[i - 1]);
  const r1 = e[1] / e[0];
  const r2 = e[100] / e[99];
  assert.ok(Math.abs(r1 - r2) < 1e-4);
});

test('barEdges clamps to the Nyquist frequency', () => {
  const e = barEdges(16, 8000, 1024);
  assert.ok(e[16] <= 4000 + 1e-3);
});

test('resampleBars returns n values in 0..1 and zeros for silence', () => {
  const quiet = resampleBars(bins(-Infinity), 64, OPTS);
  assert.equal(quiet.length, 64);
  assert.equal(maxOf(quiet), 0);
  const loud = resampleBars(bins(-30), 64, OPTS);
  assert.ok(loud.every((v) => v === 1));
  const mid = resampleBars(bins(-65), 64, OPTS);
  assert.ok(mid.every((v) => v > 0 && v < 1));
});

test('resampleBars is deterministic and finite for NaN input', () => {
  const data = bins(NaN);
  data[10] = -40;
  const a = resampleBars(data, 32, OPTS);
  const b = resampleBars(data, 32, OPTS);
  assert.deepEqual([...a], [...b]);
  assert.ok([...a].every(Number.isFinite));
});

test('resampleBars puts a tone in the bar that covers its frequency', () => {
  const data = bins(-120);
  const hz = 1000;
  data[Math.round(hz / (SR / FFT))] = -30;
  const n = 128;
  const bars = resampleBars(data, n, OPTS);
  const e = barEdges(n, SR, FFT);
  const peak = bars.indexOf(maxOf(bars));
  assert.ok(e[peak] <= hz * 1.05 && e[peak + 1] >= hz * 0.95, `peak bar ${peak} covers ${e[peak]}..${e[peak + 1]}`);
});

test('resampleBars handles empty data and zero bars', () => {
  assert.equal(resampleBars(new Float32Array(0), 8, OPTS).length, 8);
  assert.equal(resampleBars(null, 8, OPTS).length, 8);
  assert.equal(resampleBars(bins(-30), 0, OPTS).length, 0);
});

test('bassEnergy averages bins up to 150 Hz and ignores the rest', () => {
  const data = bins(-120);
  const binW = SR / FFT;
  for (let i = 1; i <= Math.floor(150 / binW); i += 1) data[i] = -30;
  assert.equal(bassEnergy(data, OPTS), 1);
  const treble = bins(-120);
  treble.fill(-30, Math.ceil(300 / binW));
  assert.equal(bassEnergy(treble, OPTS), 0);
  assert.equal(bassEnergy(bins(-Infinity), OPTS), 0);
  assert.equal(bassEnergy(null, OPTS), 0);
  const v = bassEnergy(bins(-65), OPTS);
  assert.ok(v >= 0 && v <= 1);
});

test('smoothBars rises with attack, falls with release, monotonic towards the target', () => {
  const s = new Float32Array(1);
  let prev = 0;
  for (let i = 0; i < 20; i += 1) {
    smoothBars(s, [1], 0.6, 0.15);
    assert.ok(s[0] >= prev && s[0] <= 1);
    prev = s[0];
  }
  const up = new Float32Array(1);
  smoothBars(up, [1], 0.6, 0.15);
  const down = new Float32Array([1]);
  smoothBars(down, [0], 0.6, 0.15);
  assert.ok(up[0] - 0 > 1 - down[0], 'attack is faster than release');
  assert.ok(Math.abs(up[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(down[0] - 0.85) < 1e-6);
});

test('smoothBars scales with elapsed frames and ignores NaN targets', () => {
  const a = new Float32Array([0]);
  smoothBars(a, [1], 0.6, 0.15, 2);
  assert.ok(Math.abs(a[0] - 0.84) < 1e-6);
  const b = new Float32Array([0.5]);
  smoothBars(b, [NaN], 0.6, 0.15);
  assert.ok(b[0] < 0.5 && Number.isFinite(b[0]));
});

test('updatePeaks holds the maximum and falls slowly', () => {
  const peaks = new Float32Array([0.2]);
  updatePeaks(peaks, [0.9]);
  assert.ok(Math.abs(peaks[0] - 0.9) < 1e-6);
  updatePeaks(peaks, [0.1]);
  assert.ok(peaks[0] < 0.9 && peaks[0] > 0.85);
});

test('idleBars is gentle, bounded and stable for t=0', () => {
  const a = idleBars(64, 0);
  assert.deepEqual([...a], [...idleBars(64, 0)]);
  assert.ok(maxOf(a) < 0.1);
  assert.ok([...idleBars(64, 12345)].every((v) => v > 0 && v < 0.1));
});

test('pickSpokes averages chunks and handles empty input', () => {
  const s = pickSpokes(new Float32Array([0, 1, 0, 1]), 2);
  assert.deepEqual([...s], [0.5, 0.5]);
  assert.equal(pickSpokes(new Float32Array(0), 3).length, 3);
  assert.equal(pickSpokes(new Float32Array(2), 4).length, 4);
});

test('mirror reflects the half spectrum about the centre', () => {
  const m = mirror(new Float32Array([1, 2, 3]));
  assert.deepEqual([...m], [3, 2, 1, 1, 2, 3]);
});

test('spokeAngles span the right half from top to bottom', () => {
  const a = spokeAngles(4);
  assert.ok(a[0] > -Math.PI / 2 && a[3] < Math.PI / 2);
  for (let i = 1; i < a.length; i += 1) assert.ok(a[i] > a[i - 1]);
});

test('pulseRadius grows with bass, clamped', () => {
  assert.equal(pulseRadius(100, 0), 100);
  assert.equal(pulseRadius(100, 1), 108);
  assert.equal(pulseRadius(100, 5), 108);
  assert.equal(pulseRadius(100, -1), 100);
});

test('flash safety: a full-scale alternating beat never flashes more than 3 times per second', () => {
  const dt = 1 / 60;
  const p = makePulse();
  const series = [];
  for (let f = 0; f < 600; f += 1) series.push(p.step(f % 2 === 0 ? 1 : 0, dt));
  for (let start = 0; start + 60 <= series.length; start += 30) {
    let ups = 0;
    for (let i = start + 1; i < start + 60; i += 1) if (series[i - 1] < 0.5 && series[i] >= 0.5) ups += 1;
    assert.ok(ups <= 3, `second at frame ${start} had ${ups} flashes`);
  }
});

test('flash safety: a slow square beat is rate limited too', () => {
  const dt = 1 / 60;
  const p = makePulse();
  let ups = 0;
  let last = 0;
  for (let f = 0; f < 600; f += 1) {
    const v = p.step(Math.floor(f / 6) % 2 === 0 ? 1 : 0, dt);
    if (last < 0.5 && v >= 0.5) ups += 1;
    last = v;
  }
  assert.ok(ups <= 30, `${ups} flashes in 10 s`);
  assert.ok(ups >= 1);
  let maxStep = 0;
  const q = makePulse();
  let prev = 0;
  for (let f = 0; f < 120; f += 1) {
    const v = q.step(f % 2 ? 0 : 1, dt);
    maxStep = Math.max(maxStep, Math.abs(v - prev));
    prev = v;
  }
  assert.ok(maxStep <= 4 * dt + 1e-9);
});

test('pulse reset and non-finite targets', () => {
  const p = makePulse();
  p.step(1, 1);
  assert.ok(p.value > 0);
  p.step(NaN, 1);
  assert.ok(Number.isFinite(p.value));
  p.reset();
  assert.equal(p.value, 0);
});

test('governor starts at level 1 (cheap glow) and slow windows lower quality step by step', () => {
  const g = makeGovernor({ fps: 60, window: 10 });
  assert.equal(g.level, 1);
  assert.equal(g.quality().glow, 'tight');
  for (let i = 0; i < 10; i += 1) g.record(20);
  assert.equal(g.level, 2);
  assert.equal(g.quality().scale, 1);
  assert.equal(g.quality().glow, 'halo');
  assert.equal(g.quality().backdrop, false);
  for (let i = 0; i < 100; i += 1) g.record(20);
  assert.equal(g.quality().scale, 1);
  assert.equal(g.quality().glow, 'none');
  assert.equal(g.level, 3);
});

test('governor: 60 consecutive frames under 10 ms raise quality to level 0, a slow frame resets the streak', () => {
  const g = makeGovernor({ fps: 30, window: 1000 });
  for (let i = 0; i < 59; i += 1) g.record(3);
  g.record(12);
  for (let i = 0; i < 59; i += 1) g.record(3);
  assert.equal(g.level, 1);
  g.record(3);
  assert.equal(g.level, 0);
  assert.equal(g.quality().glow, 'full');
  for (let i = 0; i < 200; i += 1) g.record(3);
  assert.equal(g.level, 0);
});

test('governor budget is half the frame interval', () => {
  assert.equal(targetFps(true), 30);
  assert.equal(targetFps(false), 60);
  assert.ok(Math.abs(makeGovernor({ fps: 30 }).budget - 16.6667) < 0.01);
  const g = makeGovernor({ fps: 60, window: 2 });
  g.record(NaN);
  g.record(NaN);
  assert.equal(g.level, 1);
});

test('pacer caps at 30 fps', () => {
  const p = makePacer(30);
  let drawn = 0;
  for (let t = 0; t < 1000; t += 1000 / 60) if (p.due(t)) drawn += 1;
  assert.ok(drawn >= 28 && drawn <= 31, `drawn ${drawn}`);
  p.reset();
  assert.equal(p.due(5), true);
});

test('pacer at 60 fps draws every refresh', () => {
  const p = makePacer(60);
  let drawn = 0;
  for (let t = 0; t < 1000; t += 1000 / 60) if (p.due(t)) drawn += 1;
  assert.ok(drawn >= 59);
});

test('capDpr limits to 2 and floors at 1', () => {
  assert.equal(capDpr(3), 2);
  assert.equal(capDpr(1.5), 1.5);
  assert.equal(capDpr(0.5), 1);
  assert.equal(capDpr(NaN), 1);
});

test('colour helpers parse hex, rgb and fall back', () => {
  assert.deepEqual(parseColor('#ff2fb8'), [255, 47, 184]);
  assert.deepEqual(parseColor(' #fa0 '), [255, 170, 0]);
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), [1, 2, 3]);
  assert.deepEqual(parseColor('oklch(1 0 0)', [9, 9, 9]), [9, 9, 9]);
  assert.deepEqual(parseColor(undefined), [255, 255, 255]);
  assert.equal(rgba([1, 2, 3], 2), 'rgba(1,2,3,1.000)');
  assert.equal(rgba([1, 2, 3], -1), 'rgba(1,2,3,0.000)');
  assert.deepEqual(mixColor([0, 0, 0], [100, 200, 50], 0.5), [50, 100, 25]);
});

test('barCount: pitch 4 px, clamped to 96..480', () => {
  assert.equal(barCount(1200), 300);
  assert.equal(barCount(1900), 475);
  assert.equal(barCount(100), 96);
  assert.equal(barCount(5000), 480);
  assert.equal(barCount(1200, 0.5), 150);
  assert.equal(barCount(NaN), 96);
});

test('bar geometry: width 60 percent of the pitch, at least 2 css px, gap at least 1 css px', () => {
  for (const dpr of [1, 1.5, 2]) {
    for (const w of [320, 375, 1200, 1900, 2560]) {
      const g = barGeometry(barCount(w), w, dpr);
      assert.ok(g.width >= 2 - 1e-9, `width ${g.width} at w ${w}`);
      assert.ok(g.pitch - g.width >= 1 - 1e-9, `gap at w ${w} dpr ${dpr}`);
    }
  }
  const g = barGeometry(barCount(1900), 1900, 1);
  assert.ok(Math.abs(g.width / g.pitch - 0.6) < 0.1);
});

test('barHeight has a soft knee, stays below the maximum and is monotonic', () => {
  assert.equal(barHeight(0), 0);
  assert.ok(Math.abs(barHeight(1) - 0.8) < 1e-9);
  assert.ok(barHeight(0.5) > 0.35 && barHeight(0.5) < 0.6);
  let prev = -1;
  for (let v = 0; v <= 1.5; v += 0.05) { const h = barHeight(v); assert.ok(h >= prev && h <= 0.8 + 1e-9); prev = h; }
  assert.equal(barHeight(NaN), 0);
});

test('edge fade: zero at the canvas edges, full from 4 percent inwards', () => {
  assert.equal(edgeAlpha(0, 1000), 0);
  assert.equal(edgeAlpha(1000, 1000), 0);
  assert.ok(Math.abs(edgeAlpha(20, 1000) - 0.5) < 1e-9);
  assert.equal(edgeAlpha(500, 1000), 1);
  assert.equal(edgeAlpha(5, 0), 1);
});

test('4 gradient stops run from hot pink on the left to orange on the right', () => {
  const s = barStops(FALLBACK_COLORS);
  assert.deepEqual(s.map((x) => x.at), [0, 0.25, 0.6, 1]);
  assert.deepEqual(s[0].color, [255, 31, 142]);
  assert.deepEqual(s[3].color, [255, 154, 58]);
  assert.deepEqual(sampleGradient(s, 0), s[0].color);
  assert.deepEqual(sampleGradient(s, 0.25), s[1].color);
  assert.deepEqual(sampleGradient(s, 1), s[3].color);
  const mid = sampleGradient(s, 0.425);
  assert.ok(mid[1] > 61 && mid[1] < 106);
  assert.equal(barStops({ a: [0, 0, 0], b: [100, 100, 100] }).length, 4);
  assert.deepEqual(lighten([0, 0, 0], 1), [255, 255, 255]);
});

test('shapeBars: deterministic, bounded, silence silent, no spatial smoothing, spikes survive', () => {
  const flat = new Float32Array(64).fill(0.5);
  const a = shapeBars(flat, 100);
  assert.deepEqual([...a], [...shapeBars(flat, 100)]);
  assert.ok([...a].every((v) => v >= 0 && v <= 1));
  assert.equal(maxOf(shapeBars(new Float32Array(64), 100)), 0);
  assert.ok(new Set([...a].map((v) => v.toFixed(4))).size > 30);
  const spike = new Float32Array(64);
  spike[10] = 1;
  const sp = shapeBars(spike, 0);
  assert.ok(sp[10] > 0.8);
  assert.equal(sp[9], 0);
  assert.equal(sp[11], 0);
  const lo = Math.min(...a);
  const hi = Math.max(...a);
  assert.ok(hi / lo < 1.18 / 0.82 + 1e-6);
});

test('barNoise is deterministic, bounded, constant within 60 ms and changes across steps', () => {
  for (let i = 0; i < 500; i += 1) { const v = barNoise(i, 7); assert.ok(v >= -1 && v <= 1); assert.equal(v, barNoise(i, 7)); }
  assert.equal(noiseStep(0), noiseStep(59));
  assert.notEqual(noiseStep(59), noiseStep(60));
  assert.equal(noiseStep(NaN), 0);
  let diff = 0;
  for (let i = 0; i < 100; i += 1) if (barNoise(i, 1) !== barNoise(i, 2)) diff += 1;
  assert.ok(diff > 90);
});

test('resampleBars max-pools: a single spike keeps its height and a wide bar takes the max', () => {
  const data = bins(-120);
  data[Math.round(8000 / (SR / FFT))] = -30;
  const bars = resampleBars(data, 40, OPTS);
  assert.equal(maxOf(bars), 1);
});

test('one flipped bar draw per half, same heights, no second tier', async () => {
  const rects = [];
  let flips = 0;
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...args) => { if (k === 'rect') rects.push(args); if (k === 'scale' && args[1] === -1) flips += 1; return { addColorStop() {} }; }), set: (t, k, v) => { t[k] = v; return true; } });
  const { drawBars, barHeights } = await import('./viz-bars.js');
  const n = 200;
  drawBars(ctx, 600, 400, new Float32Array(n).fill(0.5), { colors: FALLBACK_COLORS, horizon: 0.5 });
  const h = barHeights(new Float32Array(1).fill(0.5), 200)[0];
  assert.equal(flips, 1);
  assert.equal(rects.length, 2 * n);
  assert.ok(rects.every((r) => r[1] === 200 - h && Math.abs(r[3] - h) < 1e-6));
});

test('span scales the bar half-height (1/3 default setting)', async () => {
  const { barHeights } = await import('./viz-bars.js');
  const full = barHeights(new Float32Array([1]), 200 * 1)[0];
  const small = barHeights(new Float32Array([1]), 200 / 3)[0];
  assert.ok(Math.abs(small * 3 - full) < 1e-4);
});

test('edgeBands: 8 bands, counts add up, interior in the top band, edges lower', async () => {
  const { edgeBands, barGeometry } = await import('./viz-bars.js');
  const geo = barGeometry(300, 900, 1);
  const b = edgeBands(300, 900, geo);
  assert.equal(b.band.length, 300);
  assert.equal(b.counts.length, 8);
  assert.equal(b.counts.reduce((a, c) => a + c, 0), 300);
  assert.equal(b.band[150], 7);
  assert.ok(b.band[0] < 7);
  assert.ok(b.counts[7] > 250);
  assert.equal(b.alphas[7], 1);
});

test('glow scale maths', async () => {
  const { glowScale, glowSize } = await import('./viz-glow.js');
  assert.equal(glowScale('full'), 0.5);
  assert.equal(glowScale('tight'), 0.5);
  assert.equal(glowScale('halo'), 0.25);
  assert.equal(glowScale('none'), 0);
  assert.deepEqual(glowSize(1000, 400, 'halo'), { w: 250, h: 100, scale: 0.25 });
  assert.deepEqual(glowSize(1000, 400, 'none'), { w: 0, h: 0, scale: 0 });
  assert.equal(glowSize(1, 1, 'halo').w, 1);
});


test('bar rects snap to whole device pixels with one constant width (no moire stripes)', async () => {
  const { barRect } = await import('./viz-bars.js');
  for (const dpr of [1, 1.25, 1.5, 2]) {
    for (const w of [320, 375, 768, 1200, 1366, 1900, 2560]) {
      const n = barCount(w);
      const g = barGeometry(n, w, dpr);
      assert.ok(Number.isInteger(g.barDev) && g.barDev >= 1);
      let prevRight = null;
      for (let i = 0; i < n; i += 1) {
        const [l, r] = barRect(i, g);
        assert.ok(Number.isInteger(l) && Number.isInteger(r), `edge at i ${i}`);
        assert.equal(r - l, g.barDev);
        if (prevRight !== null) {
          const gap = l - prevRight;
          assert.ok(Number.isInteger(gap) && gap >= 1, `gap ${gap} at i ${i} w ${w} dpr ${dpr}`);
        }
        prevRight = r;
      }
    }
  }
});

test('adaptive reference: a kick frame and a hat frame give clearly different bars, and loudness scales them', () => {
  const sr = 48000;
  const fft = 8192;
  const binW = sr / fft;
  const spec = (kick, hat) => Float32Array.from({ length: 4096 }, (_, i) => {
    const f = Math.max(1, i * binW);
    let v = -14 - 9 * Math.log2(Math.max(1, f / 60));
    if (f < 120) v += kick;
    if (f > 6000) v += hat;
    return Math.max(-100, v);
  });
  const o = { sampleRate: sr, fftSize: fft, tilt: 3 };
  const run = (frame, ref) => {
    const l = barsDb(frame, 300, o);
    return unitBars(l, ref.update(l, 1 / 30));
  };
  const ref = makeReference();
  const bassFrame = run(spec(0, -30), ref);
  const hatFrame = run(spec(-25, 0), ref);
  assert.ok(bassFrame[10] - hatFrame[10] > 0.3);
  assert.ok(bassFrame.filter((v) => v > 0.99).length / 300 < 0.05);
  const quiet = run(spec(-20, -20).map((v) => v - 20), makeReference());
  const loud = run(spec(-20, -20), makeReference());
  assert.ok(Math.abs(quiet[100] - loud[100]) < 0.05);
  const same = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
  const next = run(spec(0, -30), ref);
  assert.ok(!same(next, hatFrame));
});

test('makeReference follows loud peaks quickly, falls slowly and never amplifies silence', () => {
  const ref = makeReference();
  const w1 = ref.update([-20, -40]);
  assert.equal(w1.maxDb, -17);
  const w2 = ref.update([-60, -70], 1);
  assert.ok(w2.maxDb < w1.maxDb && w2.maxDb > w1.maxDb - 3);
  const quiet = makeReference();
  assert.equal(quiet.update([-Infinity, -90]).maxDb, -67);
});

test('ringRadius doubles the base radius, clamped so the outer dots and halo stay on the canvas', () => {
  assert.equal(ringRadius(1000, 1000, 500, 500, 50), 100);
  const r = ringRadius(1000, 1000, 500, 500, 300);
  assert.ok(r < 600 && Math.abs(r * 2.1 * 1.08 - 500) < 1e-9);
  assert.ok(ringRadius(1000, 400, 500, 100, 300) * 2.1 * 1.08 <= 100 + 1e-9);
  assert.equal(ringRadius(100, 100, 0, 50, 10), 0);
});
