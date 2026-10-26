import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const v = await import('./listen-views.js');
const h = await import('./harmonics.js');

const sine = (amp, n = 4800, cycles = 100) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * cycles * i) / n));

test('STU-019: toDbfs is 20 log10 of the linear level and minus infinity for silence', () => {
  assert.equal(v.toDbfs(1), 0);
  assert.ok(Math.abs(v.toDbfs(0.1) + 20) < 1e-9);
  assert.ok(Math.abs(v.toDbfs(0.5) + 6.0206) < 1e-3);
  assert.equal(v.toDbfs(0), -Infinity);
});

test('STU-019: a sine of amplitude A reads 20 log10 A on both the RMS and the peak meter (full scale = 0 dBFS)', () => {
  const full = v.levelOf(sine(1));
  assert.ok(Math.abs(full.rms) < 0.01);
  assert.ok(Math.abs(full.peak) < 0.01);
  const quiet = v.levelOf(sine(0.1));
  assert.ok(Math.abs(quiet.rms + 20) < 0.01);
  assert.ok(Math.abs(quiet.peak + 20) < 0.01);
  assert.ok(Math.abs(v.RMS_SINE_DB - 3.0103) < 1e-4);
});

test('STU-019: levelOf measures only the latest window, clamps to -90 .. 0 dBFS and survives empty input', () => {
  const buf = new Float32Array(1000);
  buf.fill(0.5, 900);
  const last = v.levelOf(buf, 100);
  assert.ok(Math.abs(last.peak - v.toDbfs(0.5)) < 1e-9);
  assert.ok(last.rms <= 0 && last.rms > -6);
  assert.deepEqual(v.levelOf(new Float32Array(64)), { rms: -90, peak: -90 });
  assert.deepEqual(v.levelOf(new Float32Array(0)), { rms: -90, peak: -90 });
  assert.equal(v.levelOf(new Float32Array(8).fill(1)).rms, 0);
  assert.equal(v.levelOf(new Float32Array(8).fill(1e-9)).peak, -90);
});

test('STU-019: the readout shows one decimal and "< -90" at the floor', () => {
  assert.equal(v.fmtDbfs(-20), '-20.0 dBFS');
  assert.equal(v.fmtDbfs(-23.449), '-23.4 dBFS');
  assert.equal(v.fmtDbfs(-0.01), '0.0 dBFS');
  assert.equal(v.fmtDbfs(0), '0.0 dBFS');
  assert.equal(v.fmtDbfs(-90), '< -90 dBFS');
  assert.equal(v.fmtDbfs(-Infinity), '< -90 dBFS');
});

test('STU-019: the meter bar maps -90 .. 0 dBFS to 0 .. 1 and falls slowly', () => {
  assert.equal(v.meterFraction(-90), 0);
  assert.equal(v.meterFraction(0), 1);
  assert.equal(v.meterFraction(-45), 0.5);
  assert.equal(v.meterFraction(-120), 0);
  assert.equal(v.meterFraction(6), 1);
  assert.equal(v.smoothDown(-60, -20, 0.1), -20);
  assert.equal(v.smoothDown(-20, -90, 0.5), -40);
  assert.equal(v.smoothDown(-20, -25, 1), -25);
});

test('STU-018: the waveform window is 40 ms or a number of cycles of the loudest tone', () => {
  assert.equal(v.scopeWindowMs(0, 220), 40);
  assert.equal(v.scopeWindowMs(1, 0), 40);
  assert.equal(v.scopeWindowMs(1, 200), 5);
  assert.ok(Math.abs(v.scopeWindowMs(4, 220) - 18.1818) < 1e-3);
  assert.ok(Math.abs(v.scopeWindowMs(4, 30) - 133.3333) < 1e-3);
  assert.equal(v.scopeWindowMs(4, 20), v.WAVE_MAX_MS);
  assert.equal(v.scopeWindowMs(1, 20000), v.WAVE_MIN_MS);
});

