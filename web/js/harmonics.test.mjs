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
  const wild = h.clampParams({ freq: 1, count: 99, rolloff: -90, tau: 99, repeat: 0, strings: 9, detune: 40, thumpDb: 5, inharmB: 1, strike: 0.9 });
  assert.deepEqual(wild, { ...h.DEFAULTS, freq: 20, count: 32, rolloff: -24, tau: 5, repeat: 1, strings: 3, detune: 5, thumpDb: -12, inharmB: 0.002, strike: 0.25 });
  assert.deepEqual(h.clampParams({}), h.DEFAULTS);
  assert.deepEqual(h.DEFAULTS, {
    freq: 220, count: 10, rolloff: -12, decay: false, tau: 1.2, repeat: 3, strings: 1, detune: 2,
    thump: true, thumpDb: -24, twoStage: true, inharm: true, inharmB: 0.0004, hammer: true, strike: 1 / 8,
  });
  assert.equal(h.clampParams({ strings: 0 }).strings, 1);
  assert.equal(h.clampParams({ thumpDb: -90 }).thumpDb, -48);
  assert.equal(h.clampParams({ strike: 0.01 }).strike, 1 / 12);
});

test('the piano realism features only apply while the piano-like decay is on', () => {
  const off = h.realism({ decay: false });
  assert.deepEqual(off, { thumpGain: 0, twoStage: false, inharmB: 0, strike: 0 });
  const on = h.realism({ decay: true });
  assert.ok(Math.abs(on.thumpGain - 10 ** (-24 / 20)) < 1e-12);
  assert.deepEqual({ ...on, thumpGain: 0 }, { thumpGain: 0, twoStage: true, inharmB: 0.0004, strike: 1 / 8 });
  assert.equal(h.realism({ decay: true, thump: false, inharm: false, hammer: false, twoStage: false }).strike, 0);
  assert.equal(h.realism({ decay: true, thumpDb: -48 }).thumpGain, 0);
  assert.deepEqual(h.harmonicList({ freq: 440, count: 10, decay: false }), h.harmonicList({ freq: 440, count: 10, decay: true, thump: false, twoStage: false, inharm: false, hammer: false }));
});

test('inharmonicity makes partial n sharp: f_n = n f sqrt(1 + B n^2)', () => {
  assert.equal(h.partialFreq(7, 440, 0), 3080);
  assert.ok(Math.abs(h.partialFreq(10, 440, 0.0004) - 4400 * Math.sqrt(1.04)) < 1e-9);
  assert.ok(Math.abs(h.harmonicList({ freq: 440, count: 10, decay: true })[9].freq - 4487.14) < 0.01);
  assert.equal(h.harmonicList({ freq: 440, count: 10, decay: true, inharm: false })[9].freq, 4400);
  assert.ok(h.linearMax(440, 32, 0.002) >= h.partialFreq(32, 440, 0.002));
});

test('the strike position weakens partials with a node at the hammer', () => {
  assert.equal(h.strikeFactor(8, 1 / 8), h.HAMMER_FLOOR);
  assert.equal(h.strikeFactor(16, 1 / 8), h.HAMMER_FLOOR);
  assert.ok(Math.abs(h.strikeFactor(4, 1 / 8) - 1) < 1e-12);
  assert.equal(h.strikeFactor(3, 0), 1);
  const rows = h.harmonicList({ freq: 440, count: 10, rolloff: 0, decay: true, inharm: false });
  assert.ok(rows[7].gain < rows[6].gain / 10);
  assert.ok(Math.abs(rows.reduce((s, r) => s + r.gain, 0) - h.TOTAL_GAIN) < 1e-12);
});

test('two-stage decay is a fast and a slow exponential that sum to the strike level', () => {
  assert.deepEqual(h.stageWeights(false), { fast: 1, slow: 0 });
  assert.deepEqual(h.stageWeights(true), { fast: 0.75, slow: 0.25 });
  assert.equal(h.twoStageValue(0, 0.2, 1), 0.2);
  assert.ok(Math.abs(h.twoStageValue(2, 0.2, 1) - 0.2 * (0.75 * Math.exp(-2) + 0.25 * Math.exp(-0.5))) < 1e-12);
  assert.ok(h.twoStageValue(3, 1, 1) > Math.exp(-3));
});

test('strike position and thump level have readable values', () => {
  assert.equal(h.fmtStrike(1 / 8), '1/8');
  assert.equal(h.fmtStrike(1 / 12), '1/12');
  assert.equal(h.strikeToSlider(1 / 12), 0);
  assert.equal(h.strikeToSlider(1 / 4), 8);
  assert.equal(h.sliderToStrike(h.strikeToSlider(1 / 8)), 1 / 8);
  assert.equal(h.fmtThump(-48), 'off');
  assert.equal(h.fmtThump(-24), '-24 dB');
});

