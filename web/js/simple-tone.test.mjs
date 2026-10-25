import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '#/studio/simple', href: 'http://localhost/' };
const s = await import('./simple-tone.js');
const w = await import('./wave-shapes.js');

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('WEB-199: power is the amplitude squared and 30 % amplitude is 9 % power and -10.5 dBFS', () => {
  assert.ok(near(s.powerPct(0.3), 9));
  assert.equal(s.fmtDb(0.3), '-10.5 dBFS');
  assert.equal(s.fmtDb(0), 'silence');
  assert.ok(near(s.powerPct(0.6), 4 * s.powerPct(0.3)));
  assert.ok(near(s.ampOfPower(9), 0.3));
  assert.ok(near(s.ampOfPower(s.powerPct(0.55)), 0.55));
});

test('WEB-199: the hard limit is 80 % amplitude, which is 64 % power', () => {
  assert.equal(s.clampParams({ amp: 1 }).amp, 0.8);
  assert.equal(s.clampParams({ amp: -1 }).amp, 0);
  assert.equal(s.ampOfPower(100), 0.8);
  assert.equal(s.MAX_POWER_PCT, 64);
});

test('WEB-198: defaults and clamps for frequency and length', () => {
  assert.deepEqual(s.DEFAULTS, { freq: 440, amp: 0.3, length: 2, continuous: true, wave: 'sine' });
  assert.equal(s.clampParams({ wave: 'noise' }).wave, 'sine');
  assert.equal(s.clampParams({ wave: 'square' }).wave, 'square');
  assert.equal(s.clampParams({ freq: 5 }).freq, 20);
  assert.equal(s.clampParams({ freq: 90000 }).freq, 20000);
  assert.equal(s.clampParams({ length: 0 }).length, 0.1);
  assert.equal(s.clampParams({ length: 99 }).length, 30);
  assert.deepEqual(s.clampParams({ freq: NaN, amp: NaN, length: NaN }), s.DEFAULTS);
});

test('WEB-198: the frequency slider is logarithmic from 20 Hz to 20 kHz', () => {
  assert.equal(s.sliderToHz(0), 20);
  assert.equal(s.sliderToHz(1000), 20000);
  assert.equal(s.sliderToHz(500), 632);
  assert.ok(Math.abs(s.hzToSlider(440) - 447) <= 1);
  assert.equal(s.noteInfo(440).text, 'A4 +0 cents');
});

test('WEB-201: the readout states the period, the swing, the power and the length', () => {
  assert.equal(s.readout({ ...s.DEFAULTS, continuous: false }), 'Period 2.27 ms = 1/f; pressure swings ±30 % of full scale; power 9 %; sound lasts 2 s.');
  assert.match(s.readout(s.DEFAULTS), /sound lasts until you press Stop\.$/);
  assert.match(s.readout({ ...s.DEFAULTS, amp: 0.79 }), /pressure swings ±79 % of full scale; power 62 %;/);
  assert.equal(s.fmtMs(s.periodMs(20)), '50');
});

test('WEB-210: the loudness scale makes every shape as loud as a sine: sine 1, triangle 1.2247, square 0.7071, sawtooth 1.2247', () => {
  assert.ok(near(w.loudnessScale('sine'), 1));
  assert.ok(near(w.loudnessScale('triangle'), Math.sqrt(1.5), 1e-9));
  assert.ok(near(w.loudnessScale('square'), Math.SQRT1_2, 1e-9));
  assert.ok(near(w.loudnessScale('sawtooth'), Math.sqrt(1.5), 1e-9));
  for (const wave of w.WAVES) assert.ok(near(w.waveRms(wave) * w.loudnessScale(wave), Math.SQRT1_2, 1e-9));
});

test('WEB-210: the oscillator gain divides out the browser normalisation and never exceeds 80 percent of full scale', () => {
  assert.ok(near(s.oscGain('sine', 0.3), 0.3));
  assert.ok(near(s.oscGain('triangle', 0.3), 0.3 * Math.sqrt(1.5), 1e-9));
  assert.ok(near(s.oscGain('square', 0.3), (0.3 * Math.SQRT1_2) * w.GIBBS, 1e-9));
  for (const wave of w.WAVES) {
    assert.equal(s.oscGain(wave, 0), 0);
    assert.ok(s.oscGain(wave, 0.8) <= 0.8 + 1e-12);
    assert.ok(near(s.oscGain('nonsense', 0.3), 0.3));
  }
  assert.equal(s.oscGain('triangle', 0.8), 0.8);
  assert.equal(s.oscGain('sawtooth', 0.8), 0.8);
});

