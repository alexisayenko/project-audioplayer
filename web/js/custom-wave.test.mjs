import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as c from './custom-wave.js';
import { waveValue, GIBBS } from './wave-shapes.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('WEB-211: the preset recipes are exact (square H3 is 33.3 percent, sawtooth H2 is 50, triangle alternates in sign)', () => {
  const sq = c.presetBars('square');
  assert.equal(sq.length, 32);
  assert.equal(sq[0], 100);
  assert.ok(near(sq[2], 100 / 3));
  assert.equal(sq[1], 0);
  assert.ok(near(sq[30], 100 / 31));
  const saw = c.presetBars('sawtooth');
  assert.ok(near(saw[1], 50) && near(saw[31], 100 / 32) && saw.every((v) => v > 0));
  const tri = c.presetBars('triangle');
  assert.ok(near(tri[2], -100 / 9) && near(tri[4], 100 / 25) && near(tri[6], -100 / 49));
  assert.equal(tri[1], 0);
  assert.deepEqual(c.presetBars('sine').slice(0, 3), [100, 0, 0]);
  assert.deepEqual(c.presetBars('organ').slice(0, 7), [100, 80, 60, 40, 30, 0, 0]);
  assert.deepEqual(c.presetBars('hollow').slice(0, 8), [100, 0, 60, 0, 40, 0, 25, 0]);
  const over = c.presetBars('overtones');
  assert.equal(over[0], 0);
  assert.ok(near(over[1], 50) && near(over[7], 12.5) && over[8] === 0);
  assert.ok(c.presetBars('clear').every((v) => v === 0));
  assert.match(c.PRESETS.find((p) => p.id === 'overtones').title, /Missing fundamental/);
  assert.ok(c.matchesPreset(sq, 'square') && !c.matchesPreset(sq, 'sawtooth'));
});

test('WEB-211: the partial sum of 32 square harmonics is flat on top within 5 percent and the table peaks at 1', () => {
  const a = c.analyzeBars(c.presetBars('square'));
  let lo = Infinity;
  let hi = -Infinity;
  let peak = 0;
  for (let i = 0; i < c.TABLE_N; i += 1) {
    const u = i / c.TABLE_N;
    peak = Math.max(peak, Math.abs(a.table[i]));
    if (u >= 0.15 && u <= 0.35) { lo = Math.min(lo, a.table[i]); hi = Math.max(hi, a.table[i]); }
  }
  assert.ok(near(peak, 1));
  assert.ok((hi - lo) / ((hi + lo) / 2) < 0.05);
  assert.ok(a.table[256] > 0 && a.table[768] < 0);
});

test('WEB-211: the triangle and sawtooth recipes draw the native shapes (sawtooth falls where the native one rises)', () => {
  const norm = (arr) => { const r = Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length); return arr.map((v) => v / r); };
  const tri = norm(Array.from(c.analyzeBars(c.presetBars('triangle')).table));
  const triNative = norm(Array.from({ length: c.TABLE_N }, (_, i) => waveValue('triangle', i / c.TABLE_N)));
  assert.ok(tri.every((v, i) => Math.abs(v - triNative[i]) < 0.03));
  const saw = norm(Array.from(c.analyzeBars(c.presetBars('sawtooth')).table));
  const sawNative = norm(Array.from({ length: c.TABLE_N }, (_, i) => -waveValue('sawtooth', i / c.TABLE_N + 1e-4)));
  assert.ok(saw.every((v, i) => i < 40 || i > c.TABLE_N - 40 || Math.abs(v - sawNative[i]) < 0.2));
});

test('WEB-211: the PeriodicWave coefficients are the bars as sine terms, scaled to a unit peak, with no DC and no cosine part', () => {
  const sq = c.presetBars('square');
  const a = c.analyzeBars(sq);
  const { real, imag } = c.periodicCoefficients(sq, a.scale);
  assert.equal(real.length, 33);
  assert.equal(imag.length, 33);
  assert.ok(real.every((v) => v === 0));
  assert.equal(imag[0], 0);
  assert.ok(near(imag[1], a.scale, 1e-6));
  assert.ok(near(imag[3], a.scale / 3, 1e-6));
  assert.equal(imag[2], 0);
  const synth = (u) => imag.reduce((s, b, n) => s + b * Math.sin(2 * Math.PI * n * u), 0);
  assert.ok(near(synth(0.25), c.tableAt(a.table, 0.25), 0.01));
  assert.ok(near(Math.max(...Array.from({ length: 2000 }, (_, i) => Math.abs(synth(i / 2000)))), 1, 0.01));
  assert.equal(c.periodicCoefficients(sq, a.scale, 8).imag.length, 9);
});