test('strings are detuned symmetrically by cents', () => {
  assert.deepEqual(h.stringOffsets(1, 2), [0]);
  assert.deepEqual(h.stringOffsets(2, 2), [-2, 2]);
  assert.deepEqual(h.stringOffsets(3, 2), [-2, 0, 2]);
  const hz = h.stringOffsets(3, 2).map((c) => 440 * h.centsRatio(c));
  assert.ok(Math.abs(hz[0] - 439.492) < 0.001 && hz[1] === 440 && Math.abs(hz[2] - 440.508) < 0.001);
});

test('beatRate is the frequency gap of adjacent strings', () => {
  assert.equal(h.beatRate(440, 1, 2), 0);
  assert.equal(h.beatRate(440, 3, 0), 0);
  assert.ok(Math.abs(h.beatRate(440, 3, 2) - 440 * (2 ** (2 / 1200) - 1)) < 1e-9);
  assert.ok(Math.abs(h.beatRate(440, 2, 2) - 440 * (2 ** (4 / 1200) - 1)) < 1e-9);
  assert.equal(h.fmtBeat(0.509), '0.51');
  assert.equal(h.fmtBeat(23.04), '23.0');
});

test('strings keep the total wave amplitude and skip partials that detune past the limit', () => {
  const rows = h.harmonicList({ freq: 440, count: 1, rolloff: 0 });
  const one = h.computedWave(rows, 64, 3.5, [0]);
  const three = h.computedWave(rows, 64, 3.5, h.stringOffsets(3, 2));
  assert.ok(Math.max(...three.sum) <= h.TOTAL_GAIN + 1e-9);
  assert.ok(Math.abs(three.sum[10] - one.sum[10]) < 0.002);
  assert.equal(h.harmonicList({ freq: 19990, count: 1, rolloff: 0, strings: 1 }, 48000)[0].played, true);
  assert.equal(h.harmonicList({ freq: 19990, count: 1, rolloff: 0, strings: 3, detune: 5 }, 48000)[0].played, false);
});

test('higher harmonics fade faster: tau_n = tau1 / n^0.8', () => {
  assert.equal(h.tauOf(1, 1.2), 1.2);
  assert.ok(Math.abs(h.tauOf(2, 1.2) - 1.2 / 2 ** 0.8) < 1e-12);
  assert.ok(h.tauOf(10, 1.2) < h.tauOf(3, 1.2));
});

test('envelopeValue holds before the decay starts and falls exponentially after', () => {
  const env = { t0: 1, gain: 0.2, tau: 0.5 };
  assert.equal(h.envelopeValue(env, 0.5), 0.2);
  assert.ok(Math.abs(h.envelopeValue(env, 1.5) - 0.2 * Math.exp(-1)) < 1e-12);
  assert.equal(h.envelopeValue({ t0: 0, gain: 0.1, tau: Infinity }, 9), 0.1);
});

test('isSilent tells a quiet buffer from a sounding one', () => {
  assert.equal(h.isSilent(new Float32Array(64)), true);
  assert.equal(h.isSilent(Float32Array.of(0, 0, 0.01)), false);
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

test('the linear frequency axis fits the highest harmonic and spaces harmonics evenly', () => {
  assert.equal(h.linearMax(220, 10), 2500);
  assert.equal(h.linearMax(220, 1), 1000);
  assert.equal(h.linearMax(1000, 32), 20000);
  const rows = h.harmonicList({ freq: 220, count: 10 });
  const xs = rows.map((r) => h.freqPos(r.freq, 'linear', 2500));
  for (let i = 2; i < xs.length; i += 1) assert.ok(Math.abs(xs[i] - xs[i - 1] - (xs[1] - xs[0])) < 1e-12);
  assert.ok(xs.at(-1) < 1);
  assert.equal(h.freqPos(220, 'log', 2500), h.logPos(220));
  assert.deepEqual(h.linearTicks(2500, 5), [0, 500, 1000, 1500, 2000, 2500]);
  assert.equal(h.fmtTick(2500), '2.5 kHz');
  assert.equal(h.fmtTick(500), '500 Hz');
});

test('gramRows maps spectrogram rows to linear or log bands', () => {
  const lin = h.gramRows(4, 48000, 8192, 'linear', 2400);
  const bw = 48000 / (2 * 8192);
  assert.equal(lin.length, 4);
  assert.ok(lin[3][0] === 0 && Math.abs(lin[0][1] * bw - 2400) < bw * 2);
  assert.deepEqual(h.gramRows(4, 48000, 8192), h.gramRows(4, 48000, 8192, 'log', 20000));
});

test('pickLabels drops overlapping and out-of-range labels', () => {
  const items = [{ x: 20, w: 30 }, { x: 40, w: 30 }, { x: 80, w: 30 }, { x: 118, w: 30 }];
  assert.deepEqual(h.pickLabels(items, 4, 0, 120).map((i) => i.x), [20, 80]);
});