test('WEB-210: the drawn level equals the gain times the browser normalisation, and the power follows from the RMS of the shape', () => {
  assert.ok(near(s.shapeLevel('sine', 0.3), 0.3));
  assert.ok(near(s.shapeLevel('square', 0.3), 0.3 * Math.SQRT1_2, 1e-9));
  for (const wave of w.WAVES) assert.ok(near(w.wavePowerPct(wave, s.shapeLevel(wave, 0.3)), 9, 1e-9), wave);
  assert.ok(near(w.wavePowerPct('square', 0.3), 18, 1e-9));
  assert.ok(near(w.wavePowerPct('sine', 0.3), 9, 1e-9));
  assert.match(s.readout({ ...s.DEFAULTS, wave: 'square', continuous: false }), /pressure swings ±21 % of full scale; power 9 %;/);
  assert.match(s.readout({ ...s.DEFAULTS, wave: 'triangle' }), /pressure swings ±37 % of full scale; power 9 %;/);
});

test('WEB-210: the drawn shapes start at a rising zero crossing, as the oscillator does', () => {
  const at = (wave, u) => s.shapeAt(wave, u);
  assert.ok(near(at('sine', 0.25), 1)); assert.ok(near(at('triangle', 0.25), 1)); assert.ok(near(at('triangle', 0.75), -1));
  assert.ok(near(at('square', 0.25), 1)); assert.ok(near(at('square', 0.75), -1));
  assert.ok(near(at('sawtooth', 0), 0)); assert.ok(near(at('sawtooth', 0.25), 0.5)); assert.ok(near(at('sawtooth', 0.75), -0.5));
  const v = s.scopeSeries(0.5, 801, 1, 'square');
  assert.equal(v[200], 0.5); assert.equal(v[600], -0.5);
  assert.equal(s.scopeSeries(0.3, 701, 1, 'sine')[175], s.scopeSeries(0.3, 701)[175]);
});

test('WEB-210: the harmonic bars follow the series: square H3 = 1/3, sawtooth H2 = 1/2, triangle H3 = 1/9, only H1 for a sine', () => {
  assert.ok(near(w.harmonicAmps('square')[2], 1 / 3, 1e-9));
  assert.ok(near(w.harmonicAmps('sawtooth')[1], 0.5, 1e-9));
  assert.ok(near(w.harmonicAmps('triangle')[2], 1 / 9, 1e-9));
  assert.deepEqual(w.harmonicAmps('sine').slice(1), new Array(15).fill(0));
  assert.equal(w.harmonicAmps('square')[1], 0);
});

test('WEB-201: the scope series spans the chosen cycles (default one) at the set amplitude', () => {
  assert.equal(s.CYCLES, 1);
  const v = s.scopeSeries(0.3, 701);
  assert.equal(v.length, 701);
  assert.ok(near(Math.max(...v), 0.3, 1e-3));
  assert.ok(near(v[0], 0));
  assert.ok(near(v[700], 0, 1e-9));
  assert.ok(near(s.scopeSeries(0.3, 701, 4)[175], 0.3 * Math.sin(2 * Math.PI), 1e-9));
});

test('WEB-201: the time axis has five ticks that follow the window', () => {
  const ms = (cycles) => s.scopeTicks(cycles, 220).map((t) => s.fmtMs(t.ms));
  assert.deepEqual(ms(1), ['0', '1.14', '2.27', '3.41', '4.55']);
  assert.deepEqual(ms(2), ['0', '2.27', '4.55', '6.82', '9.09']);
  assert.deepEqual(ms(4), ['0', '4.55', '9.09', '13.6', '18.2']);
  assert.deepEqual(s.scopeTicks(1, 220).map((t) => t.frac), [0, 0.25, 0.5, 0.75, 1]);
});

test('WEB-201: the live window starts on a rising zero crossing and holds exactly the chosen cycles', () => {
  const rate = 48000;
  const buf = new Float32Array(32768);
  for (let i = 0; i < buf.length; i += 1) buf[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate);
  for (const cycles of [1, 2, 4]) {
    const w = s.liveWindow(buf, rate, 440, cycles, 600);
    assert.equal(w.need, 600);
    assert.equal(w.samples.length, 600);
    assert.ok(Math.abs(w.samples[0]) < 0.005);
    assert.ok(Math.abs(w.samples[599]) < 0.005);
    assert.ok(w.samples[2] > 0);
  }
});

