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
  assert.deepEqual(wild, { ...h.DEFAULTS, freq: 20, count: 32, rolloff: -24, tau: 5, repeat: 1, strings: 8, detune: 5, thumpDb: -12, inharmB: 0.002, strike: 0.25 });
  assert.deepEqual(h.clampParams({}), h.DEFAULTS);
  assert.deepEqual(h.DEFAULTS, {
    freq: 220, count: 10, rolloff: -12, mute: false, decay: false, tau: 1.2, repeat: 3, strings: 1, detune: 2,
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

test('up to 8 strings are spread evenly from -d to +d', () => {
  assert.equal(h.MAX_STRINGS, 8);
  assert.deepEqual(h.stringOffsets(5, 2), [-2, -1, 0, 1, 2]);
  const eight = h.stringOffsets(8, 3.5);
  assert.equal(eight.length, 8);
  assert.equal(eight[0], -3.5);
  assert.equal(eight[7], 3.5);
  for (let k = 1; k < 8; k += 1) assert.ok(Math.abs(eight[k] - eight[k - 1] - 1) < 1e-9);
  assert.equal(h.clampParams({ strings: 12 }).strings, 8);
});

test('strings x harmonics is capped at 256 oscillators', () => {
  assert.equal(h.MAX_OSCILLATORS, 256);
  assert.equal(h.synthCount(8, 10), 10);
  assert.equal(h.synthCount(8, 32), 32);
  assert.equal(h.synthCount(8, 40), 32);
  assert.equal(h.synthCount(3, 100), 85);
  assert.equal(h.capText(8, 10), '');
  assert.equal(h.capText(8, 40), 'Using 32 harmonics per string (limit 256 oscillators).');
});

test('beatRate is the frequency gap of adjacent strings', () => {
  assert.equal(h.beatRate(440, 1, 2), 0);
  assert.equal(h.beatRate(440, 3, 0), 0);
  assert.ok(Math.abs(h.beatRate(440, 3, 2) - 440 * (2 ** (2 / 1200) - 1)) < 1e-9);
  assert.ok(Math.abs(h.beatRate(440, 2, 2) - 440 * (2 ** (4 / 1200) - 1)) < 1e-9);
  assert.ok(Math.abs(h.beatRate(440, 8, 3.5) - 440 * (2 ** (1 / 1200) - 1)) < 1e-9);
  assert.equal(h.fmtBeat(0.509), '0.51');
  assert.equal(h.fmtBeat(23.04), '23.0');
});

test('the waveform axis has five ticks that follow the window (1, 2 or 4 cycles; default 1)', () => {
  assert.deepEqual(h.CYCLES_CHOICES, [1, 2, 4]);
  assert.equal(h.CYCLES, 1);
  const ms = (cycles) => h.waveTicks(cycles, 220).map((t) => +t.ms.toFixed(2));
  assert.deepEqual(ms(1), [0, 1.14, 2.27, 3.41, 4.55]);
  assert.deepEqual(ms(2), [0, 2.27, 4.55, 6.82, 9.09]);
  assert.deepEqual(ms(4), [0, 4.55, 9.09, 13.64, 18.18]);
  assert.ok(Math.abs(h.waveTicks(1, 220)[4].ms - 1000 / 220) < 1e-9);
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

test('computedWave can return each string alone and their mean is the sum', () => {
  const rows = h.harmonicList({ freq: 220, count: 3, rolloff: -6 });
  const w = h.computedWave(rows, 64, 3.5, h.stringOffsets(3, 2), true);
  assert.equal(w.strings.length, 3);
  assert.equal(h.computedWave(rows, 64, 3.5, [0]).strings.length, 0);
  for (const i of [5, 20, 47]) assert.ok(Math.abs((w.strings[0][i] + w.strings[1][i] + w.strings[2][i]) / 3 - w.sum[i]) < 1e-6);
});

test('the beating window fits one swell and the swell text reuses the beat readout', () => {
  assert.equal(h.beatingWindow(0), 2);
  assert.equal(h.beatingWindow(1.97), 2);
  assert.equal(h.beatingWindow(3.94), 4);
  assert.equal(h.beatingWindow(99), 30);
  assert.equal(h.swellPeriod(220, 1, 2), 0);
  assert.ok(Math.abs(h.swellPeriod(220, 2, 2) - 1 / (220 * (2 ** (4 / 1200) - 1))) < 1e-9);
  assert.equal(h.swellText(h.beatRate(220, 2, 2)), 'H1 beats about 0.51 Hz: one swell every 1.97 s');
});

test('the H1 envelope of two strings swells and cancels once per beat period', () => {
  const rows = h.harmonicList({ freq: 220, count: 1, rolloff: 0 });
  const period = h.swellPeriod(220, 2, 2);
  const cols = 401;
  const env = h.beatingH1(rows, h.stringOffsets(2, 2), 2, cols);
  const at = (t) => env[Math.round((t / 2) * (cols - 1))];
  assert.ok(Math.abs(at(0) - h.TOTAL_GAIN) < 1e-6);
  assert.ok(at(period / 2) < 0.01 * h.TOTAL_GAIN);
  assert.ok(at(period) > 0.95 * h.TOTAL_GAIN);
});

test('three strings give the same swell period as the beat readout', () => {
  const rows = h.harmonicList({ freq: 220, count: 1, rolloff: 0 });
  const period = h.swellPeriod(220, 3, 2);
  const win = h.beatingWindow(period);
  const cols = 801;
  const env = h.beatingH1(rows, h.stringOffsets(3, 2), win, cols);
  const at = (t) => env[Math.round((t / win) * (cols - 1))];
  assert.ok(Math.abs(at(0) - h.TOTAL_GAIN) < 1e-6);
  assert.ok(at(period) > 0.98 * h.TOTAL_GAIN);
  assert.ok(at(period / 2) < 0.4 * h.TOTAL_GAIN);
});

test('the sum envelope is flat for one string and dips between swells for two', () => {
  const rows = h.harmonicList({ freq: 220, count: 1, rolloff: 0 });
  const one = h.beatingEnvelope(rows, [0], 2, 100);
  assert.ok(Math.max(...one.hi) - Math.min(...one.hi) < 0.03 * h.TOTAL_GAIN);
  const period = h.swellPeriod(220, 2, 2);
  const two = h.beatingEnvelope(rows, h.stringOffsets(2, 2), 2, 401);
  assert.ok(two.hi[0] > 0.9 * h.TOTAL_GAIN);
  assert.ok(two.hi[Math.round((period / 2 / 2) * 400)] < 0.2 * h.TOTAL_GAIN);
  assert.ok(two.lo[0] < -0.9 * h.TOTAL_GAIN);
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

test('liveScope triggers at a rising zero crossing and returns null for a short buffer', () => {
  const sr = 48000;
  const x = new Float32Array(16384);
  for (let i = 0; i < x.length; i += 1) x[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr + 0.7);
  const s = h.liveScope(x, sr, 200);
  assert.equal(s.triggered, true);
  assert.ok(Math.abs(s.out[0]) < 0.02 && s.out[3] > 0);
  assert.ok(Math.abs(s.peak - 0.5) < 0.01);
  const quiet = h.liveScope(new Float32Array(16384), sr, 200);
  assert.equal(quiet.triggered, false);
  assert.equal(quiet.peak, 0);
  assert.equal(h.liveScope(new Float32Array(100), sr, 200), null);
});

test('niceScale grows at once and shrinks only when the signal is clearly smaller', () => {
  assert.equal(h.niceScale(0.26, 1), 0.3);
  assert.equal(h.niceScale(0.9, 0.1), 1);
  assert.equal(h.niceScale(0.09, 0.2), 0.2);
  assert.equal(h.niceScale(0.02, 0.2), 0.05);
  assert.equal(h.niceScale(5, 1), 1);
});

test('peakOf interpolates the loudest bin and gives up on a quiet signal', () => {
  const bins = 8192;
  const bw = 48000 / (2 * bins);
  const d = new Float32Array(bins).fill(-120);
  d[74] = -40; d[75] = -20; d[76] = -35;
  const p = h.peakOf(d, 48000);
  assert.ok(Math.abs(p.freq - 75.07 * bw) < 0.5);
  assert.ok(Math.abs(p.db - (-20 + h.ANALYSER_DB_OFFSET)) < 1e-9);
  assert.equal(h.peakOf(new Float32Array(bins).fill(-120), 48000), null);
  assert.equal(h.peakText(null), 'Peak: -');
  assert.equal(h.peakText({ freq: 220, db: -10 }), 'Peak: 220 Hz (A3 +0 cents)');
});

test('curveLevels takes the loudest bin per column on a linear or log axis', () => {
  const bins = 8192;
  const bw = 48000 / (2 * bins);
  const d = new Float32Array(bins).fill(-100);
  d[Math.round(1000 / bw)] = -10;
  const lin = h.curveLevels(d, 48000, h.liveAxisRange('linear', 5000), 100);
  assert.equal(lin.length, 100);
  assert.ok([19, 20].includes(lin.indexOf(Math.max(...lin))));
  const log = h.curveLevels(d, 48000, h.liveAxisRange('log'), 200);
  assert.ok(Math.abs(log.indexOf(Math.max(...log)) / 200 - h.logPos(1000)) < 0.01);
  assert.ok(Math.abs(Math.max(...lin) - (-10 + h.ANALYSER_DB_OFFSET)) < 1e-4);
});

test('liveAxisRange keeps the chosen range and the log range fixed', () => {
  assert.deepEqual(h.liveAxisRange('linear', 2000), { axis: 'linear', min: 0, max: 2000, live: true });
  assert.equal(h.liveAxisRange('linear', 777).max, 5000);
  assert.deepEqual(h.liveAxisRange('log', 2000), { axis: 'log', min: 20, max: 20000, live: true });
  assert.deepEqual(h.gramTicks([], h.liveAxisRange('linear', 2000), 180).map((t) => t[0]), [500, 1000, 1500]);
});

test('bandBins splits the spectrum into Sub, Bass, Mids and Highs and keeps one bin at least', () => {
  const bins = 8192;
  const bw = 48000 / (2 * bins);
  const map = h.bandBins(48000, bins);
  assert.equal(map.length, 4);
  assert.deepEqual(map.map((m) => [Math.round(m[0] * bw / 10), Math.round(m[1] * bw / 10)]), [[2, 6], [6, 25], [25, 200], [200, 1000]]);
  assert.ok(map.every(([a, z]) => a >= 1 && z >= a && z <= bins - 1));
  const low = h.bandBins(16000, 256);
  assert.ok(low[3][0] <= low[3][1] && low[3][1] <= 255);
  assert.deepEqual(h.BANDS.map((b) => h.bandRangeText(b)), ['20-60 Hz', '60-250 Hz', '250-2000 Hz', '2-10 kHz']);
});

test('bandLevels gives the mean power per band in dB, clamped to -90 .. 0', () => {
  const d = new Float32Array(100).fill(-Infinity);
  assert.deepEqual(h.bandLevels(d, [[10, 20]]), [h.DB_MIN]);
  d.fill(-30);
  assert.ok(Math.abs(h.bandLevels(d, [[10, 20]])[0] - (-30 + h.ANALYSER_DB_OFFSET)) < 1e-9);
  d[10] = 0;
  const mixed = h.bandLevels(d, [[10, 11]])[0];
  assert.ok(Math.abs(mixed - (10 * Math.log10((10 ** 1.356 + 10 ** ((-30 + h.ANALYSER_DB_OFFSET) / 10)) / 2))) < 1e-9);
  d.fill(40);
  assert.equal(h.bandLevels(d, [[1, 5]])[0], h.DB_MAX);
});

test('laneRange normalizes to the recent min and max with a minimum span', () => {
  assert.deepEqual(h.laneRange([-60, -20, -40], true), { lo: -60, hi: -20 });
  assert.deepEqual(h.laneRange([-60, -59], true), { lo: -60, hi: -54 });
  assert.deepEqual(h.laneRange([-60, -20], false), { lo: h.DB_MIN, hi: h.DB_MAX });
  assert.deepEqual(h.laneRange([], true), { lo: h.DB_MIN, hi: h.DB_MAX });
});

test('createBeatTracker marks a regular kick pattern and ignores a steady or quiet band', () => {
  const tracker = h.createBeatTracker(2);
  const hits = [];
  for (let i = 0; i < 600; i += 1) {
    const t = i / 60;
    const phase = t % 0.5;
    const kick = phase < 0.05 ? -20 : -20 - 40 * Math.min(1, (phase - 0.05) / 0.2);
    const out = tracker.push(t, [kick, -30]);
    if (out[0]) hits.push(t);
    assert.equal(out[1], false);
  }
  assert.ok(hits.length >= 18 && hits.length <= 20);
  for (let i = 1; i < hits.length; i += 1) assert.ok(Math.abs(hits[i] - hits[i - 1] - 0.5) < 0.05);
  assert.ok(tracker.lanes[0].points.every((p) => 599 / 60 - p.t <= h.BEAT_SECONDS));
  assert.equal(tracker.lanes[0].points.length, 600);
  const quiet = h.createBeatTracker(1);
  const jumps = [];
  for (let i = 0; i < 120; i += 1) jumps.push(quiet.push(i / 60, [i % 30 < 15 ? -90 : -78])[0]);
  assert.ok(jumps.every((j) => j === false));
  tracker.reset();
  assert.equal(tracker.lanes[0].points.length, 0);
});

test('muting H1 silences only H1 and keeps the other levels', () => {
  const on = h.harmonicList({ freq: 220, count: 8, rolloff: -12, mute: true });
  const off = h.harmonicList({ freq: 220, count: 8, rolloff: -12 });
  assert.equal(on[0].muted, true);
  assert.equal(on[0].gain, 0);
  assert.equal(on[0].db, -Infinity);
  assert.equal(on[0].full, off[0].gain);
  assert.equal(on[0].freq, 220);
  for (let i = 1; i < 8; i += 1) assert.equal(on[i].gain, off[i].gain);
  assert.ok(Math.abs(on.reduce((a, r) => a + r.gain, 0) - (0.3 - off[0].gain)) < 1e-12);
  assert.equal(h.harmonicList({ freq: 220, count: 1, mute: true })[0].muted, false);
  assert.equal(h.isMuted({ count: 1, mute: true }), false);
  assert.equal(h.leadN({ count: 8, mute: true }), 2);
  assert.equal(h.leadN({ count: 8 }), 1);
});

test('a muted H1 has no bar, a muted label and the lead beat moves to H2', () => {
  const rows = h.harmonicList({ freq: 220, count: 4, mute: true });
  assert.equal(h.barLevels(rows, new Float32Array(1024).fill(-50), 48000)[0], -Infinity);
  assert.equal(h.harmonicLabel(rows[0]), 'Fundamental (H1, muted) · 220 Hz');
  assert.equal(h.gramTicks(rows, { axis: 'linear', max: 1000 }, 400)[0][1], 'H1 (muted) · 220 Hz');
  assert.equal(h.beatText(1.02, 2), 'H2 beats about 1.02 Hz');
  assert.equal(h.swellText(2, 2), 'H2 beats about 2.00 Hz: one swell every 0.50 s');
  assert.ok(h.beatingH1(rows, [-2, 2], 2, 8, 1).some((v) => v > 0));
  assert.match(h.muteText(220), /still H1 \(220 Hz\).*Try it with 6\+ harmonics\.$/);
});

test('levelMatched keeps a steady wave and scales a fading or silent one', () => {
  const rows = h.harmonicList({ freq: 220, count: 4, mute: true });
  const sum = new Float32Array([0, 0.2, -0.2]);
  assert.equal(h.levelMatched(sum, new Float32Array(2048), rows)[1], 0);
  const steady = new Float32Array(2048);
  const rms = Math.sqrt(rows.reduce((a, r) => a + (r.gain * r.gain) / 2, 0));
  for (let i = 0; i < steady.length; i += 1) steady[i] = rms * Math.SQRT2 * Math.sin(i);
  assert.equal(h.levelMatched(sum, steady, rows), sum);
});