test('STU-021: the lab keeps exporting the shared live-analysis helpers from one place', () => {
  for (const name of ['noteInfo', 'peakOf', 'peakText', 'liveScope', 'gramRows', 'createBeatTracker', 'bandLevels', 'curveLevels', 'gramTicks']) {
    assert.equal(h[name], v[name], name);
  }
  assert.equal(v.peakText({ freq: 220, db: -20 }), 'Peak: 220 Hz (A3 +0 cents)');
  assert.equal(h.SOURCES, undefined);
  assert.equal(h.createMicInput, undefined);
});

test('STU-027: freqAt is the inverse of freqPos on the linear and the log axis, with the exact axis ends', () => {
  assert.equal(v.freqAt(0, 'linear', 5000), 0);
  assert.equal(v.freqAt(1, 'linear', 5000), 5000);
  assert.equal(v.freqAt(0.25, 'linear', 2000), 500);
  assert.ok(Math.abs(v.freqAt(0, 'log', 0) - 20) < 1e-9);
  assert.ok(Math.abs(v.freqAt(1, 'log', 0) - 20000) < 1e-6);
  assert.equal(v.freqAt(-1, 'linear', 5000), 0);
  assert.equal(v.freqAt(2, 'log', 0), 20000);
  for (const [axis, max] of [['linear', 2000], ['linear', 10000], ['log', 20000]]) {
    for (const f of [30, 220, 880, 1500, 1900]) {
      assert.ok(Math.abs(v.freqAt(v.freqPos(f, axis, max), axis, max) - f) < 1e-6, `${axis} ${max} ${f}`);
    }
  }
});

test('STU-027: specX and specFreq map a pixel to a frequency and back with the same geometry as the grid', () => {
  const geo = v.specGeo(375, 210);
  assert.deepEqual(geo, { left: 34, top: 30 + v.H1_HINT_ROW_PX, plotW: 333, plotH: 210 - 30 - v.H1_HINT_ROW_PX - 18 });
  const lin = { axis: 'linear', max: 5000 };
  const log = { axis: 'log', max: 20000 };
  assert.equal(v.specX(0, lin, geo), 34);
  assert.equal(v.specX(5000, lin, geo), 367);
  assert.equal(v.specFreq(200.5, lin, geo), 2500);
  assert.ok(Math.abs(v.specFreq(v.specX(220, log, geo), log, geo) - 220) < 1e-6);
  assert.ok(Math.abs(v.specFreq(v.specX(220, lin, geo), lin, geo) - 220) < 1e-6);
});

test('STU-027: fmtHoverHz uses whole Hz below 1 kHz and two decimals in kHz', () => {
  assert.equal(v.fmtHoverHz(220.4), '220 Hz');
  assert.equal(v.fmtHoverHz(999.6), '1.00 kHz');
  assert.equal(v.fmtHoverHz(1234.5), '1.23 kHz');
  assert.equal(v.fmtHoverHz(12000), '12.00 kHz');
  assert.equal(v.fmtHoverHz(NaN), '-');
});

test('STU-027: specHover reads frequency, note and level at the pointer, outside the plot it is null', () => {
  const geo = v.specGeo(375, 210);
  const lin = { axis: 'linear', max: 5000 };
  const levels = new Float32Array(333).fill(-40);
  const x = v.specX(220, lin, geo);
  const hit = v.specHover(x, geo, lin, { levels });
  assert.equal(hit.x, x);
  assert.equal(hit.title, '220 Hz');
  assert.equal(hit.sub, 'A3 +0 cents · -40.0 dB');
  assert.equal(v.specHover(x, geo, lin, {}).sub, 'A3 +0 cents · -');
  assert.equal(v.specHover(10, geo, lin, { levels }), null);
  assert.equal(v.specHover(geo.left + geo.plotW + 1, geo, lin, { levels }), null);
  const quiet = new Float32Array(333).fill(-95);
  assert.ok(v.specHover(x, geo, lin, { levels: quiet }).sub.endsWith('· -'));
});