test('WEB-197: the oscilloscope bracket label states the live period, frequency and wavelength', () => {
  assert.equal(s.cycleLabels(440)[0], '1 cycle = 2.27 ms = 440 Hz = 78 cm in air');
  assert.equal(s.cycleLabels(220)[0], '1 cycle = 4.55 ms = 220 Hz = 1.56 m in air');
  assert.equal(s.cycleLabels(4000)[0], '1 cycle = 0.25 ms = 4000 Hz = 8.6 cm in air');
  assert.equal(s.cycleLabels(440)[1], '1 cycle · 2.27 ms · 440 Hz · 78 cm');
  assert.equal(s.cycleLabels(440)[2], '1 cycle · 2.27 ms · 440 Hz');
  assert.equal(s.fmtWavelengthLabel(343.1), '1.00 m');
  assert.equal(s.fmtWavelengthLabel(20), '17.15 m');
  assert.ok(near(s.wavelengthM(440), 0.7795, 1e-3));
  const width = (t) => t.length * 6;
  assert.equal(s.pickCycleLabel(440, 400, width, false), s.cycleLabels(440)[0]);
  assert.equal(s.pickCycleLabel(440, 400, width, true), s.cycleLabels(440)[1]);
  assert.equal(s.pickCycleLabel(440, 150, width, true), s.cycleLabels(440)[2]);
  assert.equal(s.pickCycleLabel(440, 10, width, true), s.cycleLabels(440)[2]);
});

test('WEB-197: the bracket row lies below the curve area and above the axis labels', () => {
  const geo = s.scopeGeometry(400, 160);
  assert.ok(geo.mid + geo.scale <= geo.rowTop);
  assert.ok(geo.rowTop + geo.row <= 160 - geo.bottom);
});

