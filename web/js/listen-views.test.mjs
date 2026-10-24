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
