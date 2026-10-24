import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, flush } from './test-dom.mjs';

installDom();
globalThis.location = { hash: '#/studio/simple', href: 'http://localhost/' };
const s = await import('./simple-tone.js');

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
  assert.deepEqual(s.DEFAULTS, { freq: 440, amp: 0.3, length: 2, continuous: false });
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
  assert.equal(s.readout(s.DEFAULTS), 'Period 2.27 ms = 1/f; pressure swings ±30 % of full scale; power 9 %; sound lasts 2 s.');
  assert.match(s.readout({ ...s.DEFAULTS, continuous: true }), /sound lasts until you press Stop\.$/);
  assert.equal(s.fmtMs(s.periodMs(20)), '50');
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