test('WEB-207: the time window covers frequency x window cycles, with a caption, a many-cycles hint and sensible ms ticks', () => {
  assert.deepEqual(s.WINDOW_CHOICES, [10, 20, 50, 200]);
  assert.equal(s.WINDOW_DEFAULT, 20);
  assert.ok(near(s.windowCycles(440, 20), 8.8));
  assert.ok(near(s.windowCycles(1000, 10), 10));
  assert.equal(s.windowCaption(440, 20), 'about 8.8 cycles in 20 ms');
  assert.equal(s.windowCaption(440, 200), 'about 88 cycles in 200 ms');
  assert.equal(s.windowCaption(100, 10), 'about 1 cycle in 10 ms');
  assert.equal(s.windowCaption(20, 10), 'about 0.2 cycles in 10 ms');
  assert.equal(s.tooManyCycles(s.windowCycles(440, 20)), false);
  assert.equal(s.tooManyCycles(s.windowCycles(440, 200)), true);
  assert.equal(s.tooManyCycles(60), false);
  assert.equal(s.tooManyCycles(60.5), true);
  assert.deepEqual(s.windowTicks(20).map((t) => t.ms), [0, 5, 10, 15, 20]);
  assert.deepEqual(s.windowTicks(10).map((t) => t.ms), [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(s.windowTicks(50).map((t) => t.ms), [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(s.windowTicks(200).map((t) => t.frac), [0, 0.25, 0.5, 0.75, 1]);
  assert.ok(near(s.scopeSeries(0.3, 801, s.windowCycles(440, 20))[400], 0.3 * Math.sin(Math.PI * 8.8), 1e-9));
  assert.ok(s.windowPoints(300, 5000) <= s.WINDOW_MAX_POINTS);
  assert.ok(s.windowPoints(300, 1) >= 600);
  assert.equal(s.scopeGeometry(400, 160, false).row, 0);
  assert.equal(s.scopeGeometry(400, 160).row, 26);
});

test('WEB-207: Primitive has the second oscilloscope beside the first with a Time window switch that follows the settings', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  const heads = card.node.querySelectorAll('h3').map((h) => h.textContent);
  assert.ok(heads.indexOf('Waveform: one cycle') >= 0);
  assert.equal(heads.indexOf('Waveform: time window'), heads.indexOf('Waveform: one cycle') + 1);
  assert.ok(card.node.textContent.includes('Waveform of the tone you will hear over one cycle: time across, amplitude up.'));
  assert.ok(card.node.textContent.includes('Waveform of the tone you will hear over a period of time: time across, amplitude up.'));
  assert.ok(!/oscilloscope/i.test(card.node.textContent));
  assert.equal(card.node.querySelectorAll('.sm-scopes .hm-block').length, 2);
  assert.equal(card.window, 20);
  assert.ok(card.node.textContent.includes('about 8.8 cycles in 20 ms'));
  const many = card.node.querySelectorAll('p').find((p) => p.textContent === 'Too many cycles to see the shape: shorten the window');
  assert.equal(many.hidden, true);
  card.setWindow(200);
  assert.equal(card.window, 200);
  assert.ok(card.node.textContent.includes('about 88 cycles in 200 ms'));
  assert.equal(many.hidden, false);
  card.setWindow(123);
  assert.equal(card.window, 200);
  card.change({ freq: 100 });
  assert.ok(card.node.textContent.includes('about 20 cycles in 200 ms'));
  assert.equal(many.hidden, true);
  card.dispose();
});

test('STU-043: Primitive has no cone animation, no dot, no Slow motion factor and no Pause animation, only a link to the Glossary entry', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  const text = card.node.textContent;
  for (const gone of ['Slow motion', 'Slowed', 'Pause animation', 'Play animation', 'dense (compression)', 'the dot is the pressure now', 'Cycles shown']) assert.ok(!text.includes(gone), gone);
  assert.equal(card.node.querySelectorAll('canvas').length, 2);
  const link = card.node.querySelectorAll('a').find((a) => a.textContent === 'See how a speaker makes a sound wave on the Sound wave page →');
  assert.equal(link.getAttribute('href'), '#/learn/sound-wave');
  assert.equal(card.paused, undefined);
  assert.equal(card.phase, undefined);
  card.dispose();
});

test('STU-046: Primitive is compact: one intro line, the helper texts behind info buttons, the same ids and controls', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  const text = card.node.textContent;
  assert.ok(text.includes('A primitive sound: a single repeating shape (sine, triangle, square or sawtooth) at one frequency. Sine is one pure frequency (H1 only); the other shapes add harmonics.'));
  assert.ok(!text.includes('The four numbers that describe a sound from a speaker.'));
  const buttons = card.node.querySelectorAll('.sm-info');
  assert.equal(buttons.length, 4);
  const texts = [
    'The shape of one cycle. Sine is one pure frequency; the others add harmonics: triangle and square only odd ones, sawtooth all of them.',
    'How far the speaker cone moves. Limited to 80 % of full scale to protect your hearing and the speaker. Amplitude is the level of a sine with the same loudness; square waves are scaled down so that all shapes sound about equally loud.',
    `${s.POWER_NOTE} ${s.POWER_EQUIV_NOTE} ${s.DB_NOTE}`,
    'A new length applies the next time you press Play. Continuous stops after 10 minutes.',
  ];
  for (const [i, b] of buttons.entries()) {
    assert.equal(b.getAttribute('aria-expanded'), 'false');
    b.click();
    assert.equal(b.getAttribute('aria-expanded'), 'true');
    const pop = document.getElementById(b.getAttribute('aria-describedby'));
    assert.equal(pop.getAttribute('role'), 'tooltip');
    assert.ok(pop.textContent.includes(texts[i]));
    b.click();
    assert.equal(b.getAttribute('aria-expanded'), 'false');
    assert.equal(b.getAttribute('aria-describedby'), null);
  }
  assert.equal(card.node.querySelectorAll('.sm-ctl input[type="number"]').length, 4);
  assert.equal(card.node.querySelectorAll('.sm-ctl input[type="range"]').length, 3);
  assert.equal(card.node.querySelectorAll('.sm-ctl .hm-toggle').length, 1);
  assert.ok(text.includes('The bracket: one cycle in time is one wavelength in space'));
  assert.ok(text.includes('One sine wave = one frequency = H1 only.'));
  card.dispose();
});

function fakeCtx() {
  const made = [];
  const param = () => ({ value: 0, calls: [], setValueAtTime(...a) { this.calls.push(['set', ...a]); }, linearRampToValueAtTime(...a) { this.calls.push(['ramp', ...a]); }, setTargetAtTime(...a) { this.calls.push(['target', ...a]); }, cancelScheduledValues() {} });
  class Ctx {
    constructor() { this.state = 'running'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; this.closed = false; made.push(this); }
    createOscillator() { const o = { type: '', frequency: param(), connect() {}, disconnect() {}, start(t) { this.started = t; }, stop(t) { this.stopped = t; } }; this.osc = o; return o; }
    createGain() { this.gain = { gain: param(), connect() {}, disconnect() {} }; return this.gain; }
    createAnalyser() { return { fftSize: 0, connect() {}, disconnect() {}, getFloatTimeDomainData() {} }; }
    close() { this.closed = true; return Promise.resolve(); }
    resume() { return Promise.resolve(); }
  }
  const doc = { hidden: false, handlers: {}, addEventListener(t, f) { (this.handlers[t] ||= []).push(f); }, removeEventListener(t, f) { this.handlers[t] = (this.handlers[t] || []).filter((x) => x !== f); } };
  return { env: { AudioContext: Ctx, document: doc, raf: () => 0, caf: () => {} }, made, doc };
}

test('WEB-200: Play makes a 440 Hz sine at gain 0.3, fades in and out over 30 ms and stops at the length', () => {
  const { env, made } = fakeCtx();
  const card = s.createSimpleCard(env);
  card.change({ continuous: false });
  card.start();
  const ctx = made[0];
  assert.equal(ctx.osc.type, 'sine');
  assert.equal(ctx.osc.frequency.value, 440);
  assert.deepEqual(ctx.gain.gain.calls.slice(0, 2), [['set', 0, 0], ['ramp', 0.3, 0.03]]);
  assert.equal(ctx.osc.stopped, 2);
  assert.equal(card.running, true);
  ctx.osc.onended();
  assert.equal(card.running, false);
  assert.equal(ctx.closed, true);
  assert.equal(card.state, 'done');
  card.dispose();
});

function trackedEnv() {
  const f = fakeCtx();
  const Base = f.env.AudioContext;
  const oscs = [];
  const gains = [];
  class Tracked extends Base {
    createOscillator() { const o = super.createOscillator(); oscs.push(o); return o; }
    createGain() { const g = super.createGain(); gains.push(g); return g; }
  }
  return { ...f, env: { ...f.env, AudioContext: Tracked }, oscs, gains };
}

test('WEB-210: Primitive has a Waveform switch with Sine, Triangle, Square and Sawtooth, Sine by default, keyboard-navigable like a radio group', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  const group = card.node.querySelectorAll('.sm-wave .seg')[0];
  assert.equal(group.getAttribute('role'), 'radiogroup');
  const buttons = card.node.querySelectorAll('.sm-wave .seg-btn');
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-label')), ['Sine', 'Triangle', 'Square', 'Sawtooth']);
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-checked')), ['true', 'false', 'false', 'false']);
  assert.equal(card.params.wave, 'sine');
  buttons[2].click();
  assert.equal(card.params.wave, 'square');
  assert.deepEqual(buttons.map((b) => b.getAttribute('aria-checked')), ['false', 'false', 'true', 'false']);
  assert.ok(card.node.textContent.includes('Square: odd harmonics only, falling as 1/n (hollow). Your tone is the sum of these sine waves.'));
  assert.ok(card.node.textContent.includes('One square wave = H1 plus odd harmonics (chart below).'));
  const bars = card.node.querySelectorAll('.sm-harm rect');
  assert.equal(bars.length, 16);
  assert.equal(bars[2].getAttribute('data-amp'), (1 / 3).toFixed(4));
  assert.equal(bars[1].getAttribute('data-amp'), '0.0000');
  assert.ok(card.node.querySelectorAll('canvas')[0].getAttribute('aria-label').includes('square wave'));
  card.dispose();
});