test('WEB-211: the RMS compensation gives every custom shape the sine loudness, capped at 80 percent', () => {
  const sine = c.analyzeBars(c.presetBars('sine'));
  assert.ok(near(sine.rms, Math.SQRT1_2, 1e-4));
  assert.ok(near(c.customGain(0.3, sine.rms), 0.3, 1e-4));
  for (const id of ['triangle', 'square', 'sawtooth', 'organ', 'hollow', 'overtones']) {
    const a = c.analyzeBars(c.presetBars(id));
    const g = c.customGain(0.3, a.rms);
    assert.ok(near(g * a.rms, 0.3 * Math.SQRT1_2, 1e-9), id);
    assert.ok(g <= 0.8, id);
  }
  assert.equal(c.customGain(0.8, c.analyzeBars(c.presetBars('sawtooth')).rms), 0.8);
  assert.equal(c.customGain(0, 0.5), 0);
  assert.equal(c.customGain(0.3, 0), 0);
  const sq = c.analyzeBars(c.presetBars('square'));
  const nativeSquare = 0.3 * Math.SQRT1_2 * GIBBS;
  const customSquare = c.customGain(0.3, sq.rms);
  assert.ok(Math.abs(customSquare * sq.rms - nativeSquare / GIBBS * 1) / (0.3 * Math.SQRT1_2) < 0.03);
  const silent = c.analyzeBars(c.presetBars('clear'));
  assert.equal(silent.rms, 0);
  assert.equal(silent.scale, 0);
});

test('WEB-211: the build-up shows the partial sum of the first N bars', () => {
  const sq = c.presetBars('square');
  assert.deepEqual(c.partialBars(sq, 3).slice(0, 5), [100, 0, 100 / 3, 0, 0]);
  assert.ok(c.partialBars(sq, 32).every((v, i) => v === sq[i]));
  assert.ok(c.partialBars(sq, 0).every((v) => v === 0));
  const one = c.analyzeBars(c.partialBars(sq, 1));
  assert.ok(near(one.rms, Math.SQRT1_2, 1e-4));
  const rms = [1, 3, 5, 9, 17, 31].map((n) => c.analyzeBars(c.partialBars(sq, n)).rms);
  for (let i = 1; i < rms.length; i += 1) assert.ok(rms[i] > rms[i - 1]);
  const edge = (n) => c.analyzeBars(c.partialBars(sq, n)).table[40];
  assert.ok(edge(31) > edge(3));
});

test('WEB-211: the 20 kHz note applies when the fundamental times the highest nonzero harmonic passes 20 kHz', () => {
  const sq = c.presetBars('square');
  assert.equal(c.highestHarmonic(sq), 31);
  assert.equal(c.aboveLimit(440, sq), false);
  assert.equal(c.aboveLimit(700, sq), true);
  assert.equal(c.aboveLimit(20000, c.presetBars('sine')), false);
  assert.equal(c.aboveLimit(20000, c.presetBars('overtones')), true);
  assert.equal(c.aboveLimit(20000, c.presetBars('clear')), false);
});

test('WEB-211: bar editing rules (snap, fine step, clamp, keys, labels)', () => {
  assert.equal(c.snapBar(33.6), 34);
  assert.equal(c.snapBar(33.64, true), 33.6);
  assert.equal(c.snapBar(250), 100);
  assert.equal(c.snapBar(-250), -100);
  assert.equal(c.snapBar(NaN), 0);
  assert.equal(c.stepBar(10, c.keyStep('ArrowUp', false)), 11);
  assert.equal(c.stepBar(10, c.keyStep('ArrowDown', true)), 0);
  assert.equal(c.stepBar(95, c.keyStep('ArrowRight', true)), 100);
  assert.equal(c.stepBar(10, c.keyStep('Home', false)), -100);
  assert.equal(c.stepBar(10, c.keyStep('End', false)), 100);
  assert.equal(c.stepBar(10, c.keyStep('Delete', false)), 0);
  assert.equal(c.keyStep('a', false), null);
  assert.equal(c.barLabel(3, 440, 33), 'Harmonic 3, 1320 Hz, 33 percent');
  assert.equal(c.hoverText(3, 440, 33.3333), 'H3 · 1320 Hz · 33.3 %');
});

test('WEB-211: strongest picks the eight biggest nonzero bars; the components add up to the table', () => {
  const sq = c.presetBars('square');
  const top = c.strongest(sq);
  assert.equal(top.length, 8);
  assert.deepEqual(top.map((e) => e.n), [1, 3, 5, 7, 9, 11, 13, 15]);
  const a = c.analyzeBars(sq);
  const parts = c.strongest(sq, 32).map((e) => c.componentSeries(e, a.scale, 513));
  const sum = (i) => parts.reduce((s, p) => s + p[i], 0);
  assert.ok(near(sum(128), c.tableAt(a.table, 0.25), 0.01));
  assert.equal(c.tableSeries(a.table, 0.5, 5)[0], 0);
  assert.ok(c.maxJump(a.table, c.analyzeBars(c.partialBars(sq, 31)).table) < c.SMALL_JUMP * 2);
});