test('STU-027: specHover snaps to a harmonic bar within 8 px and keeps the line on the bar', () => {
  const geo = v.specGeo(375, 210);
  const log = { axis: 'log', max: 20000 };
  const bars = [220, 440, 660].map((freq, i) => ({ x: v.specX(freq, log, geo), freq, name: `H${i + 1}`, db: -20 - i }));
  const snapped = v.specHover(bars[2].x + 5, geo, log, { bars });
  assert.equal(snapped.x, bars[2].x);
  assert.equal(snapped.title, 'H3 · 660 Hz');
  assert.equal(snapped.sub, 'E5 +2 cents · -22.0 dB');
  const far = v.specHover(bars[2].x + 9, geo, log, { bars });
  assert.equal(far.x, bars[2].x + 9);
  assert.ok(!far.title.startsWith('H'));
});

test('WEB-205: trailLevel falls from the stored peak at the current rate and holdTrail keeps the louder of the live level and the ghost', () => {
  assert.equal(v.trailLevel(-20, 0, 500, 20), -30);
  assert.equal(v.trailLevel(-20, 0, 500, 40), -40);
  assert.equal(v.trailLevel(-20, 0, 500), -22);
  assert.equal(v.trailLevel(-20, 1000, 0, 20), -20);
  assert.equal(v.trailLevel(-20, 0, 60000, 20), v.TRAIL_FLOOR_DB);
  assert.ok(Math.abs(v.trailLevel(-20, 0, 60000, v.trailRate(60)) - -60) < 1e-9);
  const shown = new Float32Array(3);
  const peaks = Float32Array.from([-20, -50, -90]);
  const times = new Float64Array(3);
  v.holdTrail(shown, peaks, times, Float32Array.from([-60, -45, -Infinity]), 500, 20);
  assert.deepEqual([...shown], [-30, -45, -100]);
  assert.deepEqual([...peaks], [-20, -45, -90]);
  assert.deepEqual([...times], [0, 500, 0]);
  v.holdTrail(shown, peaks, times, new Float32Array(3).fill(-Infinity), 2500, 20);
  assert.deepEqual([...shown], [-65, -85, -140]);
  assert.equal(v.holdTrail(shown, peaks, times, shown, 2500, 20), shown);
});

test('WEB-205: createTrails is on by default, clears on every toggle, falls with real time and resets when the bar set changes', () => {
  const t = v.createTrails();
  assert.equal(t.on, true);
  assert.equal(t.length, 10);
  t.set(false);
  assert.equal(t.step(new Float32Array(2).fill(-10), 0), null);
  t.set(true);
  const live = Float32Array.from([-10, -80]);
  assert.deepEqual([...t.step(live, 0)], [-10, -80]);
  const low = new Float32Array(2).fill(-Infinity);
  assert.deepEqual([...t.step(low, 1000)], [-14, -84]);
  assert.deepEqual([...t.step(low, 60000)], [v.TRAIL_FLOOR_DB, v.TRAIL_FLOOR_DB]);
  t.set(false);
  assert.equal(t.buf, null);
  t.set(true);
  assert.equal(t.buf[0], v.TRAIL_FLOOR_DB);
  const rows = [{ freq: 220 }, { freq: 440 }];
  t.step(live, 0, rows);
  t.step(low, 1000, rows);
  assert.equal(t.buf[0], -14);
  t.step(low, 1100, [{ freq: 230 }, { freq: 440 }]);
  assert.equal(t.buf[0], v.TRAIL_FLOOR_DB);
  assert.equal(t.levels(7), t.levels(7));
});