test('WEB-210: Play uses the chosen shape with the compensated gain; switching while playing crossfades to a second oscillator without a jump', () => {
  const { env, made, oscs } = trackedEnv();
  const card = s.createSimpleCard(env);
  card.change({ wave: 'square' });
  card.start();
  const ctx = made[0];
  assert.equal(oscs[0].type, 'square');
  assert.ok(near(ctx.gain.gain.calls[1][1], 0.3 * Math.SQRT1_2 * 1.1789797444721675, 1e-9));
  card.change({ wave: 'triangle' });
  assert.equal(oscs.length, 2);
  assert.equal(oscs[1].type, 'triangle');
  assert.equal(oscs[1].frequency.value, 440);
  assert.ok(oscs[1].started !== undefined);
  assert.equal(oscs[0].stopped, 0.03);
  assert.equal(card.params.wave, 'triangle');
  card.change({ wave: 'triangle', freq: 880 });
  assert.equal(oscs.length, 2);
  card.change({ wave: 'sawtooth' });
  assert.equal(oscs.length, 3);
  assert.equal(oscs[2].type, 'sawtooth');
  card.stop();
  assert.equal(oscs[2].stopped, 0.03);
  card.dispose();
});

test('WEB-200: Stop fades out and closes the context; leaving the page closes it at once', async () => {
  const { env, made } = fakeCtx();
  const card = s.createSimpleCard(env);
  card.change({ continuous: true });
  card.start();
  assert.equal(made[0].osc.stopped, undefined);
  card.stop();
  assert.equal(card.running, false);
  made[0].osc.onended();
  assert.equal(made[0].closed, true);
  card.start();
  card.dispose();
  assert.equal(made[1].closed, true);
});

