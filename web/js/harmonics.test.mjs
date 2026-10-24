import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom();
const h = await import('./harmonics.js');

test('noteInfo names the note and the cents against A4 = 440 Hz', () => {
  assert.equal(h.noteInfo(440).text, 'A4 +0 cents');
  assert.equal(h.noteInfo(220).name, 'A3');
  assert.equal(h.noteInfo(261.63).name, 'C4');
  assert.equal(h.noteInfo(1500).text, 'F#6 +23 cents');
});

test('amplitude follows the roll-off in dB per octave', () => {
  assert.equal(h.amplitude(1, -6), 1);
  assert.ok(Math.abs(h.amplitude(2, -6) - 10 ** (-6 / 20)) < 1e-12);
  assert.ok(Math.abs(h.amplitude(4, -6) - 10 ** (-12 / 20)) < 1e-12);
  assert.equal(h.amplitude(9, 0), 1);
});

test('harmonicList keeps the summed gain at 0.3 and skips harmonics above 20 kHz', () => {
  const rows = h.harmonicList({ freq: 1500, count: 32, rolloff: -3 });
  const played = rows.filter((r) => r.played);
  assert.equal(played.length, 13);
  assert.ok(Math.abs(played.reduce((s, r) => s + r.gain, 0) - h.TOTAL_GAIN) < 1e-12);
  assert.equal(rows[13].gain, 0);
  assert.equal(h.harmonicList({ freq: 220, count: 8, rolloff: -6 }, 8000).filter((r) => r.played).length, 8);
  assert.equal(h.harmonicList({ freq: 1500, count: 8, rolloff: 0 }, 8000).filter((r) => r.played).length, 2);
});

test('clampParams keeps every control in range', () => {
  assert.deepEqual(h.clampParams({ freq: 1, count: 99, rolloff: -90 }), { freq: 20, count: 32, rolloff: -24 });
  assert.deepEqual(h.clampParams({}), h.DEFAULTS);
});

test('labels use the H-number and Hz', () => {
  const rows = h.harmonicList({ freq: 220, count: 2, rolloff: -6 });
  assert.equal(h.harmonicLabel(rows[0]), 'Fundamental (H1) · 220 Hz');
  assert.equal(h.harmonicLabel(rows[1]), 'H2 · 440 Hz');
});

test('the frequency slider maps 20 to 4000 Hz on a log scale', () => {
  assert.equal(h.sliderToHz(0), 20);
  assert.equal(h.sliderToHz(1000), 4000);
  assert.equal(h.hzToSlider(20), 0);
  assert.equal(h.hzToSlider(4000), 1000);
  assert.ok(Math.abs(h.hzToSlider(h.sliderToHz(500)) - 500) <= 2);
});

test('liveWave finds the fundamental phase and returns null for silence', () => {
  const sr = 48000;
  const f = 220;
  const x = new Float32Array(16384);
  for (let i = 0; i < x.length; i += 1) x[i] = 0.2 * Math.sin((2 * Math.PI * f * i) / sr + 1.1) + 0.1 * Math.sin((2 * Math.PI * 2 * f * i) / sr + 2.2);
  const w = h.liveWave(x, sr, f, 200);
  assert.ok(w);
  assert.ok(Math.abs(w[0]) < 0.02 && w[3] > 0);
  assert.equal(h.liveWave(new Float32Array(16384), sr, f, 200), null);
});

test('pickLabels drops overlapping and out-of-range labels', () => {
  const items = [{ x: 20, w: 30 }, { x: 40, w: 30 }, { x: 80, w: 30 }, { x: 118, w: 30 }];
  assert.deepEqual(h.pickLabels(items, 4, 0, 120).map((i) => i.x), [20, 80]);
});