test('WEB-205: the trail length sets the decay rate (40 dB over the length), is clamped to 0.5-60 s (default 10 s) and applies live', () => {
  assert.equal(v.trailRate(10), v.TRAIL_DECAY_DB_S);
  assert.equal(v.TRAIL_DECAY_DB_S, 4);
  assert.equal(v.trailRate(2), 20);
  const t = v.createTrails();
  assert.equal(t.length, 10);
  t.set(true);
  const live = Float32Array.from([-10]);
  const low = new Float32Array(1).fill(-Infinity);
  t.step(live, 0);
  t.setLength(1);
  assert.equal(t.buf[0], -10);
  assert.deepEqual([...t.step(low, 250)], [-20]);
  t.setLength(5);
  assert.equal(t.buf[0], -12);
  assert.deepEqual([...t.step(low, 1000)], [-18]);
  t.setLength(1);
  assert.equal(t.buf[0], -50);
  assert.deepEqual([...t.step(low, 1000)], [-50]);
  t.setLength(100);
  assert.equal(t.length, 60);
  t.setLength(0.1);
  assert.equal(t.length, 0.5);
  t.setLength(60);
  assert.ok(Math.abs(t.step(low, 30000)[0] - -30) < 0.01);
  t.setLength(10);
  assert.equal(v.trailLengthText(60), '60 s');
  assert.equal(v.trailLengthText(0.5), '0.5 s');
});

test('WEB-205: the trail is stored per analyser bin, so curveLevels maps it through the current axis', () => {
  const bins = new Float32Array(1024).fill(-120);
  bins[Math.round(220 / (24000 / 1024))] = -20;
  const trail = v.createTrails();
  trail.set(true);
  trail.step(bins, 0);
  const lin = { axis: 'linear', max: 2000 };
  const log = { axis: 'log', max: 20000 };
  for (const range of [lin, log]) {
    const out = v.curveLevels(trail.buf, 48000, range, 300, trail.levels(300));
    const top = out.indexOf(Math.max(...out));
    const x = v.specX(220, range, v.specGeo(300 + 42, 210));
    assert.ok(Math.abs(top + v.SPEC_PAD.left - x) < 4, `${range.axis} ${top} ${x}`);
  }
});

test('WEB-206: pitchText reads the pitch, the note and the harmonics found, or says why there is none', () => {
  const items = [{ n: 1, freq: 220.4, found: true }, { n: 2, freq: 440.8, found: true }, { n: 3, freq: 661.2, found: false }, { n: 4, freq: 881.6, found: true }];
  const lin = v.liveAxisRange('linear', 2000);
  const why = ` ${v.H1_EXPLAIN}`;
  assert.equal(v.pitchText(true, 220.4, items, lin), `Pitch: 220.4 Hz (A3 +3 cents), harmonics found: 1,2,4.${why}`);
  assert.equal(v.pitchText(false, 0, [], lin), 'No single pitch (polyphonic or noisy sound)');
  assert.equal(v.pitchText(true, 2030, items, lin), 'Pitch outside the visible range');
  assert.equal(v.pitchText(true, 220, [{ n: 1, freq: 220, found: false }], lin), `Pitch: 220 Hz (A3 +0 cents), harmonics found: none.${why}`);
  assert.equal(v.pitchText(true, 220, [{ n: 1, freq: 220, found: true }], lin, 440), `Pitch: 220 Hz (A3 +0 cents), harmonics found: 1; lower than the loudest peak (440 Hz).${why}`);
  assert.equal(v.pitchText(true, 220, [{ n: 1, freq: 220, found: true }], lin, 220), `Pitch: 220 Hz (A3 +0 cents), harmonics found: 1.${why}`);
  assert.equal(v.loudestPeakHz({ freq: 166 }, 167.8), 166);
  assert.equal(v.loudestPeakHz({ freq: 900 }, 167.8), 167.8);
  assert.equal(v.loudestPeakHz(null, 167.8), 167.8);
});