test('WEB-200: a hidden page stops the tone', () => {
  const { env, made, doc } = fakeCtx();
  const card = s.createSimpleCard(env);
  card.start();
  doc.hidden = true;
  for (const f of doc.handlers.visibilitychange) f();
  assert.equal(card.running, false);
  assert.equal(made[0].closed, true);
  card.dispose();
});

test('WEB-197: the Synthesize tool (now on the studio site) mounts its card into a plain panel', async () => {
  const panel = document.createElement('div');
  const dispose = s.mountSimple(panel, fakeCtx().env);
  await flush();
  assert.ok(panel.querySelector('section.card.sm-card'));
  dispose();
});

test('WEB-199: the amplitude moves in whole percents: 78.9 becomes 79, 12.7 becomes 13, the cap stays at 80', () => {
  assert.equal(s.clampParams({ amp: 0.789 }).amp, 0.79);
  assert.equal(s.clampParams({ amp: 0.127 }).amp, 0.13);
  assert.equal(s.clampParams({ amp: 0.9 }).amp, 0.8);
  assert.equal(s.roundAmp(0.304), 0.3);
  assert.equal(s.ampPercent(0.79), 79);
  assert.equal(s.ampPercent(s.clampParams({ amp: 0.789 }).amp), 79);
});

test('WEB-199: the amplitude readout has at most two decimals and no trailing zeros', () => {
  assert.equal(s.fmtAmp(0.3), '0.3');
  assert.equal(s.fmtAmp(0.79), '0.79');
  assert.equal(s.fmtAmp(0.8), '0.8');
  assert.equal(s.fmtAmp(0), '0');
  assert.equal(s.fmtAmp(0.789), '0.79');
});

test('WEB-199: power shows one decimal below 10 percent and a whole number from 10 percent', () => {
  assert.equal(s.fmtPower(s.powerPct(0.3)), '9');
  assert.equal(s.fmtPower(s.powerPct(0.79)), '62');
  assert.equal(s.fmtPower(s.powerPct(0.05)), '0.3');
  assert.equal(s.fmtPower(s.powerPct(0.1)), '1');
  assert.equal(s.fmtPower(0), '0');
  assert.equal(s.fmtPower(9.96), '10');
  assert.equal(s.fmtPower(64), '64');
});

test('WEB-199: editing power sets the amplitude to the nearest whole percent and power follows from it', () => {
  assert.equal(s.ampOfPower(50), 0.71);
  assert.equal(s.fmtPower(s.powerPct(s.ampOfPower(50))), '50');
  assert.equal(s.ampOfPower(62), 0.79);
  assert.equal(s.fmtPower(s.powerPct(0.79)), '62');
  assert.equal(s.ampOfPower(64), 0.8);
  assert.equal(s.ampOfPower(90), 0.8);
  assert.equal(s.ampOfPower(-5), 0);
});

test('WEB-198: Continuous is on by default, the Length number is disabled and keeps 2 s, unchecking enables it', () => {
  const card = s.createSimpleCard(fakeCtx().env);
  const len = card.node.querySelector('.sm-ctl input[type="number"][min="0.1"]');
  assert.equal(card.params.continuous, true);
  assert.equal(len.disabled, true);
  assert.equal(len.value, '2');
  card.change({ continuous: false });
  assert.equal(len.disabled, false);
  assert.equal(card.params.length, 2);
  card.dispose();
});