test('WEB-206: harmonic markers follow the axis: only ticks inside the range, and hover snaps to one within 8 px', () => {
  const items = range16().map((n) => ({ n, freq: 220 * n, found: n % 2 === 1 }));
  const lin = v.liveAxisRange('linear', 2000);
  assert.deepEqual(v.visibleMarks(items, lin).map((m) => m.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(v.visibleMarks(items, v.liveAxisRange('log')).length, 16);
  const geo = { ...v.specGeo(342, 210), xOf: (f) => v.specX(f, lin, v.specGeo(342, 210)) };
  const levels = new Float32Array(300).fill(-40);
  const bars = v.harmonicBars({ items, alpha: 1 }, geo, lin, levels);
  assert.equal(bars.length, 9);
  const hit = v.specHover(bars[2].x + 5, geo, lin, { levels, bars });
  assert.equal(hit.title, 'H3 · 660 Hz');
  assert.equal(hit.x, bars[2].x);
  assert.deepEqual(v.harmonicBars({ items, alpha: 0 }, geo, lin, levels), []);
});

test('WEB-206: h1HintText picks the long hint when it clears H2 and fits, the short one otherwise, and drops it when nothing fits the canvas', () => {
  const measure = (t) => t.length * 5;
  assert.equal(v.h1HintText(measure, 300, 700, Infinity).text, v.H1_HINTS[0]);
  assert.equal(v.h1HintText(measure, 300, 375, Infinity).text, 'fundamental');
  assert.equal(v.h1HintText(measure, 80, 700, 130).text, 'fundamental');
  assert.equal(v.h1HintText(measure, 80, 700, 100).text, 'fundamental');
  assert.equal(v.h1HintText(measure, 10, 50, Infinity), null);
  assert.equal(v.h1HintText(measure, 5, 700, Infinity).left, 2);
  assert.equal(v.h1HintText(measure, 690, 700, Infinity).left + 55 <= 698, true);
});

function kickLanes(seconds = 15, period = 0.5, count = 4) {
  const tracker = v.createBeatTracker(count);
  for (let i = 0; i <= seconds * 60; i += 1) {
    const t = i / 60;
    const phase = t % period;
    const kick = phase < 0.05 ? -20 : -20 - 40 * Math.min(1, (phase - 0.05) / 0.2);
    tracker.push(t, [kick, kick - 3, -50, -60].slice(0, count));
  }
  return { lanes: tracker.lanes, nowT: seconds };
}

test('STU-033: gridEvery keeps the grid lines at least 14 px apart and says so with a count above 1', () => {
  assert.equal(v.GRID_MIN_PX, 14);
  assert.equal(v.gridEvery(0.5, 600), 1);
  assert.equal(v.gridEvery(0.2, 600), 2);
  assert.equal(v.gridEvery(0.05, 600), 5);
  assert.equal(v.gridEvery(0, 600), 1);
  for (const bpm of [60, 120, 250, 400, 800, 1200]) {
    const every = v.gridEvery(60 / bpm, 500);
    assert.ok(every * (60 / bpm / v.BEAT_SECONDS) * 500 >= 14, String(bpm));
  }
  assert.equal(v.gridEveryText(1), '');
  assert.equal(v.gridEveryText(3), 'Fast tempo: grid every 3 beats.');
});

test('STU-033: the tempo grid is phase-locked to the latest strong Sub or Bass onset and moves with it', () => {
  const { lanes, nowT } = kickLanes();
  const grid = v.tempoGrid(lanes, 120, nowT, 600);
  assert.equal(grid.every, 1);
  assert.ok(nowT - grid.anchor <= 0.5 + 1e-9);
  assert.ok(Math.abs(grid.anchor % 0.5) < 0.05 || Math.abs((grid.anchor % 0.5) - 0.5) < 0.05);
  assert.ok(grid.times.every((t) => t <= nowT && t >= nowT - v.BEAT_SECONDS));
  assert.ok(grid.times.length >= 20 && grid.times.length <= 21);
  for (let i = 1; i < grid.times.length; i += 1) assert.ok(Math.abs(grid.times[i - 1] - grid.times[i] - 0.5) < 1e-9);
  const later = v.tempoGrid(lanes, 120, nowT + 0.25, 600);
  assert.equal(later.anchor, grid.anchor);
  assert.ok(later.times.length <= grid.times.length);
});

test('STU-033: no grid without a lock, without a recent onset, and the grid draws only every Nth beat at a fast tempo', () => {
  const { lanes, nowT } = kickLanes();
  assert.equal(v.tempoGrid(lanes, 0, nowT, 600), null);
  assert.equal(v.tempoGrid(lanes, null, nowT, 600), null);
  assert.equal(v.tempoGrid(lanes, 120, nowT + v.GRID_ANCHOR_S + 1, 600), null);
  assert.equal(v.tempoGrid(v.createBeatTracker(4).lanes, 120, 3, 600), null);
  const fast = v.tempoGrid(lanes, 600, nowT, 600);
  assert.equal(fast.every, 3);
  assert.ok(Math.abs(fast.times[0] - fast.times[1] - 0.3) < 1e-9);
});

test('STU-033: the grid ignores onsets in Mids and Highs and a weak onset beside a strong one', () => {
  const tracker = v.createBeatTracker(4);
  tracker.lanes[0].points.push({ t: 9.0, db: -20, onset: true, strength: 20 }, { t: 9.5, db: -20, onset: true, strength: 4 });
  tracker.lanes[2].points.push({ t: 9.9, db: -20, onset: true, strength: 30 });
  assert.equal(v.gridAnchor(tracker.lanes, 10), 9.0);
  tracker.lanes[1].points.push({ t: 9.04, db: -20, onset: true, strength: 18 });
  assert.equal(v.gridAnchor(tracker.lanes, 10), 9.0);
});

test('STU-033: drawBandsView strokes one path of grid lines inside the plot and none without a grid', () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'measureText' ? () => ({ width: 10 }) : (...a) => calls.push([k, ...a])), set: (_, k, val) => { calls.push(['set', k, val]); return true; } });
  const colors = { ink: [0, 0, 0], muted: [90, 90, 90], line: [200, 200, 200], fill: [30, 150, 180], stops: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [210, 96, 26], [0, 0, 0]], font: 'sans-serif' };
  const { lanes, nowT } = kickLanes();
  const g = { ctx, w: 600, h: 240 };
  v.drawBandsView(g, colors, lanes, nowT, true);
  const plain = calls.filter(([k]) => k === 'stroke').length;
  calls.length = 0;
  const grid = v.tempoGrid(lanes, 120, nowT, v.bandsPlotW(600));
  v.drawBandsView(g, colors, lanes, nowT, true, { grid });
  assert.equal(calls.filter(([k]) => k === 'stroke').length, plain + 1);
  assert.ok(calls.some(([k, a, b]) => k === 'set' && a === 'strokeStyle' && b === `rgba(0,0,0,${v.GRID_ALPHA})`));
  const xs = calls.filter(([k, x, y]) => k === 'moveTo' && y === 0).map(([, x]) => x);
  assert.ok(xs.length >= 19 && xs.every((x) => x >= v.BANDS_LEFT && x <= 600 - v.BANDS_RIGHT + 1));
});

test('STU-033: the bands view takes its own caption and adds the grid note only at a fast tempo', () => {
  const colors = () => ({ ink: [0, 0, 0], muted: [0, 0, 0], line: [0, 0, 0], fill: [0, 0, 0], stops: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], font: 'x' });
  const bands = v.createBandsView({ uid: 'b', colors, feed: () => null, note: v.GRID_NOTE });
  assert.equal(bands.caption.textContent, v.GRID_NOTE);
  bands.setTempo(120);
  assert.equal(bands.caption.textContent, v.GRID_NOTE);
  bands.setTempo(null);
  assert.equal(bands.grid, null);
  const plain = v.createBandsView({ uid: 'c', colors, feed: () => null });
  assert.equal(plain.caption.textContent, v.BEAT_NOTE);
});

const range16 = () => Array.from({ length: 16 }, (_, i) => i + 1);
